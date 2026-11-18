import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialize,openSqlite,defaultSettings,type Store} from '../src/db.ts';
import {actorFor,propose,decide,judgeTraining,readSettings,saveSettings} from '../src/domain.ts';
import {Discord,deliverNext,type Config} from '../src/discord.ts';
import {playerThread,provisionNext} from '../src/forum-threads.ts';
import {relay,savePosting} from '../src/posting.ts';
import {ReviewFixture} from './review-fixture.ts';
import forms from '../../phoenixcore/templates.js';

const config:Config={owner:'710000000000000001',guild:'710000000000000002',clientId:'710000000000000003',token:'test',publicKey:'',clientSecret:'',service:'https://service.example',dashboard:'https://codex.example/'};
const player='710000000000000004',other='710000000000000005';
const owner=actorFor(config.owner,[],config.owner,defaultSettings),writer=actorFor(player,[],config.owner,defaultSettings);
const active=new Set([player,other,config.owner]);
const character=(name:string,tag='')=>({kind:'create',id:randomUUID(),reason:'New character',fields:{name,tag,bpl:'100',strengths:'One\nTwo\nThree',weaknesses:'Four\nFive\nSix'}});
async function submitted(db:Store,name:string,tag=''){
  return propose(db,writer,character(name,tag),active);
}
async function settle(db:Store,discord:Discord,now=Date.now()){
  for(let i=0;i<20;i++)if(!await deliverNext(db,discord,now))return;
  assert.fail('The delivery queue did not settle');
}
async function setup(t:any){
  const db=openSqlite(':memory:'),fixture=new ReviewFixture(config);t.after(()=>db.close());
  await initialize(db,config.guild);return {db,fixture,discord:new Discord(config,fixture.fetch)};
}
test('one approved-player forum post across two OCs, renames and restart; updates, training, and decisions stay together',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'oc-forum-')),file=join(dir,'test.sqlite');
  let db=openSqlite(file);const fixture=new ReviewFixture(config),discord=new Discord(config,fixture.fetch);
  t.after(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});
  await initialize(db,config.guild);
  const a=await submitted(db,'Rin'),b=await submitted(db,'Sol');
  await settle(db,discord);
  assert.deepEqual(fixture.cards.map(c=>c.channel),[defaultSettings.characterChannel,defaultSettings.characterChannel]);
  assert.equal(await provisionNext(db,discord,defaultSettings.updatesForum),false);
  await decide(db,config.owner,config.owner,a.id,false);
  assert.equal(await provisionNext(db,discord,defaultSettings.updatesForum),false);
  await decide(db,config.owner,config.owner,b.id,true);
  const [first,second]=await Promise.all([provisionNext(db,discord,defaultSettings.updatesForum),provisionNext(db,discord,defaultSettings.updatesForum)]);
  assert.ok(first||second);
  const [binding]=await db.query('SELECT * FROM pc_forum_threads');
  const thread=fixture.channels.get(binding.thread_id);
  assert.equal(thread.name,"emberquill's OC Updates");assert.equal(thread.parent_id,defaultSettings.updatesForum);
  await settle(db,discord);
  assert.equal(fixture.cards.findLast(c=>c.body.embeds[0].title.includes('Rin'))?.body.content,'Declined');
  await db.close();db=openSqlite(file);await initialize(db,config.guild);
  fixture.names.set(player,'newname');
  const c=await submitted(db,'Mira');await decide(db,config.owner,config.owner,c.id,true);await settle(db,discord);
  assert.equal(await provisionNext(db,discord,defaultSettings.updatesForum),false);
  const edit=await propose(db,writer,{id:randomUUID(),kind:'edit',characterId:b.id,version:1,fields:{bio:'Second arc'},reason:'Lore'},active);
  const training=await propose(db,writer,{id:randomUUID(),kind:'training',characterId:c.id,version:1,reason:'Scene',details:{location:'Earth',trainingType:'Solo',goals:'Focus',formula:'100 + 2',claimed:'+2 BPL'}},active);
  thread.thread_metadata.archived=true;await settle(db,discord);
  const card=(id:string)=>fixture.cards.findLast(c=>c.body.embeds[0].footer.text==='PhoenixCore request '+id)!;
  assert.equal(card(edit.id).channel,thread.id);assert.equal(card(training.id).channel,thread.id);assert.equal(thread.thread_metadata.archived,false);
  const trainingMessage=card(training.id).id;
  assert.equal(card(training.id).body.components[0].components.some((b:any)=>b.label==='Approve'),false);
  await judgeTraining(db,owner,training.id,{award:{points:'2'},note:'Scene checked'},active);await settle(db,discord);
  assert.equal(card(training.id).id,trainingMessage);assert.equal(card(training.id).body.components[0].components[0].label,'Approve');
  await decide(db,config.owner,config.owner,training.id,true);await settle(db,discord);
  assert.equal(card(training.id).id,trainingMessage);assert.equal(card(training.id).body.content,'Approved');
  assert.equal((await db.query('SELECT id FROM pc_characters')).length,2);
  assert.equal(fixture.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/threads')).length,1);
  const personal=await playerThread(db,discord,defaultSettings.updatesForum,other,Date.now());
  assert.notEqual(personal,thread.id);
});

