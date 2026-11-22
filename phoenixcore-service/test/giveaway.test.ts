import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {staffIdentity} from '../src/staff.ts';
import {setGiveawayChannels,createGiveaway,giveawayEntry,secureWeightedSelection,concludeGiveaway,rerollGiveawaySlot,
  claimGiveaway,manualGiveawayWinner,confirmManualPrize,giveawayPublic,updateGiveawayStatus,giveawayChannels,editGiveaway,extendGiveaway,giveawayParticipants} from '../src/giveaway.ts';
import {advanceGiveaways,deliverGiveawayPost,giveawayMessage} from '../src/giveaway-delivery.ts';
import {giveawayCommands,giveawayButton} from '../src/giveaway-discord.ts';

const guild='950522987646418964',ownerId='110000000000000001',helperId='110000000000000004',
  memberId='110000000000000003',boosterId='110000000000000005',extraId='110000000000000006',channel='1573908218260885614',
  role='150000000000000001';
const config:any={guild,owner:ownerId,clientId:'110000000000000020'};
const owner=staffIdentity(ownerId,[],'0',config,'123'),helper=staffIdentity(helperId,['123'],'0',config,'123'),
  memberStaff=staffIdentity(memberId,[],'0',config,'123');
const normal=(id:string,roles:string[]=[])=>({user:{id,bot:false},roles,premium_since:null});
const boost=(id:string,roles:string[]=[])=>({user:{id,bot:false},roles,premium_since:'2026-11-20T12:00:00Z'});
const people:any={ [memberId]:normal(memberId,[role]),[boosterId]:boost(boosterId,[role]),[extraId]:normal(extraId,[role])};
const lookup=async(id:string)=>people[id]||null;
async function setup(t:any){
  const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());
  await setGiveawayChannels(db,owner,[channel],0);return db;
}
const input=(now:number,extra:any={})=>({
  receipt:randomUUID(),title:'Phoenix Rising Celebration',description:'Celebrate the community together.',
  channelId:channel,startsMs:now,endsMs:now+60000,claimDurationMs:300000,winnerCount:2,
  prizeKind:'zeni' as const,zeniAmount:'750',prizeText:'',requiredRoles:[role],excludedRoles:[],...extra
});
const createChar=async(db:any,id:string,userId:string)=>{
  await db.query('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3)',
    [id,userId,JSON.stringify({name:'Rin',characterType:'OC',wallet:'0',bpl:'5000'})]);
};

test('only configured channels accept giveaways, with owner-only destination changes',async t=>{
  const db=await setup(t),now=Date.now();
  await assert.rejects(setGiveawayChannels(db,helper,[channel],1),/Only the Owner/);
  await assert.rejects(createGiveaway(db,memberStaff,input(now)),/Owner, Admin and Helper/);
  await assert.rejects(createGiveaway(db,helper,input(now,{channelId:'150000000000000003'})),/Owner-designated channels/);
  const first=await createGiveaway(db,helper,input(now));assert.equal(first.created,true);
  assert.equal((await giveawayChannels(db)).channels[0],channel);
  const g=await giveawayPublic(db,first.id);
  assert.equal(g.status,'active');assert.equal(g.prizeKind,'zeni');
  assert.equal(g.winnerCount,2);
  assert.equal(g.winners.length,0);
  assert.equal((await db.query('SELECT giveaway_id FROM pc_giveaway_posts')).length,1);
});

test('entry represents a Discord account, never a character; withdraw/rejoin remains possible',async t=>{
  const db=await setup(t),now=Date.now(),created=await createGiveaway(db,helper,input(now));
  assert.equal((await giveawayEntry(db,created.id,memberId,people[memberId],true,now+1000)).changed,true);
  assert.equal((await giveawayEntry(db,created.id,memberId,people[memberId],true,now+1000)).changed,false);
  assert.equal((await giveawayPublic(db,created.id)).entries,1);
  assert.equal((await giveawayEntry(db,created.id,memberId,normal(memberId),false,now+2000)).changed,true);
  assert.equal((await giveawayEntry(db,created.id,memberId,people[memberId],true,now+3000)).changed,true);
  await assert.rejects(giveawayEntry(db,created.id,extraId,normal(extraId),true,now+3000),/not eligible/);
  await assert.rejects(giveawayEntry(db,created.id,extraId,people[extraId],true,now+60001),/not currently open/);
});

