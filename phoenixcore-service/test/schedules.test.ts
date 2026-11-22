import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,type Store} from '../src/db.ts';
import type {Actor} from '../src/domain.ts';
import {DiscordFailure} from '../src/discord.ts';
import {communitySetModule} from '../src/community.ts';
import {createSchedule,editSchedule,transitionSchedule,listSchedules,scheduleDetail,
  deliverSchedule,recoverSchedule} from '../src/schedules.ts';
import {scheduleCommands,scheduleInteraction} from '../src/schedule-discord.ts';
const guild='980000000000000001',ownerId='980000000000000002',memberId='980000000000000003',
  channel='980000000000000004',role='980000000000000005',botId='980000000000000006';
const config:any={guild,owner:ownerId,clientId:botId};
const owner:Actor={id:ownerId,isOwner:true,isJudge:true,isPlayer:true},
  member:Actor={id:memberId,isOwner:false,isJudge:false,isPlayer:true};
async function open(t:any){const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;}
const inputs=(now=Date.now(),values:any={})=>({
  receipt:randomUUID(),name:'Weekly community report',kind:'announcement',
  channelId:channel,body:'Community RP reminder: the next scene is ready.',
  mentionRole:'',firstDueMs:now+60000,intervalMinutes:0,maxRuns:1,
  style:'text',color:5793266,imageUrl:'',...values
});
const fakeDiscord=()=>{
  const calls:any[]=[],messages:any[]=[];
  let fail=0;
  const call=async(path:string,options:any={})=>{
    calls.push({path,method:options.method||'GET'});
    if(path==='/channels/'+channel)return {guild_id:guild,id:channel,type:0};
    if(path==='/guilds/'+guild+'/roles')return [{id:role,name:'Bump notification'}];
    if(path==='/channels/'+channel+'/messages'){
      if(fail){const status=fail;fail=0;throw new DiscordFailure(status,status===429?5000:0);}
      const payload=JSON.parse(options.body);
      messages.push(payload);
      return {id:String(980000000000000040n+BigInt(messages.length))};
    }
    throw Error('Unexpected API endpoint '+path);
  };
  return {call,calls,messages,setFailure:(status:number)=>{fail=status;}};
};
test('only configured Owner can author schedules and publication is explicit',async t=>{
  const db=await open(t),now=Date.now();
  await assert.rejects(createSchedule(db,member,inputs(now)),{status:403});
  await assert.rejects(createSchedule(db,owner,inputs(now,{intervalMinutes:0,maxRuns:0})),{status:400});
  await assert.rejects(createSchedule(db,owner,inputs(now,{intervalMinutes:5,maxRuns:0})),{status:400});
  await assert.rejects(createSchedule(db,owner,inputs(now,{kind:'bump-reminder',style:'embed'})),{status:400});
  const input=inputs(now),p=await createSchedule(db,owner,input,now);
  assert.equal(p.created,true);assert.equal((await createSchedule(db,owner,input,now)).created,false);
  assert.equal((await listSchedules(db,owner))[0].status,'draft');
  await assert.rejects(listSchedules(db,member),{status:403});
  await assert.rejects(transitionSchedule(db,member,p.id,1,'publish'),{status:403});
  const modified=await editSchedule(db,owner,p.id,1,inputs(now,{name:'Community training update'}),now);
  assert.equal(modified.revision,2);
  await assert.rejects(transitionSchedule(db,owner,p.id,1,'publish'),{status:409});
  const published=await transitionSchedule(db,owner,p.id,2,'publish',now);
  assert.equal(published.status,'active');
  await assert.rejects(editSchedule(db,owner,p.id,3,inputs(now)),{status:409});
  assert.equal((await scheduleDetail(db,owner,p.id)).events.length,3);
});
test('one-time announcement sends once, uses strict no-mention policy and survives database restart',async t=>{
  const db=await open(t),now=Date.now(),api=fakeDiscord();
  const p=await createSchedule(db,owner,inputs(now),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  assert.equal(await deliverSchedule(db,api as any,config,now+59000),false);
  assert.equal(await deliverSchedule(db,api as any,config,now+61000),true);
  assert.equal(api.messages.length,1);
  assert.match(api.messages[0].content,/next scene is ready/);
  assert.equal(api.messages[0].enforce_nonce,true);
  assert.deepEqual(api.messages[0].allowed_mentions,{parse:[],roles:[]});
  await initialize(db,guild);
  assert.equal(await deliverSchedule(db,api as any,config,now+62000),false);
  const detail=await scheduleDetail(db,owner,p.id);
  assert.equal(detail.schedule.status,'completed');
  assert.equal(detail.schedule.sentCount,1);
  assert.equal(detail.deliveries[0].status,'delivered');
  assert.equal(detail.events.filter(x=>x.event==='delivered').length,1);
});
test('recurring bump reminders remind a person to bump DISBOARD and never call DISBOARD',async t=>{
  const db=await open(t),now=Date.now(),api=fakeDiscord();
  const p=await createSchedule(db,owner,inputs(now,{
    name:'Manual bump reminder',kind:'bump-reminder',body:'',
    intervalMinutes:120,maxRuns:2,mentionRole:role
  }),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  assert.equal(await deliverSchedule(db,api as any,config,now+61000),true);
  const content=api.messages[0].content;
  assert.match(content,/DISBOARD bump reminder/);
  assert.match(content,/does not bump DISBOARD automatically/);
  assert.match(content,new RegExp('<@&'+role+'>'));
  assert.deepEqual(api.messages[0].allowed_mentions,{parse:[],roles:[role]});
  const next=(await listSchedules(db,owner))[0].nextDueMs;
  assert.ok(next>now+61000);
  assert.equal(await deliverSchedule(db,api as any,config,next-1),false);
  assert.equal(await deliverSchedule(db,api as any,config,next+1000),true);
  assert.equal((await listSchedules(db,owner))[0].status,'completed');
  assert.equal(api.messages.length,2);
  assert.equal(api.calls.some(x=>x.path.toLowerCase().includes('disboard')),false);
  assert.equal(api.calls.filter(x=>x.method==='POST').length,2);
});
test('embed schedule honors configured role only and safely includes HTTPS artwork',async t=>{
  const db=await open(t),now=Date.now(),api=fakeDiscord();
  const p=await createSchedule(db,owner,inputs(now,{style:'embed',mentionRole:role,
    imageUrl:'https://example.com/event.png',color:12345}),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  await deliverSchedule(db,api as any,config,now+61000);
  assert.equal(api.messages[0].embeds[0].color,12345);
  assert.equal(api.messages[0].embeds[0].image.url,'https://example.com/event.png');
  assert.deepEqual(api.messages[0].allowed_mentions,{parse:[],roles:[role]});
  assert.equal(api.messages[0].content,'<@&'+role+'>');
});
test('Owner pause, resume and cancellation prevent surprise sends',async t=>{
  const db=await open(t),now=Date.now(),api=fakeDiscord();
  const p=await createSchedule(db,owner,inputs(now,{intervalMinutes:45,maxRuns:0}),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  await transitionSchedule(db,owner,p.id,2,'pause',now);
  assert.equal(await deliverSchedule(db,api as any,config,now+100000),false);
  await transitionSchedule(db,owner,p.id,3,'resume',now);
  await communitySetModule(db,{id:ownerId,isOwner:true,isStaff:true},'schedules',false);
  assert.equal(await deliverSchedule(db,api as any,config,now+100000),false);
  await communitySetModule(db,{id:ownerId,isOwner:true,isStaff:true},'schedules',true);
  assert.equal(await deliverSchedule(db,api as any,config,now+100000),true);
  const live=(await listSchedules(db,owner))[0];
  await transitionSchedule(db,owner,p.id,live.revision,'cancel',now+100001);
  assert.equal(await deliverSchedule(db,api as any,config,now+60*60000),false);
  assert.equal(api.messages.length,1);
});
test('unknown Discord outcomes pause for Owner recovery rather than retrying a possible duplicate',async t=>{
  const db=await open(t),now=Date.now(),api=fakeDiscord();
  const p=await createSchedule(db,owner,inputs(now,{intervalMinutes:60,maxRuns:3}),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  api.setFailure(503);
  assert.equal(await deliverSchedule(db,api as any,config,now+61000),true);
  let detail=await scheduleDetail(db,owner,p.id);
  assert.equal(detail.schedule.status,'paused');
  assert.equal(detail.schedule.pendingStatus,'needs-review');
  assert.equal(await deliverSchedule(db,api as any,config,now+120000),false);
  assert.equal(api.messages.length,0);
  await assert.rejects(transitionSchedule(db,owner,p.id,detail.schedule.revision,'resume'),{status:409});
  await recoverSchedule(db,owner,p.id,detail.schedule.revision,'skip',now+130000);
  detail=await scheduleDetail(db,owner,p.id);
  assert.equal(detail.schedule.status,'active');
  assert.equal(detail.schedule.sentCount,1);
  assert.equal(detail.deliveries[0].status,'skipped');
  assert.equal(api.messages.length,0);
  const next=detail.schedule.nextDueMs;
  assert.equal(await deliverSchedule(db,api as any,config,next+1000),true);
  assert.equal(api.messages.length,1);
  assert.equal((await scheduleDetail(db,owner,p.id)).schedule.sentCount,2);
});
test('429 rate limits are retried; expired in-flight leases become review-needed with no blind POST',async t=>{
  const db=await open(t),now=Date.now(),api=fakeDiscord();
  const p=await createSchedule(db,owner,inputs(now),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  api.setFailure(429);
  await deliverSchedule(db,api as any,config,now+61000);
  const first=await scheduleDetail(db,owner,p.id);
  assert.equal(first.schedule.status,'active');
  assert.equal(first.schedule.pendingStatus,'pending');
  await deliverSchedule(db,api as any,config,now+66000);
  assert.equal(api.messages.length,1);
  const second=await createSchedule(db,owner,inputs(now,{receipt:randomUUID()}),now);
  await transitionSchedule(db,owner,second.id,1,'publish',now);
  await db.query(`INSERT INTO pc_schedule_deliveries(id,schedule_id,occurrence,due_ms,status,attempts,retry_ms,lease,lease_until)
    VALUES($1,$2,1,$3,'pending',1,0,'crashed',$4)`,
    ['pcsched:'+second.id+':1',second.id,now+60000,now+60500]);
  assert.equal(await deliverSchedule(db,api as any,config,now+120000),true);
  const orphan=await scheduleDetail(db,owner,second.id);
  assert.equal(orphan.schedule.status,'paused');
  assert.equal(orphan.schedule.pendingStatus,'needs-review');
  assert.equal(api.messages.length,1);
});
test('Owner slash commands create drafts but cannot auto-bump or grant Member authoring',async t=>{
  const db=await open(t),api=fakeDiscord(),make=(id:string,action:string,options:any[])=>({
    type:2,id:randomUUID(),guild_id:guild,member:{user:{id},roles:[]},
    data:{name:'schedule',options:[{name:action,options}]}
  });
  const opt=(name:string,value:any)=>({name,value});
  assert.ok(scheduleCommands()[0].options.some((x:any)=>x.name==='admin-recover'));
  const controls=[opt('name','DISBOARD prompt'),opt('channel',channel),opt('delay',10),
    opt('interval',120),opt('runs',2),opt('kind','bump-reminder')];
  assert.match((await scheduleInteraction(db,config,make(memberId,'admin-create',controls),api as any)).data.content,/Only the configured/);
  const done=await scheduleInteraction(db,config,make(ownerId,'admin-create',controls),api as any);
  assert.match(done.data.content,/Schedule draft created/);
  assert.equal((await listSchedules(db,owner)).length,1);
  assert.equal(api.messages.length,0);
});
test('PostgreSQL concurrent scheduling workers post one occurrence only',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='schedule_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const now=Date.now(),api=fakeDiscord(),p=await createSchedule(db,owner,inputs(now),now);
  await transitionSchedule(db,owner,p.id,1,'publish',now);
  await Promise.all(Array.from({length:12},()=>deliverSchedule(db,api as any,config,now+61000)));
  assert.equal(api.messages.length,1);
  assert.equal((await scheduleDetail(db,owner,p.id)).schedule.sentCount,1);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM pc_schedule_deliveries WHERE schedule_id=$1',[p.id]))[0].n),1);
});
