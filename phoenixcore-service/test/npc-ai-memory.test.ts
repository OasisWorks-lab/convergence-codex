import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,initialize} from '../src/db.ts';
import {aiOptions,npcCompletion} from '../src/npc-ai.ts';
import {writeEncounters,remembered,clearPair,clearScene} from '../src/npc-memory.ts';
import {sceneInteraction} from '../src/npc-scenes.ts';
import {narrate,type Scene} from '../src/npc-voice.ts';
import {azurikId,loadNpc,seedAzurik} from '../src/npc-catalog.ts';

const guild='950522987646418964',owner='110000000000000001',writer='110000000000000002',other='110000000000000003';
const thread='130000000000000001';
const config:any={owner,guild,clientId:'110000000000000020',service:'https://service.example',dashboard:'https://codex.example/phoenixcore/',token:'test',publicKey:'',clientSecret:''};
const scene=(characterId:string,memory:'story'|'test'='story'):Scene=>({
 id:randomUUID(),channel:thread,host:writer,npc:azurikId,title:'King Azurik',mode:'open',ai:true,memory,
 cast:[{id:writer,name:'Rin',characterId}],round:1,turn:1,form:'',opening:'',
 posts:[{writer,name:'Rin',characterId,text:'My name is Rin. I bring news of a new bridge.',source:randomUUID()}],past:[]});
async function prepare(t:any){
 const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);await seedAzurik(db,owner);
 const a=randomUUID(),b=randomUUID();
 for(const [id,ownerId,name] of [[a,writer,'Rin'],[b,other,'Sola']])
   await db.query('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3)',[id,ownerId,JSON.stringify({name,characterType:'OC',bpl:'1000',wallet:'0'})]);
 return {db,a,b};
}
test('story-scene encounters survive scene cancellation, are character-scoped and idempotent; test scenes never persist',async t=>{
 const {db,a,b}=await prepare(t),s=scene(a);
 await db.transaction(async q=>{await writeEncounters(q,s,'Azurik nods at the introduction. “I am listening.”');await writeEncounters(q,s,'Azurik nods at the introduction. “I am listening.”');});
 const first=(await remembered(db,azurikId,[a,b]))[a];assert.equal(first.length,1);
 assert.match(first[0].spoken,/My name is Rin/);
 assert.equal((await remembered(db,azurikId,[a,b]))[b].length,0);
 await db.query('INSERT INTO pc_rp_scenes(channel_id,scene_id,state) VALUES($1,$2,$3)',[thread,s.id,JSON.stringify(s)]);
 await db.query('DELETE FROM pc_rp_scenes WHERE scene_id=$1',[s.id]);
 assert.equal((await remembered(db,azurikId,[a]))[a].length,1);
 const noSave=scene(b,'test');await db.transaction(q=>writeEncounters(q,noSave,'NPC answers a test.'));
 assert.equal((await remembered(db,azurikId,[b]))[b].length,0);
 assert.equal(await db.transaction(q=>clearScene(q,noSave.id)),0);
 assert.equal(await db.transaction(q=>clearPair(q,azurikId,a)),1);
 assert.equal((await remembered(db,azurikId,[a]))[a].length,0);
});
test('the first introduction survives after many later exchanges without mixing another character',async t=>{
  const {db,a,b}=await prepare(t);
  const s=scene(a,'story');
  for(let round=1;round<=12;round++){
    s.round=round;s.posts[0].text=round===1?'My name is Rin. I am here to introduce myself.':'I returned to discuss day '+round+'.';
    await db.transaction(q=>writeEncounters(q,s,'Azurik responds about day '+round+'.',1000+round));
  }
  const history=await remembered(db,azurikId,[a,b],5);
  assert.equal(history[a].length,5);
  assert.match(history[a][0].spoken,/My name is Rin/);
  assert.match(history[a].at(-1)!.spoken,/day 12/);
  assert.deepEqual(history[b],[]);
});

