import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {replyProfile,replyLength,meaningfulWords} from '../src/npc-prose.ts';
import {npcCompletion} from '../src/npc-ai.ts';
import type {Scene} from '../src/npc-voice.ts';

const character=(name:string,index:number,text:string)=>({writer:'11111111111111111'+index,characterId:randomUUID(),name,text,source:String(index)});
const scene=(...texts:string[]):Scene=>({
  id:randomUUID(),channel:'1350000000000000001',host:'111111111111111111',npc:randomUUID(),title:'King Azurik',
  mode:'open',ai:true,memory:'test',cast:[],turn:0,round:1,form:'',opening:'',
  posts:texts.map((s,i)=>character('Player '+i,i,s)),past:[]});
const natural=(n:number)=>Array.from({length:n},(_,i)=>['A','traveler','from','another','world','approaches','the','king','carefully','to','explain','a','strange','phenomenon','that','occurred','during','their','latest','journey','and','asks','what','he','thinks','about','its','effects','on','the','nearby','town','before','making','any','decision'][i%36]).join(' ');
test('short meaningful post targets one or two paragraphs and spam never inflates the target',()=>{
  const hello=replyProfile(scene('"Good evening, your majesty."'));
  assert.deepEqual([hello.depth,hello.minParagraphs,hello.maxParagraphs,hello.targetWords],['brief',1,2,60]);
  assert.equal(replyLength(scene('hi')),60);
  assert.equal(meaningfulWords('abc'.repeat(850)),0);
  const junk=replyProfile(scene('a '.repeat(350),'b '.repeat(190)));
  assert.equal(junk.depth,'brief');
  assert.equal(junk.unintelligiblePosts,2);
  assert.equal(junk.targetWords,60);
});
test('conversational, detailed, and immersive writing gets progressively more substantial responses',()=>{
  const medium=replyProfile(scene(natural(50)));
  assert.equal(medium.depth,'conversational');
  assert.deepEqual([medium.minParagraphs,medium.maxParagraphs],[2,3]);
  const detailed=replyProfile(scene(natural(125)));
  assert.equal(detailed.depth,'detailed');
  assert.deepEqual([detailed.minParagraphs,detailed.maxParagraphs],[4,5]);
  const immersive=replyProfile(scene(natural(245)));
  assert.equal(immersive.depth,'immersive');
  assert.deepEqual([immersive.minParagraphs,immersive.maxParagraphs],[4,6]);
  assert.ok(immersive.targetWords>detailed.targetWords&&detailed.targetWords>medium.targetWords);
});
test('multiple substantial character posts contribute to one scene without mere spam dominating',()=>{
  const aggregate=replyProfile(scene(natural(70),natural(115)));
  assert.equal(aggregate.depth,'detailed');
  const mixed=replyProfile(scene(natural(100),'z '.repeat(250)));
  assert.equal(mixed.depth,'detailed');
  const onlyGibberish=replyProfile(scene('pasjcp;jancbasjcb;'.repeat(120)));
  assert.equal(onlyGibberish.depth,'brief');
});
test('all model providers receive an input-dependent token limit without more keys or paid features',async()=>{
  const config:any={provider:'groq',key:'fixture',model:'openai/gpt-oss-120b',cap:20};
  const limits:number[]=[];
  for(const target of [60,165,330,420]){
    const result=await npcCompletion(config,'Roleplay only',{currentRound:[]},target,async(url:any,init:any)=>{
      assert.match(String(url),/api.groq.com/);
      const body=JSON.parse(init.body);
      limits.push(body.max_tokens);
      return Response.json({choices:[{message:{content:'Azurik follows the conversation naturally.'},finish_reason:'stop'}]});
    });
    assert.ok(result);
  }
  assert.equal(limits.length,4);
  assert.ok(limits.every((v,i)=>i===0||v>limits[i-1]));
  assert.ok(limits.at(-1)!>=1800);
  assert.ok(limits[0]<=300);
});
