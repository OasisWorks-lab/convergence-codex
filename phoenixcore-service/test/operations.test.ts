import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,type Store} from '../src/db.ts';
import {staffIdentity,requireModerator,verifyModerationTarget} from '../src/staff.ts';
import {recordCase,proxyEvidence,removeWarning,activeWarnings,moderationHistory,caseEvents} from '../src/moderation.ts';
import {createReminder,listReminders,cancelReminder,deliverScheduledJob} from '../src/jobs.ts';
import {operationCommands,operationInteraction} from '../src/operations-discord.ts';
import {DiscordFailure} from '../src/discord.ts';

const guild='950522987646418964',ownerId='110000000000000001',adminId='110000000000000002',memberId='110000000000000003',botId='110000000000000020',
  helperId='110000000000000004',helperRole='1100315893864603649',
  adminRole='120000000000000009',memberRole='120000000000000001',botRole='120000000000000012';
const config:any={guild,owner:ownerId,clientId:botId};
const owner=staffIdentity(ownerId,[],'0',config,helperRole),admin=staffIdentity(adminId,[adminRole],'8',config,helperRole),
  helper=staffIdentity(helperId,[helperRole],'0',config,helperRole),member=staffIdentity(memberId,[memberRole],'0',config,helperRole);
async function open(t:any){
  const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;
}
const fakeDiscord=(options:{actorRole?:number;targetRole?:number;botRole?:number;dmBlocked?:boolean}={})=>{
  const calls:string[]=[],messages:any[]=[];
  const call=async(path:string,init:any={})=>{
    calls.push(path);
    if(path==='/guilds/'+guild)return {id:guild,owner_id:ownerId};
    if(path==='/guilds/'+guild+'/roles')return [
      {id:adminRole,position:options.actorRole??10,permissions:'8'},
      {id:memberRole,position:options.targetRole??1,permissions:'0'},
      {id:botRole,position:options.botRole??15,permissions:'8'},
      {id:helperRole,position:3,permissions:'0'}];
    if(path==='/guilds/'+guild+'/members/'+adminId)return {user:{id:adminId},roles:[adminRole]};
    if(path==='/guilds/'+guild+'/members/'+ownerId)return {user:{id:ownerId},roles:[adminRole]};
    if(path==='/guilds/'+guild+'/members/'+helperId)return {user:{id:helperId},roles:[helperRole]};
    if(path==='/guilds/'+guild+'/members/'+memberId)return {user:{id:memberId,bot:false},roles:[memberRole]};
    if(path==='/guilds/'+guild+'/members/'+botId)return {user:{id:botId,bot:true},roles:[botRole]};
    if(path==='/users/@me/channels'){
      if(options.dmBlocked)throw new DiscordFailure(403,0,50007);
      return {id:'140000000000000001'};
    }
    if(path==='/channels/140000000000000001/messages'){
      messages.push(JSON.parse(init.body));return {id:'140000000000000002'};
    }
    throw Error('Unexpected Discord endpoint '+path);
  };
  return {call,calls,messages};
};
const cmd=(id:string,command:string,subcommand:string,opts:any[],perms='0',roles:string[]=[])=>({
  type:2,id:randomUUID(),application_id:botId,guild_id:guild,channel_id:'130000000000000001',
  member:{user:{id},permissions:perms,roles},
  data:{name:command,options:[{type:1,name:subcommand,options:opts}]}});
const opt=(name:string,value:any)=>({name,value});

test('owner/admin moderation authority is strictly separate from Helper support permissions',async()=>{
  assert.equal(owner.rank,'owner');assert.equal(admin.rank,'admin');
  assert.equal(helper.rank,'helper');assert.equal(helper.canModerate,false);
  assert.equal(member.rank,'member');assert.equal(member.canModerate,false);
  assert.throws(()=>requireModerator(helper),/Only the Convergence Owner or a Discord Administrator/);
  const discord=fakeDiscord();
  const verified=await verifyModerationTarget(discord as any,config,admin,memberId);
  assert.equal(verified.targetTop,1);
  assert.equal(verified.actorTop,10);
  await assert.rejects(verifyModerationTarget(discord as any,config,helper,memberId),/Owner or a Discord Administrator/);
  await assert.rejects(verifyModerationTarget(discord as any,config,admin,ownerId),/owner.*protected|owner and PhoenixCore/i);
  await assert.rejects(verifyModerationTarget(fakeDiscord({actorRole:1,targetRole:10}) as any,config,admin,memberId),/below your highest/);
  await assert.rejects(verifyModerationTarget(fakeDiscord({botRole:1,targetRole:2}) as any,config,admin,memberId),/bot role above/);
});