test('cryptographic weighted draw is one member per prize; booster has three tickets total, not three separate wins',async t=>{
  assert.deepEqual(secureWeightedSelection([{userId:memberId,tickets:1},{userId:boosterId,tickets:3}],1,()=>2),[boosterId]);
  const choices=secureWeightedSelection([{userId:memberId,tickets:1},{userId:boosterId,tickets:3}],3,()=>0);
  assert.equal(new Set(choices).size,2);
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now));
  for(const id of [memberId,boosterId,extraId])await giveawayEntry(db,g.id,id,people[id],true,now+1000);
  const result=await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  assert.equal(result.drawn,true);assert.equal(new Set(result.winners).size,2);
  assert.equal((await concludeGiveaway(db,g.id,helperId,lookup,now+60001)).drawn,false);
  const [row]=await db.query('SELECT snapshot,draw_type FROM pc_giveaway_draws WHERE giveaway_id=$1',[g.id]);
  const snapshot=JSON.parse(row.snapshot);
  assert.equal(snapshot.find((x:any)=>x.userId===boosterId).tickets,3);
  assert.equal(snapshot.find((x:any)=>x.userId===memberId).tickets,1);
  assert.equal(row.draw_type,'random');
  assert.equal((await giveawayPublic(db,g.id)).winners.length,2);
});

test('draw time revalidates excluded/missing roles, membership, and actual booster status',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{winnerCount:2}));
  for(const id of [memberId,boosterId,extraId])await giveawayEntry(db,g.id,id,people[id],true,now+1000);
  const eligible=async(id:string)=>id===boosterId?normal(id):id===extraId?null:people[id];
  const result=await concludeGiveaway(db,g.id,helperId,eligible,now+60001);
  assert.deepEqual(result.winners,[memberId]);
  const [row]=await db.query('SELECT snapshot FROM pc_giveaway_draws WHERE giveaway_id=$1',[g.id]);
  const pool=JSON.parse(row.snapshot);
  assert.equal(pool.find((x:any)=>x.userId===boosterId).tickets,0);
  assert.equal(pool.find((x:any)=>x.userId===extraId).eligible,false);
});

test('Zeni payout credits winner-selected approved character BANK exactly once, never cash or another member',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{winnerCount:1}));
  await giveawayEntry(db,g.id,memberId,people[memberId],true,now+1000);
  await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const character=randomUUID(),wrong=randomUUID();
  await createChar(db,character,memberId);await createChar(db,wrong,extraId);
  await assert.rejects(claimGiveaway(db,g.id,memberId,wrong,people[memberId],now+61000),/approved player characters/);
  await assert.rejects(claimGiveaway(db,g.id,memberId,character,normal(memberId),now+61000),/remain eligible/);
  const claim=await claimGiveaway(db,g.id,memberId,character,people[memberId],now+61000);
  assert.equal(claim.claimed,true);
  const repeated=await claimGiveaway(db,g.id,memberId,character,people[memberId],now+61001);
  assert.equal(repeated.replayed,true);
  const [account]=await db.query('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1',[character]);
  assert.equal(account.cash,'0');assert.equal(account.bank,'750');
  assert.equal((await db.query("SELECT id FROM pc_economy_transactions WHERE kind='giveaway_prize'")).length,1);
  assert.equal((await db.query('SELECT * FROM pc_economy_entries WHERE character_id=$1',[character])).length,1);
  const [winner]=await db.query('SELECT status,character_id,transaction_id FROM pc_giveaway_winners WHERE giveaway_id=$1',[g.id]);
  assert.equal(winner.status,'claimed');assert.equal(winner.character_id,character);
  await assert.rejects(rerollGiveawaySlot(db,g.id,1,helperId,lookup,now+62000),/Claimed awards cannot be rerolled/);
});

