import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,type Store} from '../src/db.ts';
import type {Actor} from '../src/domain.ts';
import {communitySetModule} from '../src/community.ts';
import {createPoll,editPoll,transitionPoll,advancePolls,votePoll,getPoll,listPolls,pollMessage,
  deliverPoll,pollAudit} from '../src/polls.ts';
import {pollCommands,pollInteraction,pollComponent} from '../src/poll-discord.ts';
import {DiscordFailure} from '../src/discord.ts';
const guild='960000000000000001',ownerId='960000000000000002',memberId='960000000000000003',
  altId='960000000000000004',channel='960000000000000005',role='960000000000000006',
  otherRole='960000000000000007',botId='960000000000000008',postedId='960000000000000009';
const config:any={guild,owner:ownerId,clientId:botId};
const owner:Actor={id:ownerId,isOwner:true,isJudge:true,isPlayer:true},
  member:Actor={id:memberId,isOwner:false,isJudge:false,isPlayer:true};
async function open(t:any){const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;}
const fixture=(input:any={})=>({receipt:randomUUID(),question:'Where should we hold the tournament?',
  description:'Vote on the next public Convergence arena.',choices:['Northern Training Field','Sky Dome','Forest Arena'],
  channelId:channel,mode:'single',anonymous:true,allowChange:true,resultsEarly:false,
  endsMs:Date.now()+3600000,color:0x4455aa,requiredRoles:[],excludedRoles:[],...input});
