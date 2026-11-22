import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiCandidates,aiOptions,npcCompletionResult} from '../src/npc-ai.ts';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {freeProviderStatus,reserveProvider,routeNpcReply,providerOutcome} from '../src/npc-ai-router.ts';
import {npcCommands,sceneCommand,sceneInteraction} from '../src/npc-scenes.ts';

const org='950522987646418964';
const env:NodeJS.ProcessEnv={
  PHOENIX_NPC_AI_PROVIDER:'gemini',PHOENIX_NPC_GEMINI_KEY:'gemini-private',
  PHOENIX_NPC_GROQ_KEY:'groq-private',PHOENIX_NPC_OPENROUTER_KEY:'router-private',
  PHOENIX_NPC_OPENAI_KEY:'an-unused-openai-key',PHOENIX_NPC_AI_DAILY_REPLIES:'300',
  PHOENIX_NPC_GEMINI_DAILY_REPLIES:'20',PHOENIX_NPC_GEMINI_LITE_DAILY_REPLIES:'30',
  PHOENIX_NPC_GROQ_DAILY_REPLIES:'100',PHOENIX_NPC_OPENROUTER_DAILY_REPLIES:'40'
};
async function sqlite(t:any){
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,org);return db;
}
test('free provider candidates are ordered, explicit, and cannot fallback to paid models or OpenAI',()=>{
  assert.equal(aiOptions(env)?.provider,'gemini');
  assert.deepEqual(aiCandidates(env).map(p=>p.provider+':'+p.model),[
    'gemini:gemini-2.5-flash','gemini:gemini-2.5-flash-lite',
    'groq:openai/gpt-oss-120b','openrouter:openrouter/free']);
  assert.equal(aiCandidates({...env,PHOENIX_NPC_OPENROUTER_MODEL:'anthropic/claude-sonnet-4'}).length,3);
  assert.equal(aiCandidates({...env,PHOENIX_NPC_AI_FREE_FALLBACKS:'groq'}).length,2);
  assert.equal(aiCandidates({...env,PHOENIX_NPC_AI_FREE_FALLBACKS:''}).length,1);
  assert.equal(aiCandidates({...env,PHOENIX_NPC_GROQ_KEY:'',PHOENIX_NPC_OPENROUTER_KEY:''}).length,2);
  assert.equal(aiCandidates({...env,PHOENIX_NPC_AI_DAILY_REPLIES:'0'}).length,0);
  assert.ok(sceneCommand('roleplay-ai-status'));
  assert.ok(npcCommands().some(c=>c.name==='roleplay-ai-status'));
});
test('Gemini daily exhaustion falls back to Flash-Lite, then current free Groq model',async t=>{
  const db=await sqlite(t),now=Date.now();const visited:string[]=[];
  const fetcher=async(url:any,init:any)=>{
    visited.push(String(url));const body=JSON.parse(init.body);
    if(String(url).includes('gemini-2.5-flash:generateContent'))
      return Response.json({error:{message:'GenerateRequestsPerDayPerProjectPerModel-FreeTier quota exceeded'}},{status:429});
    if(String(url).includes('gemini-2.5-flash-lite:generateContent'))
      return new Response('service busy',{status:503});
    assert.match(String(url),/api.groq.com\/openai\/v1\/chat\/completions/);
    assert.equal(body.model,'openai/gpt-oss-120b');
    return Response.json({choices:[{message:{content:'Azurik listens carefully and addresses the latest question rather than repeating his prior statement.'},finish_reason:'stop'}]});
  };
  const reply=await routeNpcReply(db,'Act as Azurik',{currentRound:[{text:'Hello'}]},65,()=>true,fetcher as any,env,now);
  assert.equal(reply?.provider,'groq');assert.equal(visited.length,3);
  const states=await freeProviderStatus(db,env,now);
  assert.deepEqual(states.map(x=>x.dailyUsed),[1,1,1,0]);
  assert.equal(states[0].lastStatus,'quota');assert.ok(states[0].retryAt>now);
  assert.equal(states[1].lastStatus,'unavailable');assert.ok(states[1].retryAt>now);
  await routeNpcReply(db,'Act as Azurik',{},65,()=>true,fetcher as any,env,now+2000);
  assert.equal(visited.length,4);
  const [entry]=await db.query('SELECT used FROM pc_npc_ai_usage WHERE day=$1',[new Date(now).toISOString().slice(0,10)]);
  assert.equal(entry,undefined);
  await initialize(db,org);
  assert.equal((await freeProviderStatus(db,env,now))[0].dailyUsed,1);
});
test('OpenRouter is the last free-model fallback and never selects a paid SKU',async t=>{
  const db=await sqlite(t),used:string[]=[];
  const fetcher=async(url:any,init:any)=>{
    used.push(String(url));const data=JSON.parse(init.body);
    if(!String(url).includes('openrouter.ai'))return new Response('Temporary outage',{status:503});
    assert.equal(data.model,'openrouter/free');
    assert.equal(init.headers.Authorization,'Bearer router-private');
    return Response.json({choices:[{message:{content:'Azurik nods. “I understand what you are asking. Let me consider the answer.”'},finish_reason:'stop'}]});
  };
  const result=await routeNpcReply(db,'Test',{},55,()=>true,fetcher as any,env);
  assert.equal(result?.provider,'openrouter');assert.equal(used.length,4);
  const invalid={provider:'openrouter',key:'fixture',model:'paid/model',cap:25};
  assert.equal((await npcCompletionResult(invalid as any,'Test',{},30,async()=>{throw Error('Should never reach network');})).status,'invalid');
});
test('all candidates unavailable returns cleanly, without retrying the same provider',async t=>{
  const db=await sqlite(t),visited:string[]=[];
  const result=await routeNpcReply(db,'Test',{},30,()=>true,async(url:any)=>{
    visited.push(String(url));return new Response('Unavailable',{status:503});
  },env);
  assert.equal(result,null);assert.equal(visited.length,4);
  assert.equal((await freeProviderStatus(db,env))[3].lastStatus,'unavailable');
});
test('API moderation refusal stops failover instead of trying other models to bypass a block',async t=>{
  const db=await sqlite(t),visited:string[]=[];
  const result=await routeNpcReply(db,'Test',{},30,()=>true,async(url:any)=>{
    visited.push(String(url));return Response.json({candidates:[{finishReason:'SAFETY'}]});
  },env);
  assert.equal(result,null);assert.equal(visited.length,1);
});
test('per-model minute and daily limits are atomic across simultaneous NPC turns and survive initialization',async t=>{
  const db=await sqlite(t),config={...aiCandidates(env)[2],daily:12,rpm:4};
  const now=Date.now();
  const results=await Promise.all(Array.from({length:30},()=>reserveProvider(db,config,now)));
  assert.equal(results.filter(Boolean).length,4);
  const stats=await freeProviderStatus(db,env,now);assert.equal(stats[2].dailyUsed,4);
  await initialize(db,org);
  assert.equal(await reserveProvider(db,config,now),false);
  assert.equal(await reserveProvider(db,config,now+60000),true);
  await providerOutcome(db,config,{status:'quota',daily:true,retryMs:86400000},now+60000);
  assert.equal(await reserveProvider(db,config,now+65000),false);
});
test('cooldowns cannot be cleared by a later successful parallel response',async t=>{
  const db=await sqlite(t),c=aiCandidates(env)[0],now=Date.now();
  assert.equal(await reserveProvider(db,c,now),true);
  await providerOutcome(db,c,{status:'quota',daily:true},now);
  await providerOutcome(db,c,{status:'ok',text:'Older successful response'},now+1);
  assert.equal(await reserveProvider(db,c,now+40000),false);
  assert.equal((await freeProviderStatus(db,env,now))[0].retryAt>now,true);
});
test('owner-only AI capacity command exposes model usage but never credentials',async t=>{
  const db=await sqlite(t),owner='110000000000000001',guest='110000000000000002';
  const config:any={owner,guild:org,clientId:'110000000000000020'};
  const input=(id:string)=>({type:2,id:randomUUID(),guild_id:org,channel_id:'130000000000000001',
    member:{user:{id,username:'Test'},roles:[],permissions:'0'},data:{name:'roleplay-ai-status',options:[]}});
  const denied=await sceneInteraction(db,config,input(guest),undefined,{} as any);
  assert.match(denied.data.content,/Only the server owner/);
  const allowed=await sceneInteraction(db,config,input(owner),undefined,{} as any);
  assert.match(allowed.data.content,/PhoenixCore NPC AI/);
  assert.doesNotMatch(allowed.data.content,/private/);
});
test('PostgreSQL provider reservations remain atomic across thirty simultaneous users',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),admin=await openPostgres(url.href);
  const schema='provider_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.close();});
  await initialize(db,org);
  const now=Date.now(),config={...aiCandidates(env)[2],rpm:5,daily:35};
  const results=await Promise.all(Array.from({length:30},()=>reserveProvider(db,config,now)));
  assert.equal(results.filter(Boolean).length,5);
  assert.equal((await freeProviderStatus(db,env,now))[2].dailyUsed,5);
});