test('claim deadlines expire; previously selected users never win again on reroll',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{winnerCount:1}));
  for(const id of [memberId,boosterId])await giveawayEntry(db,g.id,id,people[id],true,now+1000);
  const start=await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const first=start.winners[0],second=[memberId,boosterId].find(x=>x!==first);
  const next=await rerollGiveawaySlot(db,g.id,1,helperId,lookup,now+360100);
  assert.equal(next.winner,second);
  const [old]=await db.query('SELECT status FROM pc_giveaway_winners WHERE giveaway_id=$1 AND user_id=$2',[g.id,first]);
  assert.equal(old.status,'expired');
  const noMore=await rerollGiveawaySlot(db,g.id,1,helperId,lookup,now+600000);
  assert.equal(noMore.exhausted,true);
  assert.equal((await db.query('SELECT user_id FROM pc_giveaway_winners WHERE giveaway_id=$1',[g.id])).length,2);
});

test('manual prize claims wait for explicit staff confirmation, and manual owner selection is marked distinctly',async t=>{
  const db=await setup(t),now=Date.now();
  const g=await createGiveaway(db,helper,input(now,{prizeKind:'manual',prizeText:'Custom community title',zeniAmount:undefined,winnerCount:1}));
  await giveawayEntry(db,g.id,memberId,people[memberId],true,now+1000);
  await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const claim=await claimGiveaway(db,g.id,memberId,undefined,people[memberId],now+61000);
  assert.equal(claim.pending,true);assert.equal(claim.claimed,false);
  assert.equal((await confirmManualPrize(db,g.id,helper,memberId)).replayed,false);
  assert.equal((await confirmManualPrize(db,g.id,helper,memberId)).replayed,true);
  await assert.rejects(manualGiveawayWinner(db,g.id,helper,extraId,people[extraId]),/Only the Owner/);
  await assert.rejects(manualGiveawayWinner(db,g.id,owner,extraId,null),/eligibility/);
  await giveawayEntry(db,g.id,extraId,people[extraId],true,now+2000).catch(()=>{});
  await assert.rejects(manualGiveawayWinner(db,g.id,owner,memberId,people[memberId]),/previous winner/);
});

test('scheduled giveaways and canonical embed delivery persist across restart',async t=>{
  const db=await setup(t),now=Date.now();
  const g=await createGiveaway(db,helper,input(now,{startsMs:now+60000,endsMs:now+120000}));
  assert.equal((await giveawayPublic(db,g.id)).status,'scheduled');
  let messages=0;
  const discord:any={call:async(path:string,opts:any)=>{
    if(opts.method==='POST'){messages++;return {id:'1511111111111111111'};}
    if(opts.method==='PATCH')return {id:'1511111111111111111'};
    if(path.includes('/members/'))return people[path.split('/').pop()];
    throw Error('Unexpected Discord path');
  }};
  assert.equal(await deliverGiveawayPost(db,discord,now),true);
  assert.equal(await deliverGiveawayPost(db,discord,now),false);
  assert.equal(messages,1);
  assert.equal((await db.query('SELECT message_id FROM pc_giveaway_posts WHERE giveaway_id=$1',[g.id]))[0].message_id,'1511111111111111111');
  await initialize(db,guild);
  assert.equal(await advanceGiveaways(db,discord,config,now+60001),true);
  assert.equal((await giveawayPublic(db,g.id)).status,'active');
  assert.equal(await deliverGiveawayPost(db,discord,now+60001),true);
  assert.equal(await advanceGiveaways(db,discord,config,now+120001),true);
  assert.equal((await giveawayPublic(db,g.id)).status,'ended');
  assert.equal(await advanceGiveaways(db,discord,config,now+120001),false);
  assert.equal((await giveawayPublic(db,g.id)).winners.length,0);
  assert.ok(giveawayCommands().some(x=>x.name==='giveaway'));
  assert.equal(giveawayMessage(await giveawayPublic(db,g.id)).components.length,0);
});

