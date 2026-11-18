import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,defaultSettings,type Store} from '../src/db.ts';
import {propose,decide,judgeTraining,actorFor,saveSettings,applyAward} from '../src/domain.ts';
import {Discord,deliverNext,type Config} from '../src/discord.ts';
import {savePosting,relay,lookupAuthor,preferences} from '../src/posting.ts';
import forms from '../../phoenixcore/templates.js';

const config:Config={owner:'300000000000000001',guild:'600000000000000001',clientId:'700000000000000001',service:'https://service.example',dashboard:'https://site.example/phoenixcore/',publicKey:'00'.repeat(32),token:'test',clientSecret:'test'};
const player='300000000000000042',other='300000000000000043',staff='300000000000000044',role='500000000000000001',channel='510000000000000001';
const settings={...defaultSettings,judgeRole:role,rpChannels:channel};
const owner=actorFor(config.owner,[],config.owner,settings),writer=actorFor(player,[],config.owner,settings),judge=actorFor(staff,[role],config.owner,settings),outsider=actorFor(other,[],config.owner,settings);
const active=new Set([player,other,staff,config.owner]);
const char={name:'Rin',bpl:'10000',strengths:'Patient\nLoyal\nBrave',weaknesses:'Proud\nReckless\nStubborn'};
const claim={location:'Sadala',trainingType:'Partnered',goals:'Control',boosts:'Weighted wraps',formula:'10,000 × 0.05 = 500',claimed:'+500 BPL and +2 Ki Control',scene:'https://discord.com/channels/'+config.guild+'/'+channel+'/520000000000000001'};
const submit=(kind:string,fields:any)=>({id:randomUUID(),kind,fields,reason:'Review the design.'});
async function fresh(t:any){const db=openSqlite(':memory:');await initialize(db,config.guild);t.after(()=>db.close());return db;}
async function character(db:Store,name='Rin'){
  const r=await propose(db,writer,submit('create',{...char,name}),active);
  await decide(db,owner.id,owner.id,r.id,true);return r.characterId;
}
async function sheet(db:Store,id:string){
  const [r]=await db.query('SELECT sheet,revision FROM pc_characters WHERE id=$1',[id]);return {...JSON.parse(r.sheet),revision:r.revision};
}
test('new OCs and NPCs validate personal traits and long bios while partial edits preserve legacy sheets',async t=>{
  const db=await fresh(t);
  for(const fields of [{...char,strengths:'Loyal\nloyal\nPatient'},{...char,weaknesses:'One\nTwo'},{...char,characterType:'Admin'}])
    await assert.rejects(propose(db,writer,submit('create',fields),active));
  const story='A memory.\n\n'.repeat(900).trim();
  const r=await propose(db,writer,submit('create',{...char,characterType:'NPC',bio:story,family:'A missing sister'}),active);
  await decide(db,owner.id,owner.id,r.id,true);assert.equal((await sheet(db,r.id)).bio,story);
  const legacy=randomUUID();await db.query('INSERT INTO pc_characters VALUES($1,$2,1,$3)',[legacy,player,JSON.stringify({name:'Legacy',bio:'Original history',bpl:'5',wallet:'3',gear:['Letter']})]);
  const edit=await propose(db,writer,{...submit('edit',{family:'Sister returned'}),characterId:legacy,version:1,details:{summary:'Family update',approval:'Add the relative'}},active);
  await decide(db,owner.id,owner.id,edit.id,true);
  const saved=await sheet(db,legacy);assert.equal(saved.bio,'Original history');assert.equal(saved.family,'Sister returned');assert.equal(saved.wallet,'3');
});
test('four design types become approved catalogue records without granting a sheet, gear or transformation',async t=>{
  const db=await fresh(t);
  const designs={
    technique:{name:'Step',techType:'SPT',description:'Shift Ki into the soles.',requirements:'Steady focus',drawbacks:'One use per scene'},
    item:{name:'Sightglass',description:'A survey lens',effects:'Read energy traces',drawbacks:'Clear skies only',currentInt:'8',requiredInt:'50',designNotes:'A mentor can assist.'},
    race:{name:'Cloudfolk',bplRolls:'2d20',coreTraits:'Glide\nCloud sense'},
    transformation:{name:'Lantern Heart',appearance:'A pale halo',description:'Resolve returns',requirements:'A vow',drawbacks:'Lasts one post',multiplier:'x2'}
  };
  for(const [kind,fields] of Object.entries(designs)){
    const r=await propose(db,writer,submit(kind,fields),active);assert.equal(r.status,'pending');
    await assert.rejects(decide(db,judge.id,owner.id,r.id,true),/Only the configured owner/);
    assert.equal((await decide(db,owner.id,owner.id,r.id,true)).status,'approved');
  }
  assert.equal((await db.query('SELECT * FROM pc_characters')).length,0);
  assert.equal((await db.query("SELECT id FROM pc_requests WHERE status='approved'")).length,4);
  assert.throws(()=>forms.normalize('race',{...designs.race,coreTraits:'A\nB\nC\nD\nE'}),/four|4/);
  assert.throws(()=>forms.normalize('technique',{...designs.technique,techType:'Other'}),/valid/);
  assert.throws(()=>forms.normalize('item',{...designs.item,requiredInt:'0'}),/whole/);
});
async function adjudicate(db:Store){
  const id=await character(db),sibling=await character(db,'Sola');
  const input={id:randomUUID(),kind:'training',characterId:id,version:1,details:claim,reason:'A finished scene'};
  await assert.rejects(propose(db,outsider,input,active),/your characters/);
  await assert.rejects(propose(db,writer,{...input,details:{...claim,scene:claim.scene.replace(config.guild,'600000000000000002')}},active),/in Convergence/);
  const r=await propose(db,writer,input,active);assert.equal(r.status,'awaiting_judge');
  await assert.rejects(decide(db,owner.id,owner.id,r.id,true),/judgment/);
  const sent:any[]=[];const discord=new Discord(config);discord.sendReview=async value=>{sent.push(value);};
  await deliverNext(db,discord);
  assert.ok(!sent[0].components[0].components.some((b:any)=>b.label==='Approve'));
  const award={points:'300',currency:'20',gear:['Notebook'],stats:[{name:'Ki Control',amount:'1'}]},judgment={award,note:'Verified the scene. Awarding 300 BPL and one control point.'};
  await assert.rejects(judgeTraining(db,writer,r.id,judgment,active),/training judge/);
  assert.equal((await judgeTraining(db,judge,r.id,judgment,active)).status,'pending');
  assert.equal((await judgeTraining(db,judge,r.id,judgment,active)).status,'pending');
  await deliverNext(db,discord);assert.notEqual(sent[0].nonce,sent[1].nonce);
  assert.equal((await sheet(db,id)).bpl,'10000');
  const final=await decide(db,owner.id,owner.id,r.id,true);assert.equal(final.details.claimed,claim.claimed);assert.equal(final.judgment.judgeId,staff);
  await decide(db,owner.id,owner.id,r.id,true);
  const a=await sheet(db,id),b=await sheet(db,sibling);
  assert.deepEqual([a.bpl,a.wallet,a.gear,a.progress,b.bpl,b.wallet,b.gear],['10300','20',['Notebook'],[{name:'Ki Control',amount:'1'}],'10000','0',[]]);
}
test('player training, staff judgment, two Discord notifications, exact owner-only award and isolated sibling wallet',async t=>adjudicate(await fresh(t)));
test('training that races a sheet update cannot overwrite a newer revision',async t=>{
  const db=await fresh(t),id=await character(db);
  const r=await propose(db,writer,{id:randomUUID(),kind:'training',characterId:id,version:1,details:claim,reason:'Training'},active);
  const edit=await propose(db,writer,{...submit('edit',{bio:'New arc'}),characterId:id,version:1},active);
  await decide(db,owner.id,owner.id,edit.id,true);
  assert.equal((await judgeTraining(db,judge,r.id,{award:{points:'10'},note:'Verified scene'},active)).status,'stale');
  assert.equal((await decide(db,owner.id,owner.id,r.id,true)).status,'stale');
  assert.equal((await sheet(db,id)).bpl,'10000');
  assert.throws(()=>applyAward(char,{percent:'1',points:'2'}),/either/);
});
test('tag overrides default for one message, OOC and unknown tags keep original, and only confirmed posts are removed',async t=>{
  const db=await fresh(t),rin=await character(db),sola=await character(db,'Sola');
  await saveSettings(db,owner,{revision:1,value:settings});
  await assert.rejects(savePosting(db,outsider,{kind:'tag',characterId:rin,tag:'rin'}),/your approved/);
  await savePosting(db,writer,{kind:'tag',characterId:rin,tag:'rin'});await savePosting(db,writer,{kind:'tag',characterId:sola,tag:'sola'});
  await assert.rejects(savePosting(db,writer,{kind:'tag',characterId:sola,tag:'RIN'}),/already assigned/);
  assert.equal((await preferences(db,writer,settings)).tags.length,2);
  await savePosting(db,writer,{kind:'default',characterId:rin,channel});
  let seq=610000000000000000n,posts:any[]=[],removed=0;
  const incoming=(content:string)=>({id:String(++seq),content,guild:config.guild,channel,author:player,roles:[] as string[]});
  const send=async(post:any)=>{posts.push(post);return String(++seq);},remove=async()=>{removed++;};
  for(const content of ['Your move.','sola> Answer.','Again.','unknown> No.','// As myself.','((OOC))','sola>   '])await relay(db,config,incoming(content),send,remove);
  assert.deepEqual(posts.map(p=>[p.name,p.content]),[['Rin','Your move.'],['Sola','Answer.'],['Rin','Again.']]);assert.equal(removed,3);
  const once=incoming('rin> Once.');await Promise.all([relay(db,config,once,send,remove),relay(db,config,once,send,remove)]);
  assert.equal(posts.length,4);
  const [entry]=await db.query('SELECT posted_id FROM pc_posts WHERE source_id=$1',[once.id]);
  assert.equal((await lookupAuthor(db,judge,entry.posted_id)).authorId,player);
  await assert.rejects(lookupAuthor(db,writer,entry.posted_id),/Only staff/);
  await relay(db,config,{...incoming('No.'),guild:'600000000000000002'},send,remove);
  await relay(db,config,{...incoming('No.'),channel:'500000000000000002'},send,remove);
  await assert.rejects(relay(db,config,incoming('Keep this.'),async()=>{throw Error('unavailable');},remove));
  assert.equal(removed,4);
  await savePosting(db,writer,{kind:'default',characterId:'',channel});
  await relay(db,config,incoming('Now plain.'),send,remove);assert.equal(posts.length,4);
});
test('PostgreSQL training and notification transitions', {skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const db=await openPostgres(process.env.PHOENIX_TEST_DATABASE_URL!);t.after(()=>db.close());await initialize(db,config.guild);await adjudicate(db);
});