test('OpenAI and Gemini configurations use independent provider credentials and respect reply caps',async()=>{
 const cap='5',text='Azurik raises an eyebrow, then listens without interrupting. “A bridge, you say? Tell me what happened there and what you saw yourself.”';
 const open=aiOptions({PHOENIX_NPC_OPENAI_KEY:'open-private',PHOENIX_NPC_AI_DAILY_REPLIES:cap} as NodeJS.ProcessEnv)!;
 assert.equal(open.provider,'openai');assert.equal(open.model,'gpt-4.1-mini');
 const o=await npcCompletion(open,'Roleplay as Azurik',{currentRound:[]},60,async(url:any,init:any)=>{
   assert.match(String(url),/api.openai.com\/v1\/responses/);
   assert.equal(init.headers.Authorization,'Bearer open-private');
   const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.instructions,'Roleplay as Azurik');
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});
 });
 assert.equal(o,text);
 const gem=aiOptions({PHOENIX_NPC_AI_PROVIDER:'gemini',PHOENIX_NPC_GEMINI_KEY:'gem-private',PHOENIX_NPC_AI_DAILY_REPLIES:cap} as NodeJS.ProcessEnv)!;
 assert.equal(gem.model,'gemini-2.5-flash');
 const g=await npcCompletion(gem,'Roleplay as Azurik',{currentRound:[]},60,async(url:any,init:any)=>{
   assert.match(String(url),/generativelanguage.googleapis.com\/v1beta\/models\/gemini-2.5-flash:generateContent/);
   assert.equal(init.headers['x-goog-api-key'],'gem-private');
   const body=JSON.parse(init.body);assert.equal(body.systemInstruction.parts[0].text,'Roleplay as Azurik');
   assert.equal(body.contents[0].role,'user');
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
 });
 assert.equal(g,text);
 assert.equal(await npcCompletion(gem,'x',{},10,async()=>Response.json({candidates:[{finishReason:'SAFETY',content:{parts:[{text}]}}]})),null);
 assert.equal(aiOptions({PHOENIX_NPC_GEMINI_KEY:'key'} as NodeJS.ProcessEnv),null);
 assert.equal(aiOptions({PHOENIX_NPC_GEMINI_KEY:'key',PHOENIX_NPC_AI_DAILY_REPLIES:'0'} as NodeJS.ProcessEnv),null);
});
test('real AI sees verified story memory only, never test memory, even when the same character and NPC meet again',async t=>{
 const {db,a}=await prepare(t);
 const first=scene(a,'story');await db.transaction(q=>writeEncounters(q,first,'Azurik promised to check the bridge.'));
 const keys=['PHOENIX_NPC_AI_PROVIDER','PHOENIX_NPC_OPENAI_KEY','PHOENIX_NPC_OPENAI_MODEL','PHOENIX_NPC_AI_DAILY_REPLIES'];
 const values=keys.map(k=>process.env[k]);t.after(()=>keys.forEach((k,i)=>{if(values[i]===undefined)delete process.env[k];else process.env[k]=values[i];}));
 Object.assign(process.env,{PHOENIX_NPC_AI_PROVIDER:'openai',PHOENIX_NPC_OPENAI_KEY:'fixture',PHOENIX_NPC_OPENAI_MODEL:'test-model',PHOENIX_NPC_AI_DAILY_REPLIES:'12'});
 const sheet=await loadNpc(db.query,azurikId);
 let received:any;
 const fake=async(_url:any,init:any)=>{received=JSON.parse(JSON.parse(init.body).input);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'“I remember our discussion about the bridge,” Azurik says. “You told me there was work to do, and I asked that we examine it carefully.”'}]}]});};
 const follow=scene(a,'story');follow.posts[0].text='Hello again.';
 assert.equal((await narrate(db,follow,sheet,fake as any)).source,'AI');
 assert.match(JSON.stringify(received.verifiedMemories),/bridge/);
 assert.doesNotMatch(JSON.stringify(received),new RegExp(writer));
 const testing=scene(a,'test');testing.posts[0].text='Hello from a temporary scene.';
 await narrate(db,testing,sheet,fake as any);
 assert.deepEqual(received.verifiedMemories,[]);
 assert.equal((await remembered(db,azurikId,[a]))[a].length,1);
});
test('only the owner can delete NPC memory; owner can erase a scene as it is cancelled',async t=>{
 const {db,a}=await prepare(t),s=scene(a);
 await db.transaction(q=>writeEncounters(q,s,'Azurik offers a handshake.'));
 const interaction=(actor:string,command:string,options:any[])=>({
   type:2,id:randomUUID(),guild_id:guild,channel_id:thread,
   member:{user:{id:actor,username:'Writer'},roles:[],permissions:'0'},data:{name:command,options}});
 const options=[{name:'npc',value:azurikId},{name:'character',value:a}];
 const normal=await sceneInteraction(db,config,interaction(writer,'roleplay-memory',[...options,{name:'action',value:'forget'}]),undefined,{} as any);
 assert.match(normal.data.content,/Only the owner/);
 const view=await sceneInteraction(db,config,interaction(writer,'roleplay-memory',options),undefined,{} as any);
 assert.match(view.data.content,/Remembered story encounters/);
 const clear=await sceneInteraction(db,config,interaction(owner,'roleplay-memory',[...options,{name:'action',value:'forget'}]),undefined,{} as any);
 assert.match(clear.data.content,/Erased 1 stored/);
 await db.transaction(q=>writeEncounters(q,s,'Azurik offers a handshake.'));
 await db.query('INSERT INTO pc_rp_scenes(channel_id,scene_id,state) VALUES($1,$2,$3)',[thread,s.id,JSON.stringify(s)]);
 const cancel=await sceneInteraction(db,config,interaction(owner,'roleplay-cancel',[{name:'forget',value:true}]),undefined,{} as any);
 assert.match(cancel.data.content,/saved encounters were erased/);
 assert.equal((await remembered(db,azurikId,[a]))[a].length,0);
});