test('pause/resume maintains remaining duration, cancellation blocks draw',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now));
  assert.equal((await updateGiveawayStatus(db,g.id,helper,'pause',now+1000)).status,'paused');
  assert.equal((await updateGiveawayStatus(db,g.id,helper,'resume',now+31000)).status,'active');
  assert.equal((await giveawayPublic(db,g.id)).endsMs,now+90000);
  assert.equal((await updateGiveawayStatus(db,g.id,helper,'cancel')).status,'cancelled');
  await assert.rejects(concludeGiveaway(db,g.id,helperId,lookup,now+93000),/Only an active giveaway/);
});

test('retention expires finished giveaways after seven days without erasing permanent economy payouts',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{winnerCount:1}));
  await giveawayEntry(db,g.id,memberId,people[memberId],true,now+1000);
  await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const character=randomUUID();await createChar(db,character,memberId);
  await claimGiveaway(db,g.id,memberId,character,people[memberId],now+62000);
  const discord:any={call:async()=>({id:'1511111111111111111'})};
  assert.equal(await advanceGiveaways(db,discord,config,now+60001+8*86400000),true);
  assert.equal((await db.query('SELECT id FROM pc_giveaways WHERE id=$1',[g.id])).length,0);
  const [transaction]=await db.query("SELECT reason FROM pc_economy_transactions WHERE kind='giveaway_prize'");
  assert.match(transaction.reason,new RegExp(g.id));
  const [bank]=await db.query('SELECT cash,bank FROM pc_economy_accounts WHERE character_id=$1',[character]);
  assert.equal(bank.cash,'0');assert.equal(bank.bank,'750');
});
test('unclaimed and pending-manual awards block retention deletion until claim/reroll processing is finished',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{winnerCount:1,prizeKind:'manual',prizeText:'Community badge',zeniAmount:undefined}));
  await giveawayEntry(db,g.id,memberId,people[memberId],true,now+1000);
  await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const discord:any={call:async(path:string)=>path.includes('/members/')?people[memberId]:{id:'1511111111111111111'}};
  assert.equal(await advanceGiveaways(db,discord,config,now+60001+8*86400000),true);
  const [old]=await db.query('SELECT status FROM pc_giveaway_winners WHERE giveaway_id=$1',[g.id]);
  assert.equal(old.status,'expired');
  assert.equal(await advanceGiveaways(db,discord,config,now+60001+8*86400000),true);
  assert.equal((await db.query('SELECT id FROM pc_giveaways WHERE id=$1',[g.id])).length,0);
});


test('giveaway winner can claim with a private Discord character picker, never paying the wrong character',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{winnerCount:1,requiredRoles:[]}));
  await giveawayEntry(db,g.id,memberId,normal(memberId),true,now+1000);
  await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const first=randomUUID(),second=randomUUID(),outsider=randomUUID();
  await createChar(db,first,memberId);await createChar(db,second,memberId);await createChar(db,outsider,extraId);
  const discord:any={call:async(path:string)=>people[path.split('/').pop()]||null};
  const interact=(userId:string,action:string,values?:string[])=>({
    guild_id:guild,channel_id:channel,member:{user:{id:userId}},data:{custom_id:'pcg:'+action+':'+g.id,...(values?{values}:{})}
  });
  const other=await giveawayButton(db,config,interact(extraId,'claim'),discord);
  assert.match(other.data.content,/Only a selected winner/);
  const prompt=await giveawayButton(db,config,interact(memberId,'claim'),discord);
  assert.equal(prompt.type,4);assert.equal(prompt.data.flags,64);
  const chooser=prompt.data.components[0].components[0];
  assert.equal(chooser.type,3);assert.equal(chooser.options.length,2);
  assert.deepEqual(new Set(chooser.options.map((o:any)=>o.value)),new Set([first,second]));
  const wrong=await giveawayButton(db,config,interact(memberId,'choose',[outsider]),discord);
  assert.match(wrong.data.content,/approved player characters/);
  assert.equal((await db.query("SELECT id FROM pc_economy_transactions WHERE kind='giveaway_prize'")).length,0);
  const awarded=await giveawayButton(db,config,interact(memberId,'choose',[second]),discord);
  assert.match(awarded.data.content,/deposited/);
  assert.equal((await db.query('SELECT bank FROM pc_economy_accounts WHERE character_id=$1',[second]))[0].bank,'750');
  assert.equal((await db.query("SELECT id FROM pc_economy_transactions WHERE kind='giveaway_prize'")).length,1);
  const duplicate=await giveawayButton(db,config,interact(memberId,'choose',[second]),discord);
  assert.match(duplicate.data.content,/already recorded/);
  assert.equal((await db.query("SELECT id FROM pc_economy_transactions WHERE kind='giveaway_prize'")).length,1);
  const done=await giveawayButton(db,config,interact(memberId,'claim'),discord);
  assert.match(done.data.content,/already been recorded/);
  const message=giveawayMessage(await giveawayPublic(db,g.id));
  assert.equal(message.components.length,0);
});

