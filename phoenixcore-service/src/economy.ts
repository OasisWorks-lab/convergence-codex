import {createHash} from 'node:crypto';
import type {Query,Store} from './db.ts';
import {requireThat,type Actor} from './domain.ts';

export const economyCurrencyId='zeni';
export const startingZeni:Record<string,string>={Low:'1000',Middle:'2000',High:'4000',Noble:'8000'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maximum=10n**60n-1n;
export function balance(value:unknown){
  requireThat(typeof value==='string'&&/^(0|[1-9][0-9]{0,59})$/.test(value),400,'Currency amounts must be nonnegative integers up to 60 digits.');
  return BigInt(value);
}
const money=(amount:bigint)=>{
  requireThat(amount>=0n&&amount<=maximum,409,'The resulting balance is outside the supported range.');
  return amount.toString();
};
export function openingCash(sheet:any){
  const old=String(sheet?.wallet??'0');
  requireThat(/^(0|[1-9][0-9]{0,59})$/.test(old),409,'An existing character wallet contains an unsupported value; correct it before migration.');
  return old;
}
type Account={character_id:string;cash:string;bank:string;revision:number};
const digest=(parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
async function entry(q:Query,values:{id:string;actor:string;character:string;kind:string;reason:string;amount:string;beforeCash:string;afterCash:string;beforeBank:string;afterBank:string}){
  const fingerprint=digest([values.actor,values.character,values.kind,values.reason,values.amount,values.beforeCash,values.afterCash,values.beforeBank,values.afterBank]);
  const inserted=await q('INSERT INTO pc_economy_transactions(id,actor_id,kind,reason,amount,currency_id,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id',
    [values.id,values.actor,values.kind,values.reason,values.amount,economyCurrencyId,fingerprint,Date.now()]);
  requireThat(inserted.length>0,409,'This economy transaction was already recorded.');
  await q('INSERT INTO pc_economy_entries(transaction_id,character_id,cash_before,cash_after,bank_before,bank_after) VALUES($1,$2,$3,$4,$5,$6)',
    [values.id,values.character,values.beforeCash,values.afterCash,values.beforeBank,values.afterBank]);
}
export async function ensureAccount(q:Query,characterId:string,sheet:any) {
  const cash=openingCash(sheet);
  const created=await q('INSERT INTO pc_economy_accounts(character_id,currency_id,cash,bank,revision) VALUES($1,$2,$3,$4,1) ON CONFLICT(character_id) DO NOTHING RETURNING character_id',
    [characterId,economyCurrencyId,cash,'0']);
  if(created.length && cash!=='0')await entry(q,{id:'opening:'+characterId,actor:'system',character:characterId,kind:'legacy_import',reason:'Imported existing approved character wallet',amount:cash,beforeCash:'0',afterCash:cash,beforeBank:'0',afterBank:'0'});
}
export async function seedExistingAccounts(q:Query) {
  const characters=await q('SELECT id,sheet FROM pc_characters ORDER BY id');
  for(const c of characters)await ensureAccount(q,c.id,JSON.parse(c.sheet));
}
export async function approvalBalance(q:Query,requestId:string,actor:string,kind:string,characterId:string,after:any,before:any){
  await ensureAccount(q,characterId,before??{wallet:'0'});
  const [account]=await q('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1',[characterId]);
  requireThat(account,500,'Missing character economy account.');
  const desired=openingCash(after);
  const prior=openingCash(before??{wallet:'0'});
  requireThat(account.cash===prior,409,'The economy balance changed since this request was submitted.');
  if(desired===prior)return;
  const delta=BigInt(desired)-BigInt(prior);
  requireThat(delta>=0n || kind==='edit',409,'A training award cannot remove currency.');
  await q('UPDATE pc_economy_accounts SET cash=$1,revision=revision+1 WHERE character_id=$2',[desired,characterId]);
  await entry(q,{id:'approval:'+requestId,actor,character:characterId,kind:kind==='create'?'starting_funds':kind==='edit'?'approved_sheet':'training_award',
    reason:'Owner-approved '+kind,amount:(delta<0n?-delta:delta).toString(),beforeCash:prior,afterCash:desired,beforeBank:account.bank,afterBank:account.bank});
}
export async function bankAction(db:Store,actor:Actor,input:any){
  requireThat(actor.isPlayer||actor.isOwner,403,'A current Convergence player is required.');
  requireThat(input && typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['id','characterId','action','amount'].includes(k)),400,'Invalid banking request.');
  requireThat(typeof input.id==='string'&&uuid.test(input.id),400,'Choose a unique transaction identifier.');
  requireThat(typeof input.characterId==='string'&&uuid.test(input.characterId),400,'Select your approved character.');
  requireThat(['deposit','withdraw'].includes(input.action),400,'Choose deposit or withdraw.');
  const amount=balance(input.amount);
  requireThat(amount>0n,400,'Enter an amount greater than zero.');
  const fingerprint=digest([actor.id,input.characterId,input.action,input.amount]);
  return db.transaction(async q=>{
    const [existing]=await q('SELECT fingerprint FROM pc_economy_transactions WHERE id=$1',[input.id]);
    if(existing){
      requireThat(existing.fingerprint===fingerprint,409,'This transaction ID was used for a different action.');
      const [receipt]=await q('SELECT cash_after,bank_after FROM pc_economy_entries WHERE transaction_id=$1 AND character_id=$2',[input.id,input.characterId]);
      requireThat(receipt,409,'The existing transaction belongs to a different character.');
      return {id:input.id,cash:receipt.cash_after,bank:receipt.bank_after,replayed:true};
    }
    const [character]=await q('SELECT owner_id,revision,sheet FROM pc_characters WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.characterId]);
    requireThat(character && character.owner_id===actor.id,403,'Select one of your approved characters.');
    const sheet=JSON.parse(character.sheet);
    await ensureAccount(q,input.characterId,sheet);
    const [account]=await q('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.characterId]) as Account[];
    const cash=BigInt(account.cash),bank=BigInt(account.bank);
    requireThat(openingCash(sheet)===account.cash,409,'The character wallet needs a balance reconciliation.');
    // Overdraft/freeze mechanics are reserved until the owner specifies their exact semantics.
    requireThat(input.action==='deposit'?cash>=amount:bank>=amount,409,'Insufficient available funds. Overdraft rules are not active yet.');
    const afterCash=money(cash+(input.action==='deposit'?-amount:amount));
    const afterBank=money(bank+(input.action==='deposit'?amount:-amount));
    sheet.wallet=afterCash;
    await q('UPDATE pc_characters SET sheet=$1,revision=revision+1 WHERE id=$2',[JSON.stringify(sheet),input.characterId]);
    await q('UPDATE pc_economy_accounts SET cash=$1,bank=$2,revision=revision+1 WHERE character_id=$3',[afterCash,afterBank,input.characterId]);
    const inserted=await q('INSERT INTO pc_economy_transactions(id,actor_id,kind,reason,amount,currency_id,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id',
      [input.id,actor.id,input.action,'Character banking',input.amount,economyCurrencyId,fingerprint,Date.now()]);
    requireThat(inserted.length>0,409,'The transaction is already recorded.');
    await q('INSERT INTO pc_economy_entries(transaction_id,character_id,cash_before,cash_after,bank_before,bank_after) VALUES($1,$2,$3,$4,$5,$6)',
      [input.id,input.characterId,account.cash,afterCash,account.bank,afterBank]);
    return {id:input.id,cash:afterCash,bank:afterBank,replayed:false};
  });
}
export async function visibleAccounts(db:Store,actor:Actor){
  const rows=await db.query('SELECT a.character_id,a.currency_id,a.cash,a.bank,a.revision,c.owner_id FROM pc_economy_accounts a JOIN pc_characters c ON c.id=a.character_id ORDER BY a.character_id');
  return rows.filter(r=>actor.isJudge||r.owner_id===actor.id).map(r=>({characterId:r.character_id,currencyId:r.currency_id,cash:r.cash,bank:r.bank,revision:Number(r.revision)}));
}
export async function statement(db:Store,actor:Actor,characterId:string){
  requireThat(uuid.test(characterId),400,'Select an approved character.');
  const [character]=await db.query('SELECT owner_id FROM pc_characters WHERE id=$1',[characterId]);
  requireThat(character && (character.owner_id===actor.id||actor.isJudge),403,'You can view transactions only for your own characters.');
  const rows=await db.query('SELECT t.id,t.actor_id,t.kind,t.reason,t.amount,t.currency_id,t.created_ms,e.cash_before,e.cash_after,e.bank_before,e.bank_after FROM pc_economy_entries e JOIN pc_economy_transactions t ON t.id=e.transaction_id WHERE e.character_id=$1 ORDER BY t.created_ms DESC,t.id DESC LIMIT 100',[characterId]);
  return rows.map(r=>({id:r.id,actorId:r.actor_id,kind:r.kind,reason:r.reason,amount:r.amount,currencyId:r.currency_id,created:Number(r.created_ms),cashBefore:r.cash_before,cashAfter:r.cash_after,bankBefore:r.bank_before,bankAfter:r.bank_after}));
}
