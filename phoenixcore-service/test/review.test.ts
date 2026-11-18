import {ReviewFixture} from './review-fixture.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqlite,initialize,defaultSettings,type Store} from '../src/db.ts';
import {actorFor,propose,decide,readSettings,saveSettings,applyAward} from '../src/domain.ts';
import {Discord,deliverNext,handleInteraction,checkSignature,type Config} from '../src/discord.ts';

const gabe='300000000000000001',player='300000000000000002',judge='300000000000000003',altUser='300000000000000004',judgeRole='500000000000000001';
const guild='600000000000000001',app='700000000000000001';
const ids=new Set([gabe,player,judge,altUser]);
const actors=[gabe,player,judge,altUser].map(id=>actorFor(id,id===judge?[judgeRole]:[],gabe,{...defaultSettings,judgeRole}));
const [owner,writer,staff,other]=actors;
const config:Config={owner:gabe,guild,clientId:app,service:'https://service.example',dashboard:'https://codex.example/phoenixcore/',publicKey:'00'.repeat(32),clientSecret:'test',token:'test'};
const opening=(name='Rin')=>({id:randomUUID(),kind:'create',fields:{name,bpl:'10000',strengths:'Patient\nObservant\nLoyal',weaknesses:'Reckless\nDistrustful\nProud'},reason:'Opening sheet'});
async function fresh(t:any) {
  const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;
}
async function approved(db:Store,name='Rin'){
  const req=await propose(db,writer,opening(name),ids);await decide(db,gabe,gabe,req.id,true);return req.characterId;
}
test('new and edited sheets are proposed privately, and only the owner decides',async t=>{
  const db=await fresh(t),form=opening(),r=await propose(db,writer,form,ids);
  assert.equal((await db.query('SELECT * FROM pc_characters')).length,0);
  assert.equal((await propose(db,writer,form,ids)).id,r.id);
  await assert.rejects(propose(db,other,form,ids),/identifier/);
  await assert.rejects(decide(db,judge,gabe,r.id,true),/Only the configured owner/);
  await decide(db,gabe,gabe,r.id,true);
  const edit={id:randomUUID(),kind:'edit',characterId:r.characterId,version:1,fields:{speed:'Quick acceleration'},reason:'Training note'};
  await assert.rejects(propose(db,other,edit,ids),/your characters/);
  await assert.rejects(propose(db,writer,{...edit,fields:{wallet:'400'}},ids),/unsupported/);
  await assert.rejects(propose(db,writer,{...edit,fields:{portrait:'javascript:alert(1)'}},ids),/HTTPS image/);
  await assert.rejects(propose(db,writer,edit,new Set([player,judge].slice(1))),/current player/);
  const e=await propose(db,writer,edit,ids);
  assert.equal(JSON.parse((await db.query('SELECT sheet FROM pc_characters'))[0].sheet).speed,'');
  await decide(db,gabe,gabe,e.id,false);
  assert.equal((await decide(db,gabe,gabe,e.id,true)).status,'declined');
  assert.equal((await db.query('SELECT revision FROM pc_characters'))[0].revision,1);
});
test('a reviewed award credits exactly one character once; an older edit cannot erase it',async t=>{
  const db=await fresh(t),first=await approved(db),second=await approved(db,'Sola');
  const edit={id:randomUUID(),kind:'edit',characterId:first,version:1,fields:{bio:'A new line.'},reason:'Update'};
  const award={id:randomUUID(),kind:'award',characterId:first,version:1,award:{percent:'12.50',currency:'40',gear:['Scouter']},reason:'A finished spar'};
  await assert.rejects(propose(db,writer,award,ids),/training judge/);
  const [e,a]=await Promise.all([propose(db,writer,edit,ids),propose(db,staff,award,ids)]);
  assert.deepEqual(a.award,{percent:'12.50',gain:'1250',currency:'40',gear:['Scouter']});
  await Promise.all([decide(db,gabe,gabe,a.id,true),decide(db,gabe,gabe,a.id,true)]);
  assert.equal((await decide(db,gabe,gabe,e.id,true)).status,'stale');
  const rows=await db.query('SELECT * FROM pc_characters');
  const rin=JSON.parse(rows.find(r=>r.id===first)!.sheet),sola=JSON.parse(rows.find(r=>r.id===second)!.sheet);
  assert.deepEqual([rin.bpl,rin.wallet,rin.gear,sola.wallet,sola.gear],['11250','40',['Scouter'],'0',[]]);
  assert.equal(rows.find(r=>r.id===first)!.revision,2);
});
test('award math uses exact large integers and floors only the calculated gain',()=>{
  assert.equal(applyAward({bpl:'90071992547409931',wallet:'0',gear:[]},{percent:'0.01'}).award.gain,'9007199254740');
  assert.throws(()=>applyAward({bpl:'1',wallet:'0',gear:[]},{percent:'0.01'}),/whole-point/);
});
test('guild administrators and training judges cannot save bot settings; revision is audited',async t=>{
  const db=await fresh(t),input={revision:1,value:{...defaultSettings,judgeRole}};
  await assert.rejects(saveSettings(db,staff,input),/Only the configured owner/);
  await saveSettings(db,owner,input);
  assert.equal((await readSettings(db)).value.judgeRole,judgeRole);
  await assert.rejects(saveSettings(db,owner,input),/Reload/);
  assert.equal((await db.query('SELECT * FROM pc_settings_history')).length,1);
});
test('notifications retry from disk after restart and repeated Discord clicks keep the decision',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'phoenixcore-')),file=join(temp,'test.sqlite');let db=openSqlite(file);
  t.after(async()=>{await db.close();await rm(temp,{recursive:true,force:true});});
  await initialize(db,guild);
  const form=opening();await propose(db,writer,form,ids);
  const fixture=new ReviewFixture(config);let fail=true;
  const discord=new Discord(config,async(url,init)=>fail?Response.json({retry_after:20},{status:429}):fixture.fetch(url,init));
  const start=Date.now();
  await deliverNext(db,discord,start);await db.close();db=openSqlite(file);await initialize(db,guild);
  assert.equal(await deliverNext(db,discord,start+1000),false);
  fail=false;await deliverNext(db,discord,start+25000);
  const sends=fixture.cards.map(c=>c.body);
  assert.equal(sends.length,1);assert.equal(sends[0].allowed_mentions.roles[0],defaultSettings.judgeRole);
  assert.equal(sends[0].components[0].components[0].custom_id,'pc:approve:'+form.id);
  assert.equal(await deliverNext(db,discord,start+240000),false);
  const pressed={type:3,application_id:app,data:{custom_id:'pc:approve:'+form.id},user:{id:judge}};
  assert.equal((await handleInteraction(db,config,pressed)).type,4);
  pressed.user.id=gabe;
  assert.equal((await handleInteraction(db,config,{...pressed,guild_id:'900000000000000001'})).type,4);
  assert.equal((await handleInteraction(db,config,pressed)).type,7);
  assert.equal((await handleInteraction(db,config,pressed)).type,7);
  assert.equal((await db.query('SELECT revision FROM pc_characters'))[0].revision,1);
});
test('signatures cover the original body and are time-bound',()=>{
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),now=Date.now(),stamp=String(Math.floor(now/1000));
  const raw=Buffer.from('{"type":1}'),sig=sign(null,Buffer.concat([Buffer.from(stamp),raw]),privateKey).toString('hex');
  const key=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  assert.ok(checkSignature(raw,sig,stamp,key,now));
  assert.equal(checkSignature(Buffer.from('{"type":3}'),sig,stamp,key,now),false);
  assert.equal(checkSignature(raw,sig,stamp,key,now+400000),false);
});
test('the roster pages through 1,000-member boundaries and omits bot accounts',async()=>{
  const members=Array.from({length:1001},(_,i)=>({user:{id:String(800000000000000000n+BigInt(i)),username:'member'+i,bot:i===15},roles:[]}));
  let calls=0;
  const discord=new Discord(config,async url=>{calls++;const page=new URL(String(url)).searchParams.get('after')==='0'?members.slice(0,1000):members.slice(1000);return Response.json(page);});
  const roster=await discord.members();assert.equal(roster.length,1000);assert.ok(roster.some(m=>m.user.username==='member1000'));
  await discord.members();assert.equal(calls,2);
});
test('review routing verifies the destination guild before sending any review',async t=>{
  const db=await fresh(t),r=await propose(db,writer,opening(),ids),fixture=new ReviewFixture(config);
  fixture.channels.get(defaultSettings.characterChannel).guild_id='910000000000000001';
  await deliverNext(db,new Discord(config,fixture.fetch));
  assert.equal(fixture.cards.length,0);
  assert.equal(fixture.calls.some(c=>c.method==='POST'),false);
  const [row]=await db.query('SELECT notified,last_notify_error FROM pc_requests WHERE id=$1',[r.id]);
  assert.equal(row.notified,0);assert.match(row.last_notify_error,/outside Convergence/);
});