test('manual giveaway prize claim button does not bypass staff delivery confirmation',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{
    requiredRoles:[],winnerCount:1,prizeKind:'manual',prizeText:'Community title',zeniAmount:undefined
  }));
  await giveawayEntry(db,g.id,memberId,normal(memberId),true,now+1000);
  await concludeGiveaway(db,g.id,helperId,lookup,now+60001);
  const message=giveawayMessage(await giveawayPublic(db,g.id));
  assert.equal(message.components[0].components[0].custom_id,'pcg:claim:'+g.id);
  const discord:any={call:async(path:string)=>people[path.split('/').pop()]||null};
  const action={guild_id:guild,channel_id:channel,member:{user:{id:memberId}},data:{custom_id:'pcg:claim:'+g.id}};
  const result=await giveawayButton(db,config,action,discord);
  assert.match(result.data.content,/pending staff delivery/);
  assert.equal((await db.query('SELECT status FROM pc_giveaway_winners WHERE giveaway_id=$1',[g.id]))[0].status,'claim_pending');
  assert.equal((await db.query("SELECT id FROM pc_economy_transactions WHERE kind='giveaway_prize'")).length,0);
});

test('staff edits open giveaway details with optimistic revisions, audited public message refresh and no prize mutation',async t=>{
  const db=await setup(t),now=Date.now(),created=await createGiveaway(db,helper,input(now));
  const id=created.id,initial=await giveawayPublic(db,id);
  assert.equal(initial.version,1);
  await assert.rejects(editGiveaway(db,id,memberStaff,1,{title:'Unauthorized'},now+1000),/Owner, Admin and Helper/);
  await assert.rejects(editGiveaway(db,id,helper,1,{},now+1000),/Specify a title or description/);
  const updated=await editGiveaway(db,id,helper,1,{title:'Community Celebration',description:'A revised description'},now+1000);
  assert.equal(updated.version,2);assert.equal(updated.changed,true);
  const displayed=await giveawayPublic(db,id);
  assert.equal(displayed.title,'Community Celebration');assert.equal(displayed.description,'A revised description');
  assert.equal(displayed.prizeKind,'zeni');assert.equal(displayed.zeniAmount,'750');
  assert.equal((await editGiveaway(db,id,helper,2,{title:'Community Celebration'},now+1000)).changed,false);
  await assert.rejects(editGiveaway(db,id,helper,1,{description:'Stale editor'},now+2000),/Refresh before editing/);
  assert.ok((await db.query("SELECT event FROM pc_giveaway_events WHERE giveaway_id=$1 AND event='edited'",[id])).length===1);
  const [post]=await db.query('SELECT revision,delivered_revision FROM pc_giveaway_posts WHERE giveaway_id=$1',[id]);
  assert.equal(Number(post.revision),2);assert.equal(Number(post.delivered_revision),0);
  await concludeGiveaway(db,id,helperId,lookup,now+60001);
  await assert.rejects(editGiveaway(db,id,helper,3,{description:'Too late'},now+60002),/closed or drawn/);
});

