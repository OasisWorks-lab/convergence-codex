import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,type Store} from '../src/db.ts';
import {createScenePanel,deliverScenePanel,touchScenePanel} from '../src/npc-panel.ts';
import {deliverTurnNotice,expireTurn,nextTurn,order,reminderDelay,setClock,turnWindow} from '../src/npc-turns.ts';
import type {Scene} from '../src/npc-voice.ts';

const writer='110000000000000001',guest='110000000000000002',thread='130000000000000002',panelId='140000000000000012';
const initial=(id=randomUUID()):Scene=>({id,channel:thread,host:writer,npc:randomUUID(),title:'King Azurik',mode:'open',ai:false,cast:[{id:writer,name:'Rin'}],round:1,turn:0,form:'',opening:'',posts:[],past:[]});
const base={title:'King Azurik',description:'NPC scene in progress',color:0xc76639,fields:[{name:'Turn order',value:'pending'}, {name:'On your turn',value:'Use /finish-turn.'}]};
async function foundation(db:Store,s:Scene,now:number){
  await db.transaction(async q=>{
    await q('INSERT INTO pc_rp_scenes(channel_id,scene_id,state) VALUES($1,$2,$3)',[s.channel,s.id,JSON.stringify(s)]);
    await setClock(q,s,now);
    await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
    await createScenePanel(q,s,base);
  });
}
test('the first scene panel is one embed; joins, handoffs and new rounds edit its existing message',async t=>{
  const db=openSqlite(':memory:');await initialize(db,'950522987646418964');t.after(()=>db.close());
  const s=initial(),now=Date.now();await foundation(db,s,now);
  const messages:any[]=[];
  const send=async(ch:string,payload:any,messageId?:string)=>{
    assert.equal(ch,thread);messages.push({payload,messageId});return {id:panelId};
  };
  assert.equal(await deliverScenePanel(db,send),true);
  assert.equal(await deliverScenePanel(db,send),false);
  assert.equal(messages.length,1);
  assert.equal(messages[0].messageId,undefined);
  assert.deepEqual(messages[0].payload.allowed_mentions,{parse:[]});
  assert.match(messages[0].payload.embeds[0].fields[0].value,new RegExp(writer));
  assert.match(messages[0].payload.embeds[0].title,/Round 1/);
  await db.transaction(async q=>{
    s.cast.push({id:guest,name:'Sola'});
    await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
    await touchScenePanel(q,s);
  });
  assert.equal(await deliverScenePanel(db,send),true);
  assert.equal(messages.length,2);
  assert.equal(messages[1].messageId,panelId);
  assert.match(messages[1].payload.embeds[0].fields[0].value,new RegExp(guest));
  await db.transaction(q=>nextTurn(q,s,now+1000,'Rin finished.'));
  assert.equal(await deliverScenePanel(db,send),true);
  assert.equal(messages.length,3);
  assert.equal(messages[2].messageId,panelId);
  assert.match(messages[2].payload.embeds[0].fields[0].value,/up now/);
  assert.match(messages[2].payload.embeds[0].fields[0].value,new RegExp(guest));
  assert.equal(await deliverScenePanel(db,send),false);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pc_rp_panels'))[0].n,1);
});
test('one reminder at thirty minutes without finish, none immediately and none after passing',async t=>{
  const db=openSqlite(':memory:');await initialize(db,'950522987646418964');t.after(()=>db.close());
  const s=initial(),now=Date.now();await foundation(db,s,now);
  const mentions:any[]=[];
  const send=async(_ch:string,payload:any)=>{mentions.push(payload);};
  assert.equal(await deliverTurnNotice(db,send,now+reminderDelay-1),false);
  assert.equal(await deliverTurnNotice(db,send,now+reminderDelay),true);
  assert.equal(mentions.length,1);assert.deepEqual(mentions[0].allowed_mentions.users,[writer]);
  assert.equal(await deliverTurnNotice(db,send,now+reminderDelay+1),false);
  await db.transaction(async q=>{
    s.cast.push({id:guest,name:'Sola'});
    await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
    await nextTurn(q,s,now+reminderDelay+2,'Done.');
  });
  const pending=await db.query('SELECT turn_key,retry_at FROM pc_rp_notices WHERE scene_id=$1',[s.id]);
  assert.equal(pending.length,1);
  assert.equal(Number(pending[0].retry_at),now+2*reminderDelay+2);
  assert.equal(await deliverTurnNotice(db,send,now+2*reminderDelay+1),false);
  assert.equal(await deliverTurnNotice(db,send,now+2*reminderDelay+2),true);
  assert.equal(mentions.length,2);assert.deepEqual(mentions[1].allowed_mentions.users,[guest]);
});
test('stale turn reminders cannot ping a writer who finished before thirty minutes',async t=>{
  const db=openSqlite(':memory:');await initialize(db,'950522987646418964');t.after(()=>db.close());
  const s=initial(),now=Date.now();await foundation(db,s,now);
  await db.transaction(q=>nextTurn(q,s,now+60*1000,'Rin passed.'));
  const p:any[]=[];
  assert.equal(await deliverTurnNotice(db,async(_,payload)=>{p.push(payload);},now+reminderDelay),true);
  assert.equal(p.length,0);
  assert.deepEqual(await db.query('SELECT * FROM pc_rp_clocks'),[]);
});
test('PostgreSQL workers create at most one panel and patch it after concurrent scene updates',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),admin=await openPostgres(url.href);
  const schema='panel_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.close();});
  await initialize(db,'950522987646418964');
  const s=initial(),now=Date.now();await foundation(db,s,now);
  let sent=0;
  const send=async(_channel:string,payload:any,messageId?:string)=>{sent++;return {id:panelId};};
  await Promise.all([deliverScenePanel(db,send),deliverScenePanel(db,send)]);
  assert.equal(sent,1);
  await db.transaction(async q=>{
    s.cast.push({id:guest,name:'Sola'});
    await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
    await touchScenePanel(q,s);
  });
  await Promise.all([deliverScenePanel(db,send),deliverScenePanel(db,send)]);
  assert.equal(sent,2);
  assert.equal((await db.query('SELECT message_id FROM pc_rp_panels WHERE scene_id=$1',[s.id]))[0].message_id,panelId);
});