test('five active warnings trigger review without choosing a ban, timeout or other automatic sanction',async t=>{
  const db=await open(t);
  for(let i=0;i<5;i++){
    const receipt='warn-fixture-'+i;
    const result=await recordCase(db,admin,'warn',memberId,receipt,'Case '+i);
    assert.equal(result.activeWarnings,i+1);
    assert.equal(result.needsReview,i===4);
    assert.equal(result.created,true);
  }
  assert.equal(await activeWarnings(db,memberId),5);
  const [event]=await db.query("SELECT COUNT(*) AS n FROM pc_mod_case_events WHERE event='five-warning-review'");
  assert.equal(Number(event.n),1);
  const jobs=await db.query('SELECT job_type FROM pc_core_jobs');
  assert.equal(jobs.length,5);assert.ok(jobs.every(j=>j.job_type==='moderation-notice'));
  const existing=await recordCase(db,admin,'warn',memberId,'warn-fixture-4','Case 4');
  assert.equal(existing.created,false);assert.equal(await activeWarnings(db,memberId),5);
  const cases=await moderationHistory(db,admin,memberId);
  const removed=await removeWarning(db,admin,cases.cases[0].id);
  assert.equal(removed.changed,true);assert.equal(await activeWarnings(db,memberId),4);
  assert.equal((await removeWarning(db,admin,cases.cases[0].id)).changed,false);
  const evidence=await caseEvents(db,admin,cases.cases[0].id);
  assert.ok(evidence.events.some(e=>e.event==='warning-removed'));
  assert.ok(evidence.record.removed_by===adminId);
});

test('private staff notes remain private, require content and never generate punitive Discord jobs',async t=>{
  const db=await open(t),receipt=randomUUID();
  await assert.rejects(recordCase(db,admin,'note',memberId,receipt,''),/must contain 1/);
  const note=await recordCase(db,admin,'note',memberId,receipt,'Check suspicious invite link with context before taking action.');
  assert.equal(note.created,true);assert.equal(note.activeWarnings,0);
  assert.equal((await db.query('SELECT id FROM pc_core_jobs')).length,0);
  await assert.rejects(moderationHistory(db,helper,memberId),/Owner or a Discord Administrator/);
  const history=await moderationHistory(db,owner,memberId);
  assert.equal(history.cases[0].kind,'note');
  assert.match(history.cases[0].reason,/suspicious invite/);
});