test('staff extensions respect one-year limit, revision conflicts and paused clock semantics',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now));
  await assert.rejects(extendGiveaway(db,g.id,memberStaff,1,5,now+1000),/Owner, Admin and Helper/);
  await assert.rejects(extendGiveaway(db,g.id,helper,1,0,now+1000),/Extend by/);
  const extension=await extendGiveaway(db,g.id,helper,1,30,now+1000);
  assert.equal(extension.version,2);assert.equal(extension.endsMs,now+31*60000);
  await assert.rejects(extendGiveaway(db,g.id,helper,1,5,now+2000),/Refresh before extending/);
  await updateGiveawayStatus(db,g.id,helper,'pause',now+3000);
  const paused=await db.query('SELECT updated_ms,version FROM pc_giveaways WHERE id=$1',[g.id]);
  const pauseClock=Number(paused[0].updated_ms);
  const edit=await editGiveaway(db,g.id,helper,Number(paused[0].version),{description:'Edited while paused'},now+13000);
  const extended=await extendGiveaway(db,g.id,helper,edit.version,15,now+23000);
  assert.equal(extended.endsMs,now+46*60000);
  assert.equal(Number((await db.query('SELECT updated_ms FROM pc_giveaways WHERE id=$1',[g.id]))[0].updated_ms),pauseClock);
  await updateGiveawayStatus(db,g.id,helper,'resume',now+33000);
  assert.equal((await giveawayPublic(db,g.id)).endsMs,now+46*60000+30000);
  const afterResume=await giveawayPublic(db,g.id);
  await assert.rejects(extendGiveaway(db,g.id,helper,afterResume.version,525600,now+34000),/longer than one year/);
  assert.equal((await db.query("SELECT event FROM pc_giveaway_events WHERE giveaway_id=$1 AND event='extended'",[g.id])).length,2);
  await updateGiveawayStatus(db,g.id,helper,'cancel',now+35000);
  await assert.rejects(extendGiveaway(db,g.id,helper,afterResume.version+1,1,now+36000),/closed or drawn/);
});


test('only Owner can inspect entrant identities, with accurate booster, withdrawal and original draw information',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now));
  await giveawayEntry(db,g.id,memberId,people[memberId],true,now+1000);
  await giveawayEntry(db,g.id,boosterId,people[boosterId],true,now+1100);
  await giveawayEntry(db,g.id,extraId,people[extraId],true,now+1200);
  await giveawayEntry(db,g.id,extraId,people[extraId],false,now+1300);
  const members:any={...people,
    [memberId]:{...people[memberId],nick:'Rin Writer',user:{...people[memberId].user,username:'rin-player',global_name:'Rin'}}};
  const resolve=async(id:string)=>members[id]||null;
  await assert.rejects(giveawayParticipants(db,g.id,helper,resolve),/Only the Convergence Owner/);
  await assert.rejects(giveawayParticipants(db,g.id,memberStaff,resolve),/Only the Convergence Owner/);
  await assert.rejects(giveawayParticipants(db,g.id,owner,resolve,0),/valid participant page/);
  await assert.rejects(giveawayParticipants(db,g.id,owner,resolve,1,'not-allowed' as any),/Choose all, active or withdrawn/);
  const roster=await giveawayParticipants(db,g.id,owner,resolve);
  assert.equal(roster.total,3);assert.equal(roster.active,2);assert.equal(roster.withdrawn,1);
  assert.equal(roster.participants.length,3);
  const rin=roster.participants.find((p:any)=>p.userId===memberId);
  assert.equal(rin.displayName,'Rin Writer');assert.equal(rin.username,'rin-player');
  assert.match(rin.avatarUrl,/cdn.discordapp.com/);
  assert.equal(rin.currentTickets,1);assert.equal(rin.memberStatus,'current');
  const booster=roster.participants.find((p:any)=>p.userId===boosterId);
  assert.equal(booster.booster,true);assert.equal(booster.currentTickets,3);
  const withdrawn=await giveawayParticipants(db,g.id,owner,resolve,1,'withdrawn');
  assert.deepEqual(withdrawn.participants.map((p:any)=>p.userId),[extraId]);
  assert.equal(withdrawn.participants[0].active,false);
  assert.equal(withdrawn.participants[0].currentTickets,0);
  assert.equal(Object.hasOwn(await giveawayPublic(db,g.id),'participants'),false);
  await concludeGiveaway(db,g.id,helperId,resolve,now+60001);
  const drawn=await giveawayParticipants(db,g.id,owner,resolve);
  assert.equal(drawn.hasDrawSnapshot,true);
  assert.equal(drawn.participants.find((p:any)=>p.userId===boosterId).drawTickets,3);
  assert.equal(drawn.participants.find((p:any)=>p.userId===extraId).drawTickets,0);
  assert.equal(drawn.participants.reduce((sum:number,p:any)=>sum+p.wins.length,0),2);
  const missing=await giveawayParticipants(db,g.id,owner,async(id:string)=>{
    if(id===boosterId)throw new (await import('../src/discord.ts')).DiscordFailure(404);
    return resolve(id);
  });
  assert.equal(missing.participants.find((p:any)=>p.userId===boosterId).memberStatus,'left');
  assert.equal(missing.participants.find((p:any)=>p.userId===boosterId).drawTickets,3);
});