test('all designs and character applications use forum starter review cards and applied tags when required',async t=>{
  const {db,fixture,discord}=await setup(t);
  const forum=fixture.channels.get(defaultSettings.characterChannel);forum.type=15;forum.flags=16;
  forum.available_tags=[{id:'700000000000000099',name:'Staff',moderated:true},{id:'700000000000000098',name:'New Character',moderated:false}];
  const a=await submitted(db,'Rin');await deliverNext(db,discord);
  const starter=fixture.calls.find(c=>c.path==='/channels/'+forum.id+'/threads')!;
  assert.deepEqual(starter.body.applied_tags,['700000000000000098']);
  assert.equal(fixture.channels.get(fixture.cards[0].channel).parent_id,forum.id);
  assert.equal(fixture.cards[0].id,fixture.cards[0].channel);
  assert.equal(starter.body.message.components[0].components[0].custom_id,'pc:approve:'+a.id);
  const designs={technique:{name:'Step',techType:'SPT',description:'Step lightly',requirements:'Focus',drawbacks:'Fatigue'},item:{name:'Lens',description:'Glass',effects:'Light',drawbacks:'Fragile',currentInt:'8',requiredInt:'10'},race:{name:'Sky',bplRolls:'1d20',coreTraits:'Glide'},transformation:{name:'Flare',appearance:'Glow',description:'Focus',requirements:'Resolve',drawbacks:'Tiring',multiplier:'x2'}};
  for(const [kind,fields] of Object.entries(designs)){
    const r=await propose(db,writer,{id:randomUUID(),kind,fields,reason:'New design'},active);
    await deliverNext(db,discord);
    const card=fixture.cards.at(-1)!;assert.equal(fixture.channels.get(card.channel).parent_id,defaultSettings.designChannel);
    assert.equal(card.body.components[0].components[0].custom_id,'pc:approve:'+r.id);
  }
  assert.equal(fixture.calls.some(c=>c.path.startsWith('/users/')),false);
});

test('an uncertain Discord forum creation is recovered from its archived bot starter without duplicating it',async t=>{
  const {db,fixture}=await setup(t),forum=defaultSettings.updatesForum;
  const request=await submitted(db,'Rin');await decide(db,config.owner,config.owner,request.id,true);
  let fail=true;
  const discord=new Discord(config,async(url,init)=>{
    const result=await fixture.fetch(url,init);
    if(fail&&new URL(String(url)).pathname.endsWith('/threads')&&init?.method==='POST'){fail=false;throw Error('Lost response');}
    return result;
  });
  const now=Date.now();
  await provisionNext(db,discord,forum,now);
  const [created]=[...fixture.channels.values()].filter(t=>t.parent_id===forum);
  created.thread_metadata.archived=true;
  assert.equal((await db.query('SELECT thread_id FROM pc_forum_threads'))[0].thread_id,null);
  await provisionNext(db,discord,forum,now+20000);
  assert.equal((await db.query('SELECT thread_id FROM pc_forum_threads'))[0].thread_id,created.id);
  assert.equal(fixture.calls.filter(c=>c.path.endsWith('/threads')&&c.method==='POST').length,1);
});

