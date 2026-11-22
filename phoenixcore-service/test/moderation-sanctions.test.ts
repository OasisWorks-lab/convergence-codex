import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {staffIdentity} from '../src/staff.ts';
import {recordCase,activeWarnings} from '../src/moderation.ts';
import {queueSanction,executeQueuedSanction,expireModerationSanction,moderationWorkspace,reconcileUnconfirmedSanctions} from '../src/moderation-actions.ts';
import {deliverScheduledJob} from '../src/jobs.ts';
import {operationCommands,operationInteraction} from '../src/operations-discord.ts';
import {DiscordFailure} from '../src/discord.ts';
const guild='940000000000000001',ownerId='940000000000000002',adminId='940000000000000003',
  userId='940000000000000004',helperId='940000000000000005',botId='940000000000000006',
  adminRole='940000000000000010',ordinaryRole='940000000000000011',botRole='940000000000000012',helperRole='940000000000000013';
const config:any={guild,owner:ownerId,clientId:botId};
const owner=staffIdentity(ownerId,[],'0',config,helperRole),
  admin=staffIdentity(adminId,[adminRole],'8',config,helperRole),
  helper=staffIdentity(helperId,[helperRole],'0',config,helperRole);
const roles=[
  {id:adminRole,position:10,permissions:'8'},
  {id:ordinaryRole,position:2,permissions:'0'},
  {id:botRole,position:20,permissions:'8'},
  {id:helperRole,position:5,permissions:'0'}
];
async function fresh(t:any){const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;}
function fakeDiscord(){
  const bans=new Map<string,string>(),member={user:{id:userId,bot:false},roles:[ordinaryRole],communication_disabled_until:null as string|null},
    operations:any[]=[],notices:any[]=[];
  let fault=false;
  const discord:any={call:async(path:string,init:any={})=>{
    operations.push({path,method:init.method||'GET',headers:init.headers});
    if(path==='/guilds/'+guild)return {id:guild,owner_id:ownerId};
    if(path==='/guilds/'+guild+'/roles')return roles;
    if(path==='/guilds/'+guild+'/members/'+adminId)return {user:{id:adminId},roles:[adminRole]};
    if(path==='/guilds/'+guild+'/members/'+ownerId)return {user:{id:ownerId},roles:[adminRole]};
    if(path==='/guilds/'+guild+'/members/'+botId)return {user:{id:botId},roles:[botRole]};
    if(path==='/guilds/'+guild+'/members/'+userId){
      if(init.method==='PATCH'){
        if(fault)throw new DiscordFailure(502);
        member.communication_disabled_until=JSON.parse(init.body).communication_disabled_until;
        return member;
      }
      if(init.method==='DELETE'){if(fault)throw new DiscordFailure(502);return null;}
      return member;
    }
    if(path==='/guilds/'+guild+'/bans/'+userId){
      if(init.method==='PUT'){
        if(fault)throw new DiscordFailure(502);
        assert.equal(JSON.parse(init.body).delete_message_seconds,0);
        bans.set(userId,decodeURIComponent(init.headers['X-Audit-Log-Reason']));
        return null;
      }
      if(init.method==='DELETE'){
        if(fault)throw new DiscordFailure(502);
        if(!bans.has(userId))throw new DiscordFailure(404);
        bans.delete(userId);return null;
      }
      if(!bans.has(userId))throw new DiscordFailure(404);
      return {user:{id:userId},reason:bans.get(userId)};
    }
    if(path==='/users/@me/channels')return {id:'940000000000000099'};
    if(path==='/channels/940000000000000099/messages'){
      notices.push(JSON.parse(init.body));return {id:'940000000000000098'};
    }
    throw Error('Unexpected REST '+path);
  }};
  return {discord,bans,member,operations,notices,setFault:(v:boolean)=>{fault=v;}};
}
test('manual timeout creates one durable case, replays safely, and Discord ends it natively',async t=>{
  const db=await fresh(t),api=fakeDiscord(),receipt=randomUUID(),now=Date.now();
  await assert.rejects(queueSanction(db,api.discord,config,helper,{
    action:'timeout',targetId:userId,receipt,minutes:30}),{status:403});
  await assert.rejects(queueSanction(db,api.discord,config,owner,{
    action:'timeout',targetId:ownerId,receipt,minutes:30}),{status:403});
  await assert.rejects(queueSanction(db,api.discord,config,owner,{
    action:'timeout',targetId:userId,receipt,minutes:40321}),{status:400});
  const entry=await queueSanction(db,api.discord,config,admin,{
    action:'timeout',targetId:userId,receipt,reason:'Use respectful OOC language.',minutes:30},now);
  assert.equal(entry.created,true);assert.equal(entry.status,'pending');
  const result=await executeQueuedSanction(db,api.discord,config,admin,entry.caseId);
  assert.equal(result.applied,true);
  assert.ok(api.member.communication_disabled_until);
  assert.equal((await executeQueuedSanction(db,api.discord,config,admin,entry.caseId)).applied,false);
  const second=await queueSanction(db,api.discord,config,admin,{
    action:'timeout',targetId:userId,receipt,minutes:30});
  assert.equal(second.created,false);assert.equal(second.caseId,entry.caseId);
  assert.equal(api.operations.filter(x=>x.method==='PATCH').length,1);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pc_mod_cases WHERE kind=$1',['timeout']))[0].n,1);
  assert.equal((await moderationWorkspace(db,owner,userId)).cases[0].sanction_status,'applied');
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM pc_core_jobs WHERE job_type='moderation-expiry'"))[0].n,1);
  const expired=await expireModerationSanction(db,api.discord,config,entry.caseId,now+30*60000+2000);
  assert.equal(expired.status,'expired');
  assert.equal((await moderationWorkspace(db,owner,userId)).cases[0].sanction_status,'expired');
});
test('time-limited bans expire through the persistent job worker without touching unrelated bans',async t=>{
  const db=await fresh(t),api=fakeDiscord(),now=Date.now();
  const entry=await queueSanction(db,api.discord,config,owner,{
    action:'ban',targetId:userId,receipt:randomUUID(),minutes:5,reason:'Repeated harassment'},now);
  assert.equal((await executeQueuedSanction(db,api.discord,config,owner,entry.caseId)).status,'applied');
  assert.match(api.bans.get(userId)!,new RegExp('PhoenixCore case '+entry.caseId));
  await initialize(db,guild);
  for(let i=0;i<3;i++)await deliverScheduledJob(db,api.discord,now+5*60000+1000,config);
  assert.equal(api.bans.size,0);
  assert.equal((await moderationWorkspace(db,owner,userId)).cases[0].sanction_status,'expired');
  assert.equal((await db.query("SELECT status FROM pc_core_jobs WHERE id=$1",['mod-expire:'+entry.caseId]))[0].status,'delivered');
  const twice=await expireModerationSanction(db,api.discord,config,entry.caseId,now+6*60000);
  assert.equal(twice.changed,false);
  const another=await queueSanction(db,api.discord,config,admin,{
    action:'ban',targetId:userId,receipt:randomUUID(),minutes:5},now);
  await executeQueuedSanction(db,api.discord,config,admin,another.caseId);
  api.bans.set(userId,'External moderator issued a different ban');
  assert.equal((await expireModerationSanction(db,api.discord,config,another.caseId,now+6*60000)).status,'superseded');
  assert.equal(api.bans.get(userId),'External moderator issued a different ban');
});
test('explicit unban supersedes earlier timed ban so its old scheduled expiry cannot unban again',async t=>{
  const db=await fresh(t),api=fakeDiscord(),now=Date.now();
  const ban=await queueSanction(db,api.discord,config,owner,{
    action:'ban',targetId:userId,receipt:randomUUID(),minutes:40},now);
  await executeQueuedSanction(db,api.discord,config,owner,ban.caseId);
  const unban=await queueSanction(db,api.discord,config,owner,{
    action:'unban',targetId:userId,receipt:randomUUID(),reason:'Appeal upheld'},now+60);
  assert.equal((await executeQueuedSanction(db,api.discord,config,owner,unban.caseId)).status,'applied');
  assert.equal(api.bans.size,0);
  assert.equal((await moderationWorkspace(db,owner,userId)).cases.find(c=>c.id===ban.caseId).sanction_status,'superseded');
  const before=api.operations.filter(x=>x.method==='DELETE'&&x.path.includes('/bans/')).length;
  assert.equal((await expireModerationSanction(db,api.discord,config,ban.caseId,now+50*60000)).changed,false);
  assert.equal(api.operations.filter(x=>x.method==='DELETE'&&x.path.includes('/bans/')).length,before);
});
test('unconfirmed network results stay needs-review; no automatic replay of a potentially punitive operation',async t=>{
  const db=await fresh(t),api=fakeDiscord();
  const entry=await queueSanction(db,api.discord,config,owner,{
    action:'kick',targetId:userId,receipt:randomUUID(),reason:'Manual removal'});
  api.setFault(true);
  assert.equal((await executeQueuedSanction(db,api.discord,config,owner,entry.caseId)).status,'needs-review');
  api.setFault(false);
  assert.equal((await executeQueuedSanction(db,api.discord,config,owner,entry.caseId)).applied,false);
  assert.equal(api.operations.filter(x=>x.method==='DELETE'&&x.path.includes('/members/'+userId)).length,1);
  assert.equal((await moderationWorkspace(db,owner,userId)).cases[0].sanction_status,'needs-review');
  assert.equal((await db.query('SELECT event FROM pc_mod_case_events WHERE case_id=$1 ORDER BY occurred_ms DESC',[entry.caseId]))
    .some(x=>x.event==='delivery-unconfirmed'),true);
});
test('restart detects orphaned applying actions without retrying a punitive call',async t=>{
  const db=await fresh(t),api=fakeDiscord(),now=Date.now();
  const queued=await queueSanction(db,api.discord,config,admin,{
    action:'ban',targetId:userId,receipt:randomUUID(),minutes:30},now-200000);
  await db.query("UPDATE pc_mod_sanctions SET status='applying',updated_ms=$1 WHERE case_id=$2",
    [now-180000,queued.caseId]);
  await initialize(db,guild);
  assert.equal(await reconcileUnconfirmedSanctions(db,now),1);
  assert.equal(await reconcileUnconfirmedSanctions(db,now+1000),0);
  const report=await moderationWorkspace(db,owner,userId);
  assert.equal(report.cases[0].sanction_status,'needs-review');
  assert.equal(api.operations.filter(x=>['PUT','PATCH','DELETE'].includes(x.method)).length,0);
  const [event]=await db.query("SELECT COUNT(*) AS n FROM pc_mod_case_events WHERE case_id=$1 AND event='delivery-unconfirmed'",[queued.caseId]);
  assert.equal(Number(event.n),1);
});
test('five warning threshold stays review-only even after sanctioned members use explicit actions',async t=>{
  const db=await fresh(t),api=fakeDiscord();
  for(let i=0;i<5;i++)await recordCase(db,admin,'warn',userId,'warning-'+i,'Issue '+i);
  assert.equal(await activeWarnings(db,userId),5);
  const sanctions=await db.query('SELECT * FROM pc_mod_sanctions');
  assert.equal(sanctions.length,0);
  assert.equal(api.operations.filter(x=>['PUT','PATCH','DELETE'].includes(x.method)).length,0);
  const spaces=await moderationWorkspace(db,admin,userId,1);
  assert.equal(spaces.cases.length,5);
  await assert.rejects(moderationWorkspace(db,helper,userId),{status:403});
});
test('Discord command descriptions advertise supported manual sanctions',()=>{
  const spec=operationCommands().find(x=>x.name==='mod')!;
  const opts=spec.options.map((o:any)=>o.name);
  for(const action of ['timeout','untimeout','kick','ban','unban','apply','warn','history','remove-warning'])
    assert.ok(opts.includes(action));
});
test('PostgreSQL concurrent sanction receipts remain one case and do not double-apply',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='sanctions_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const api=fakeDiscord(),receipt=randomUUID();
  const results=await Promise.all(Array.from({length:6},()=>queueSanction(db,api.discord,config,admin,
    {action:'timeout',targetId:userId,receipt,minutes:15})));
  assert.equal(results.filter(x=>x.created).length,1);
  await Promise.all(Array.from({length:6},()=>executeQueuedSanction(db,api.discord,config,admin,results[0].caseId)));
  assert.equal(api.operations.filter(x=>x.method==='PATCH').length,1);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM pc_mod_sanctions"))[0].n),1);
});