function fakeDiscord(){
  let blocked=false;
  const calls:any[]=[],posted:any[]=[],updated:any[]=[];
  const call=async(path:string,opts:any={})=>{
    calls.push({path,method:opts.method||'GET'});
    if(blocked)throw new DiscordFailure(503,2500);
    if(path==='/channels/'+channel+'/messages'){
      posted.push(JSON.parse(opts.body));return {id:postedId};
    }
    if(path==='/channels/'+channel+'/messages/'+postedId){
      updated.push(JSON.parse(opts.body));return {id:postedId};
    }
    if(path==='/channels/'+channel)return {id:channel,type:0,guild_id:guild};
    throw Error('Unexpected '+path);
  };
  return {call,calls,posted,updated,setBlocked:(v:boolean)=>blocked=v};
}
test('draft polls are Owner-created, immutable after publishing and hidden from ordinary member lists',async t=>{
  const db=await open(t);
  await assert.rejects(createPoll(db,member,fixture()),{status:403});
  await assert.rejects(createPoll(db,owner,fixture({choices:['Same','same']})),{status:400});
  const input=fixture(),created=await createPoll(db,owner,input);
  assert.equal(created.created,true);
  assert.equal((await createPoll(db,owner,input)).created,false);
  assert.equal((await listPolls(db,member)).length,0);
  assert.equal((await listPolls(db,owner)).length,1);
  await assert.rejects(getPoll(db,created.id,member),{status:404});
  await assert.rejects(transitionPoll(db,member,created.id,1,'publish'),{status:403});
  const updated=await editPoll(db,owner,created.id,1,fixture({choices:['One','Two'],receipt:randomUUID()}));
  assert.equal(updated.revision,2);
  await assert.rejects(transitionPoll(db,owner,created.id,1,'publish'),{status:409});
  const launched=await transitionPoll(db,owner,created.id,2,'publish');
  assert.equal(launched.status,'active');
  await assert.rejects(editPoll(db,owner,created.id,3,fixture()),{status:409});
  await assert.rejects(transitionPoll(db,owner,created.id,3,'publish'),{status:409});
  assert.equal((await listPolls(db,member))[0].question,input.question);
  assert.equal((await pollAudit(db,owner,created.id)).length,3);
  await assert.rejects(pollAudit(db,member,created.id),{status:403});
});
test('published anonymous ballots dedupe retries, support user updates and do not reveal hidden results',async t=>{
  const db=await open(t),input=fixture(),created=await createPoll(db,owner,input),api=fakeDiscord();
  await transitionPoll(db,owner,created.id,1,'publish');
  assert.equal(await deliverPoll(db,api),true);
  assert.equal(api.posted.length,1);
  assert.equal(api.posted[0].enforce_nonce,true);
  assert.deepEqual(api.posted[0].allowed_mentions,{parse:[]});
  assert.equal(api.posted[0].components[0].components[0].custom_id,'pcpoll:'+created.id);
  const receipt=randomUUID();
  const first=await votePoll(db,created.id,memberId,[],['0'],receipt);
  assert.equal(first.changed,true);
  assert.equal((await votePoll(db,created.id,memberId,[],['0'],receipt)).replayed,true);
  await assert.rejects(votePoll(db,created.id,altId,[],['1'],receipt),{status:409});
  await votePoll(db,created.id,memberId,[],['2'],randomUUID());
  await votePoll(db,created.id,altId,[],['1'],randomUUID());
  const publicPoll=await getPoll(db,created.id,member);
  assert.equal(publicPoll.voters,2);assert.equal(publicPoll.counts,null);
  assert.deepEqual((await getPoll(db,created.id,owner)).counts,[0,1,1]);
  assert.equal(JSON.stringify(publicPoll).includes(memberId),false);
  assert.equal(JSON.stringify(publicPoll).includes(altId),false);
  assert.deepEqual(pollMessage(publicPoll).allowed_mentions,{parse:[]});
  await deliverPoll(db,api,Date.now()+10000);
  assert.equal(api.updated.length,1);
  assert.equal(api.updated[0].embeds[0].description.includes('1 (50%)'),false,
    'Closed-only totals must not leak into the public Discord post.');
  assert.equal(api.updated[0].embeds[0].description.includes('Results visible at close'),true);
  const closed=await transitionPoll(db,owner,created.id,(await getPoll(db,created.id,owner)).revision,'close');
  assert.equal(closed.status,'closed');
  const results=await getPoll(db,created.id,member);
  assert.deepEqual(results.counts,[0,1,1]);
  assert.equal((await advancePolls(db,Date.now()+10*3600000)),0);
  await assert.rejects(votePoll(db,created.id,memberId,[],['1'],randomUUID()),{status:409});
});
test('multi-answer polls enforce role restrictions and final ballots',async t=>{
  const db=await open(t);
  const p=await createPoll(db,owner,fixture({mode:'multiple',resultsEarly:true,allowChange:false,
    requiredRoles:[role],excludedRoles:[otherRole]}));
  await transitionPoll(db,owner,p.id,1,'publish');
  await assert.rejects(votePoll(db,p.id,memberId,[],['0'],randomUUID()),{status:403});
  await assert.rejects(votePoll(db,p.id,memberId,[role,otherRole],['0'],randomUUID()),{status:403});
  await assert.rejects(votePoll(db,p.id,memberId,[role],['0','0'],randomUUID()),{status:400});
  await assert.rejects(votePoll(db,p.id,memberId,[role],['3'],randomUUID()),{status:400});
  assert.equal((await votePoll(db,p.id,memberId,[role],['0','2'],randomUUID())).changed,true);
  await assert.rejects(votePoll(db,p.id,memberId,[role],['1'],randomUUID()),{status:409});
  assert.deepEqual((await getPoll(db,p.id,member)).counts,[1,0,1]);
  assert.equal((await getPoll(db,p.id,member)).voters,1);
});
test('timed poll closure and disabled module independently block voting while retaining records',async t=>{
  const db=await open(t),now=Date.now(),p=await createPoll(db,owner,
    fixture({endsMs:now+120000}),now);
  await transitionPoll(db,owner,p.id,1,'publish',now);
  assert.equal(await advancePolls(db,now+119000),0);
  assert.equal(await advancePolls(db,now+121000),1);
  assert.equal(await advancePolls(db,now+121000),0);
  assert.equal((await getPoll(db,p.id)).status,'closed');
  const audit=await pollAudit(db,owner,p.id);
  assert.equal(audit.filter(x=>x.event==='closed').length,1);
  const second=await createPoll(db,owner,fixture());
  await transitionPoll(db,owner,second.id,1,'publish');
  await communitySetModule(db,{id:ownerId,isOwner:true,isStaff:true},'polls',false);
  await assert.rejects(votePoll(db,second.id,memberId,[],['1'],randomUUID()),{status:403});
  assert.equal((await getPoll(db,second.id)).status,'active');
  assert.equal(pollMessage(await getPoll(db,second.id),false).components.length,0);
});
test('Discord slash commands and signed components operate on one immutable posted poll',async t=>{
  const db=await open(t),api=fakeDiscord();
  const sub=(action:string,opts:any[]=[],userId=ownerId)=>({type:2,id:randomUUID(),guild_id:guild,
    member:{user:{id:userId},roles:[]},data:{name:'poll',options:[{name:action,options:opts}]}});
  const opt=(name:string,value:any)=>({name,value});
  assert.ok(pollCommands()[0].options.some((o:any)=>o.name==='admin-create'));
  const bad=await pollInteraction(db,config,sub('admin-create',[],memberId),api as any);
  assert.match(bad.data.content,/Only the configured Convergence Owner/);
  const response=await pollInteraction(db,config,sub('admin-create',[
    opt('question','Training location?'),opt('options','Planetary Ring|Sky Arena'),
    opt('channel',channel),opt('minutes',60)]),api as any);
  assert.match(response.data.content,/Draft poll/);
  const [row]=await db.query('SELECT id,revision FROM pc_polls');
  const launch=await pollInteraction(db,config,sub('admin-publish',[opt('id',row.id),opt('revision',1)]),api as any);
  assert.match(launch.data.content,/active/);
  await deliverPoll(db,api);
  const ballot={type:3,id:randomUUID(),guild_id:guild,channel_id:channel,
    member:{user:{id:memberId},roles:[]},message:{id:postedId},
    data:{custom_id:'pcpoll:'+row.id,values:['1']}};
  const vote=await pollComponent(db,config,ballot);
  assert.match(vote.data.content,/recorded/);
  assert.equal((await pollComponent(db,config,ballot)).data.content,'Your earlier ballot was already saved.');
  const forgery=await pollComponent(db,config,{...ballot,channel_id:'960000000000000099',id:randomUUID()});
  assert.match(forgery.data.content,/no longer active/i);
  assert.equal((await getPoll(db,row.id)).voters,1);
});
test('failed Discord publication is retryable without changing saved outcomes',async t=>{
  const db=await open(t),api=fakeDiscord(),p=await createPoll(db,owner,fixture());
  await transitionPoll(db,owner,p.id,1,'publish');
  api.setBlocked(true);await deliverPoll(db,api);
  assert.equal((await getPoll(db,p.id,owner)).messageId,null);
  api.setBlocked(false);await deliverPoll(db,api,Date.now()+12000);
  assert.equal((await getPoll(db,p.id,owner)).messageId,postedId);
  assert.equal(api.posted.length,1);
});
test('PostgreSQL concurrent vote receipts cannot multiply ballots or lose members',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='polls_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const created=await createPoll(db,owner,fixture());
  await transitionPoll(db,owner,created.id,1,'publish');
  const receipt=randomUUID();
  const result=await Promise.all(Array.from({length:12},()=>votePoll(db,created.id,memberId,[],['0'],receipt)));
  assert.equal(result.filter(x=>x.changed).length,1);
  assert.equal((await getPoll(db,created.id,owner)).voters,1);
  await Promise.all(Array.from({length:10},(_,i)=>votePoll(db,created.id,
    '9700000000000000'+String(i).padStart(2,'0'),[],['1'],randomUUID())));
  assert.deepEqual((await getPoll(db,created.id,owner)).counts,[1,10,0]);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM pc_poll_receipts'))[0].n),11);
});