test('preexisting sheets get a thread on demand, locked threads retry in place and deleted threads are replaced',async t=>{
  const {db,discord,fixture}=await setup(t),id=randomUUID(),forum=defaultSettings.updatesForum,now=Date.now();
  await db.query('INSERT INTO pc_characters VALUES($1,$2,1,$3)',[id,player,JSON.stringify({name:'Legacy',bpl:'5',wallet:'0',gear:[]})]);
  const edit=()=>propose(db,writer,{id:randomUUID(),kind:'edit',characterId:id,version:1,reason:'History',fields:{bio:'The sky burns.'}},active);
  await edit();await settle(db,discord,now);
  const original=fixture.channels.get(fixture.cards[0].channel);
  original.thread_metadata.locked=true;const second=await edit();await settle(db,discord,now+1);
  assert.equal((await db.query('SELECT notified FROM pc_requests WHERE id=$1',[second.id]))[0].notified,0);
  assert.equal(fixture.cards.length,1);
  fixture.channels.delete(original.id);await settle(db,discord,now+25000);
  assert.equal(fixture.cards.length,2);assert.notEqual(fixture.cards[1].channel,original.id);
  assert.equal((await db.query('SELECT thread_id FROM pc_forum_threads WHERE forum_id=$1',[forum]))[0].thread_id,fixture.cards[1].channel);
});

test('literal Unicode and overlapping tags preserve spelling, enforce word boundaries and strip only the selected prefix',async t=>{
  const {db}=await setup(t);const rp='740000000000000001';
  const a=await submitted(db,'Rin','Rin'),b=await submitted(db,'Phoenix','Rin Fire');
  for(const r of [a,b])await decide(db,config.owner,config.owner,r.id,true);
  const settings=await readSettings(db);await saveSettings(db,owner,{revision:settings.revision,value:{...settings.value,rpChannels:rp}});
  let seq=900000000000000000n;
  async function speak(content:string){let result;await relay(db,config,{id:String(++seq),guild:config.guild,channel:rp,roles:[],author:player,content},async msg=>{result=[msg.name,msg.content];return String(++seq);},async()=>{});return result;}
  assert.equal(await speak('Ringing bells.'),undefined);assert.equal(await speak('Rin Fire'),undefined);
  assert.deepEqual(await speak('RIN Hello'),['Rin','Hello']);assert.deepEqual(await speak('rin fire: Hello'),['Phoenix',': Hello']);
  for(const tag of ['[🔥]','🧙🏽‍♀️','Åsh✦','//','>','.*+?','鳳凰：']){
    await savePosting(db,writer,{kind:'tag',characterId:b.id,tag});
    assert.deepEqual(await speak(tag.normalize('NFD')+' The sky burns.'),['Phoenix','The sky burns.']);
  }
  await savePosting(db,writer,{kind:'tag',characterId:b.id,tag:'test-'});
  assert.deepEqual(await speak('test-> A blockquote'),['Phoenix','> A blockquote']);
  await assert.rejects(savePosting(db,writer,{kind:'tag',characterId:b.id,tag:'rIn'}),/already assigned/);
  assert.throws(()=>forms.normalizeTag('one\ntwo'));assert.throws(()=>forms.normalizeTag('x'.repeat(65)));
});

test('upgrading a prior installation routes pending DMs once, keeps completed history quiet and preserves legacy tag lookup',async t=>{
  const {db,discord,fixture}=await setup(t);
  const legacy=await submitted(db,'Before','old'),pending=await submitted(db,'New');
  await decide(db,config.owner,config.owner,legacy.id,true);
  await db.query('DELETE FROM pc_forum_threads');await db.query('DELETE FROM pc_review_posts');
  await db.query('UPDATE pc_requests SET notified=1');
  await db.query('DROP INDEX pc_tag_per_writer');await db.query('ALTER TABLE pc_post_tags DROP COLUMN tag_key');
  await initialize(db,config.guild);await settle(db,discord);await initialize(db,config.guild);await settle(db,discord);
  assert.deepEqual(fixture.cards.map(c=>c.body.embeds[0].footer.text),['PhoenixCore request '+pending.id]);
  assert.equal((await db.query('SELECT tag_key FROM pc_post_tags WHERE character_id=$1',[legacy.id]))[0].tag_key,'old');
  assert.equal((await db.query('SELECT * FROM pc_forum_threads')).length,0);
  await propose(db,writer,{id:randomUUID(),kind:'edit',characterId:legacy.id,version:1,fields:{tag:'[New]'},reason:'Posting tag'},active);
  await settle(db,discord);assert.equal(fixture.cards.length,1);
});