test('moderating proxied RP posts uses the original user and stores the witnessed character attribution',async t=>{
  const db=await open(t),source='150000000000000001',posted='150000000000000002',oc=randomUUID();
  await db.query('INSERT INTO pc_posts(source_id,posted_id,channel_id,author_id,character_id,character_name,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [source,posted,'130000000000000001',memberId,oc,'Rin',Date.now()]);
  const evidence=await proxyEvidence(db,posted,memberId);
  assert.equal(evidence.sourceMessageId,source);assert.equal(evidence.postedMessageId,posted);
  assert.equal(evidence.characterId,oc);
  await assert.rejects(proxyEvidence(db,posted,adminId),/different Discord account/);
  await assert.rejects(proxyEvidence(db,'150000000000000099',memberId),/no verified original author/);
  const result=await recordCase(db,admin,'warn',memberId,randomUUID(),'Unwanted attack after consent withdrawn.',evidence);
  const history=await moderationHistory(db,owner,memberId);
  assert.equal(history.cases[0].id,result.caseId);
  assert.equal(history.cases[0].source_message_id,source);
  assert.equal(history.cases[0].character_id,oc);
  assert.equal(history.cases[0].target_id,undefined);
});

test('scheduled staff warning DMs survive restart, use nonce deduplication and handle disabled DMs',async t=>{
  const db=await open(t);
  const created=await recordCase(db,admin,'warn',memberId,randomUUID(),'Read the Convergence community guidelines.');
  await initialize(db,guild);
  const send=fakeDiscord();
  assert.equal(await deliverScheduledJob(db,send as any),true);
  assert.equal(await deliverScheduledJob(db,send as any),false);
  assert.equal(send.messages.length,1);
  assert.match(send.messages[0].content,/staff warning/);
  assert.match(send.messages[0].content,/Case:/);
  assert.equal(send.messages[0].enforce_nonce,true);
  assert.deepEqual(send.messages[0].allowed_mentions,{parse:[]});
  const [job]=await db.query('SELECT status,delivery_id FROM pc_core_jobs WHERE id=$1',['mod-notice:'+created.caseId]);
  assert.equal(job.status,'delivered');
  const blocked=await recordCase(db,admin,'warn',memberId,randomUUID(),'Another warning.');
  const fail=fakeDiscord({dmBlocked:true});
  assert.equal(await deliverScheduledJob(db,fail as any),true);
  const [blockedRow]=await db.query('SELECT status,attempts FROM pc_core_jobs WHERE id=$1',['mod-notice:'+blocked.caseId]);
  assert.equal(blockedRow.status,'undeliverable');
  assert.equal(Number(blockedRow.attempts),1);
});

test('cancellable private reminders persist and deduplicate user requests without touching other members',async t=>{
  const db=await open(t),now=Date.now(),receipt='reminder-receipt-1';
  const scheduled=await createReminder(db,memberId,receipt,60,'Check my character sheet before the next scene.',now);
  assert.equal(scheduled.created,true);
  assert.equal((await createReminder(db,memberId,receipt,60,'Repeat request',now)).created,false);
  assert.equal((await listReminders(db,memberId)).length,1);
  assert.equal((await listReminders(db,adminId)).length,0);
  assert.equal(await cancelReminder(db,adminId,scheduled.id),false);
  assert.equal(await cancelReminder(db,memberId,scheduled.id),true);
  assert.equal(await deliverScheduledJob(db,fakeDiscord() as any,now+61*60000),false);
  await assert.rejects(createReminder(db,memberId,randomUUID(),10081,'Too distant'),/7 days/);
  const follow=await createReminder(db,memberId,'reminder-receipt-2',1,'Pick up supplies.',now);
  await initialize(db,guild);
  const send=fakeDiscord();
  assert.equal(await deliverScheduledJob(db,send as any,now+61000),true);
  assert.match(send.messages[0].content,/Pick up supplies/);
  assert.equal((await db.query('SELECT status FROM pc_core_jobs WHERE id=$1',[follow.id]))[0].status,'delivered');
});

test('signed Discord commands enforce permissions and record warnings without ever punishing the webhook bot',async t=>{
  const db=await open(t),discord=fakeDiscord();
  const wrong=await operationInteraction(db,config,cmd(helperId,'mod','warn',[opt('member',memberId)],'0',[helperRole]),discord as any);
  assert.match(wrong.data.content,/Only the Convergence Owner or a Discord Administrator/);
  const warn=await operationInteraction(db,config,cmd(adminId,'mod','warn',[opt('member',memberId),opt('reason','Please keep RP civil.')],'8',[adminRole]),discord as any);
  assert.match(warn.data.content,/Warning recorded/);
  const reminders=await operationInteraction(db,config,cmd(memberId,'remind','me',[opt('minutes',2),opt('message','Time to return to RP.')]),discord as any);
  assert.match(reminders.data.content,/Reminder scheduled/);
  const inactive=await operationInteraction(db,config,cmd(helperId,'mod','history',[opt('member',memberId)],'0',[helperRole]),discord as any);
  assert.match(inactive.data.content,/Only the Convergence Owner or a Discord Administrator/);
  assert.ok(discord.calls.every(x=>!x.includes('/bans')&&!x.includes('/timeout')&&!x.includes('/kick')));
  assert.ok(operationCommands().some(c=>c.name==='mod'));
  assert.ok(operationCommands().some(c=>c.name==='remind'));
});

test('PostgreSQL moderation commands and queued job delivery stay idempotent across concurrent retries',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),adminDb=await openPostgres(url.href);
  const schema='mod_test_'+randomUUID().replaceAll('-','');
  await adminDb.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await adminDb.query('DROP SCHEMA '+schema+' CASCADE');await adminDb.close();});
  await initialize(db,guild);
  const receipt=randomUUID();
  const values=await Promise.all(Array.from({length:12},()=>recordCase(db,admin,'warn',memberId,receipt,'Only one warning.')));
  assert.equal(values.filter(x=>x.created).length,1);
  assert.equal(await activeWarnings(db,memberId),1);
  const send=fakeDiscord();
  await Promise.all(Array.from({length:12},()=>deliverScheduledJob(db,send as any)));
  assert.equal(send.messages.length,1);
  await Promise.all(Array.from({length:9},(_,i)=>recordCase(db,admin,'warn',memberId,'concurrent-'+i,'Parallel warning '+i)));
  assert.equal(await activeWarnings(db,memberId),10);
  const [threshold]=await db.query("SELECT COUNT(*) AS n FROM pc_mod_case_events WHERE event='five-warning-review'");
  assert.equal(Number(threshold.n),1);
  const reminders=await Promise.allSettled(Array.from({length:25},(_,i)=>createReminder(db,memberId,'bulk-'+i,60,'Check scene '+i)));
  assert.equal(reminders.filter(x=>x.status==='fulfilled').length,20);
  assert.equal((await listReminders(db,memberId)).length,20);
});