test('participant directory pages through all user records without exposing other pages',async t=>{
  const db=await setup(t),now=Date.now(),g=await createGiveaway(db,helper,input(now,{requiredRoles:[]}));
  const profiles=new Map<string,any>();
  for(let i=0;i<30;i++){
    const id=(BigInt('110000000000000100')+BigInt(i)).toString();
    const profile={...normal(id),nick:'Participant '+i,
      user:{id,username:'player'+i,bot:false}};
    profiles.set(id,profile);
    await giveawayEntry(db,g.id,id,profile,true,now+1000+i);
  }
  const resolve=async(id:string)=>profiles.get(id)||null;
  const first=await giveawayParticipants(db,g.id,owner,resolve,1,'all');
  const second=await giveawayParticipants(db,g.id,owner,resolve,2,'all');
  assert.equal(first.pageSize,25);assert.equal(first.pages,2);
  assert.equal(first.participants.length,25);assert.equal(second.participants.length,5);
  assert.equal(new Set([...first.participants,...second.participants].map(p=>p.userId)).size,30);
  await assert.rejects(giveawayParticipants(db,g.id,owner,resolve,3),/no longer exists/);
});

test('PostgreSQL concurrent draws, claims and receipts never multiply winners or bank credits',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href);
  const schema='giveaway_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);await setGiveawayChannels(db,owner,[channel],0);
  const now=Date.now(),data=input(now,{winnerCount:1}),created=await Promise.all(Array.from({length:8},()=>createGiveaway(db,helper,data,now)));
  assert.equal(new Set(created.map(c=>c.id)).size,1);
  const id=created[0].id;
  await giveawayEntry(db,id,memberId,people[memberId],true,now+1000);
  const draws=await Promise.all(Array.from({length:8},()=>concludeGiveaway(db,id,helperId,lookup,now+60001)));
  assert.equal(draws.filter(d=>d.drawn).length,1);
  const char=randomUUID();await createChar(db,char,memberId);
  const claimed=await Promise.all(Array.from({length:10},()=>claimGiveaway(db,id,memberId,char,people[memberId],now+61000)));
  assert.equal(claimed.filter(c=>c.claimed&&!c.replayed).length,1);
  assert.equal((await db.query("SELECT id FROM pc_economy_transactions WHERE kind='giveaway_prize'")).length,1);
  assert.equal((await db.query('SELECT bank FROM pc_economy_accounts WHERE character_id=$1',[char]))[0].bank,'750');
});
