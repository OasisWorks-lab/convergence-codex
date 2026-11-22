import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,initialize} from '../src/db.ts';
import {propose,decide,judgeTraining,type Actor} from '../src/domain.ts';
import {bankAction,statement,visibleAccounts} from '../src/economy.ts';

const guild='810000000000000001',owner='810000000000000002',writer='810000000000000003',other='810000000000000004';
const player:Actor={id:writer,isOwner:false,isJudge:false,isPlayer:true};
const rival:Actor={id:other,isOwner:false,isJudge:false,isPlayer:true};
const boss:Actor={id:owner,isOwner:true,isJudge:true,isPlayer:true};
const fields=(name:string,societyClass='Low')=>({name,characterType:'OC',societyClass,bpl:'5000',
  strengths:'Calm\nObservant\nPatient',weaknesses:'Impulsive\nRestless\nProud'});
async function approved(db:any,name:string,who:Actor=player,societyClass='Low') {
  const id=randomUUID();
  await propose(db,who,{id,kind:'create',fields:fields(name,societyClass),reason:'First character'},new Set([writer,other,owner]));
  const result=await decide(db,owner,owner,id,true,[]);
  assert.equal(result.status,'approved');
  return id;
}
test('societal grants are one-time, owner-approved, independent and durable through reinitialization',async t=>{
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);
  const low=await approved(db,'Rin');
  const noble=await approved(db,'Sola',player,'Noble');
  assert.deepEqual((await visibleAccounts(db,player)).map(r=>[r.characterId,r.cash,r.bank]).sort(),[[low,'1000','0'],[noble,'8000','0']].sort());
  assert.equal((await visibleAccounts(db,rival)).length,0);
  await initialize(db,guild);
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM pc_economy_transactions WHERE kind='starting_funds'"))[0].count,2);
  assert.equal((await db.query('SELECT wallet FROM (SELECT 1 AS wallet)')).length,1);
  assert.equal((await statement(db,player,low)).length,1);
  await assert.rejects(statement(db,rival,low),{status:403});
  const initial=await decide(db,owner,owner,low,true,[]);
  assert.equal(initial.status,'approved');
  assert.equal((await visibleAccounts(db,player)).find(a=>a.characterId===low)?.cash,'1000');
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM pc_economy_transactions WHERE kind='starting_funds'"))[0].count,2);
});
test('deposits and withdrawals are atomic, isolated, replay-safe and invalidate old sheet revisions',async t=>{
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);
  const first=await approved(db,'Rin'),second=await approved(db,'Sola');
  const deposit={id:randomUUID(),characterId:first,action:'deposit',amount:'600'};
  await assert.rejects(bankAction(db,rival,deposit),{status:403});
  assert.deepEqual(await bankAction(db,player,deposit),{id:deposit.id,cash:'400',bank:'600',replayed:false});
  assert.deepEqual(await bankAction(db,player,deposit),{id:deposit.id,cash:'400',bank:'600',replayed:true});
  await assert.rejects(bankAction(db,player,{...deposit,amount:'700'}),{status:409});
  await assert.rejects(bankAction(db,player,{id:randomUUID(),characterId:first,action:'withdraw',amount:'601'}),{status:409});
  const withdrawal=await bankAction(db,player,{id:randomUUID(),characterId:first,action:'withdraw',amount:'125'});
  assert.deepEqual({cash:withdrawal.cash,bank:withdrawal.bank},{cash:'525',bank:'475'});
  assert.equal((await visibleAccounts(db,player)).find(x=>x.characterId===second)?.cash,'1000');
  const [sheet]=await db.query('SELECT revision,sheet FROM pc_characters WHERE id=$1',[first]);
  assert.equal(sheet.revision,3);assert.equal(JSON.parse(sheet.sheet).wallet,'525');
  assert.equal((await statement(db,player,first)).length,3);
});
test('staff-awarded cash enters the ledger once and existing wallets import once',async t=>{
  const db=openSqlite(':memory:');t.after(()=>db.close());await initialize(db,guild);
  const first=await approved(db,'Rin');
  const [before]=await db.query('SELECT revision FROM pc_characters WHERE id=$1',[first]);
  const claim={id:randomUUID(),kind:'training',characterId:first,version:before.revision,
    details:{location:'Dojo',trainingType:'Solo',goals:'Control',formula:'Owner-reviewed session',claimed:'+50'},
    reason:'Training'};
  await propose(db,player,claim,new Set([writer]));
  await judgeTraining(db,boss,claim.id,{award:{points:'50',currency:'75'},note:'Approved judged gains'},new Set([writer]));
  assert.equal((await decide(db,owner,owner,claim.id,true,[])).status,'approved');
  assert.equal((await visibleAccounts(db,player))[0].cash,'1075');
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM pc_economy_transactions WHERE kind='training_award'"))[0].count,1);
  await initialize(db,guild);
  assert.equal((await visibleAccounts(db,player))[0].cash,'1075');
  const legacy=randomUUID();
  await db.query('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3)',[legacy,writer,JSON.stringify({name:'Legacy',bpl:'1000',wallet:'123',gear:[]})]);
  await initialize(db,guild);
  assert.equal((await visibleAccounts(db,player)).find(x=>x.characterId===legacy)?.cash,'123');
  await initialize(db,guild);
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM pc_economy_transactions WHERE kind='legacy_import'"))[0].count,1);
});
