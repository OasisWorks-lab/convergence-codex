import {randomInt,randomUUID} from 'node:crypto';
import {Problem,requireThat,textValue,discordId} from './domain.ts';
import type {Store,Query} from './db.ts';
import type {StaffIdentity} from './staff.ts';
import {balance,giveawayBankCredit} from './economy.ts';
import {DiscordFailure} from './discord.ts';

export const giveawayStatuses=['scheduled','active','paused','ended','cancelled'] as const;
export type GiveawayStatus=typeof giveawayStatuses[number];
export type GiveawayPrize='zeni'|'manual';
export const giveawayRetentionDays=7;
export const minClaimMs=60_000;
export const maxClaimMs=30*86_400_000;
export const maxDurationMs=365*86_400_000;
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const giveawayId=(id:string)=>requireThat(uuid.test(id),400,'Choose a valid giveaway ID.');
const staffOnly=(who:StaffIdentity)=>requireThat(who.isHelper,403,'Only the Convergence Owner, Admin and Helper may manage giveaways.');
const roleIds=(roles:unknown)=>{
  requireThat(Array.isArray(roles)&&roles.length<=20&&roles.every(v=>typeof v==='string'&&discordId.test(v)),400,'Provide up to 20 valid Discord role IDs.');
  return [...new Set(roles)].sort();
};
const record=async(q:Query,id:string,actor:string,event:string,detail:string,now:number)=>{
  await q('INSERT INTO pc_giveaway_events(id,giveaway_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(),id,actor,event,detail.slice(0,600),now]);
};
const dirty=async(q:Query,id:string)=>q('UPDATE pc_giveaway_posts SET revision=revision+1,retry_ms=0 WHERE giveaway_id=$1',[id]);
export async function giveawayChannels(db:Store){
  const [row]=await db.query('SELECT channels,revision FROM pc_giveaway_config WHERE slot=1');
  return {channels:row?JSON.parse(row.channels) as string[]:[],revision:Number(row?.revision||0)};
}
export async function setGiveawayChannels(db:Store,who:StaffIdentity,ids:string[],revision:number){
  requireThat(who.isOwner,403,'Only the Owner may configure giveaway destinations.');
  const channels=roleIds(ids);
  requireThat(Number.isInteger(revision)&&revision>=0,400,'Invalid channel configuration revision.');
  return db.transaction(async q=>{
    const [old]=await q('SELECT revision FROM pc_giveaway_config WHERE slot=1'+(db.dialect==='postgres'?' FOR UPDATE':'')); 
    requireThat(Number(old?.revision||0)===revision,409,'Giveaway channel settings were changed. Refresh before saving.');
    const next=revision+1;
    await q('INSERT INTO pc_giveaway_config(slot,channels,revision,actor_id,changed_ms) VALUES(1,$1,$2,$3,$4) ON CONFLICT(slot) DO UPDATE SET channels=excluded.channels,revision=excluded.revision,actor_id=excluded.actor_id,changed_ms=excluded.changed_ms',
      [JSON.stringify(channels),next,who.id,Date.now()]);
    return {channels,revision:next};
  });
}
export type GiveawayInput={receipt:string;title:string;description:string;channelId:string;startsMs:number;endsMs:number;claimDurationMs:number;
  winnerCount:number;prizeKind:GiveawayPrize;zeniAmount?:string;prizeText?:string;requiredRoles?:string[];excludedRoles?:string[];retentionDays?:number};
export async function createGiveaway(db:Store,who:StaffIdentity,input:GiveawayInput,now=Date.now()){
  staffOnly(who);
  requireThat(input&&typeof input==='object',400,'Choose a valid giveaway.');
  requireThat(typeof input.receipt==='string'&&/^[\w:-]{8,130}$/.test(input.receipt),400,'A unique submission receipt is required.');
  requireThat(discordId.test(input.channelId),400,'Select a designated Convergence giveaway channel.');
  const title=textValue(input.title,120,'Giveaway title',true);
  const description=textValue(input.description??'',1600,'Giveaway description');
  requireThat(Number.isSafeInteger(input.startsMs)&&input.startsMs>=now-60000&&input.startsMs<=now+maxDurationMs,400,'Choose a supported future start date.');
  requireThat(Number.isSafeInteger(input.endsMs)&&input.endsMs>input.startsMs&&input.endsMs-input.startsMs<=maxDurationMs,400,'End must follow start within one year.');
  requireThat(Number.isSafeInteger(input.claimDurationMs)&&input.claimDurationMs>=minClaimMs&&input.claimDurationMs<=maxClaimMs,400,
    'Choose a claim window between one minute and thirty days for this giveaway.');
  requireThat(Number.isInteger(input.winnerCount)&&input.winnerCount>=1&&input.winnerCount<=25,400,'Choose 1–25 winners.');
  requireThat(['zeni','manual'].includes(input.prizeKind),400,'Select Zeni or a staff-delivered manual prize.');
  const amount=input.prizeKind==='zeni'?String(input.zeniAmount||''):null;
  if(amount){requireThat(balance(amount)>0n,400,'Zeni prize must be positive.');}
  if(input.prizeKind==='zeni')requireThat(!!amount,400,'Enter the Zeni award per winner.');
  const prizeText=textValue(input.prizeText||'',240,'Prize description',input.prizeKind==='manual');
  const required=roleIds(input.requiredRoles||[]),excluded=roleIds(input.excludedRoles||[]);
  requireThat(!required.some(r=>excluded.includes(r)),400,'A role cannot be both required and excluded.');
  const days=input.retentionDays??giveawayRetentionDays;
  requireThat(Number.isInteger(days)&&days>=1&&days<=365,400,'Retention must be 1–365 days.');
  const configured=await giveawayChannels(db);
  requireThat(configured.channels.includes(input.channelId),403,'Giveaways may only be created in Owner-designated channels.');
  return db.transaction(async q=>{
    const [already]=await q('SELECT id,creator_id FROM pc_giveaways WHERE receipt_id=$1',[input.receipt]);
    if(already){requireThat(already.creator_id===who.id,409,'Receipt belongs to another staff creator.');return {id:already.id,created:false};}
    const id=randomUUID(),status=input.startsMs>now?'scheduled':'active';
    const inserted=await q('INSERT INTO pc_giveaways(id,receipt_id,title,description,creator_id,channel_id,status,prize_kind,prize_text,zeni_amount,required_roles,excluded_roles,winner_count,starts_ms,ends_ms,claim_duration_ms,retention_days,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) ON CONFLICT(receipt_id) DO NOTHING RETURNING id',
      [id,input.receipt,title,description,who.id,input.channelId,status,input.prizeKind,prizeText,amount,JSON.stringify(required),JSON.stringify(excluded),
        input.winnerCount,input.startsMs,input.endsMs,input.claimDurationMs,days,now]);
    if(!inserted.length){const [existing]=await q('SELECT id,creator_id FROM pc_giveaways WHERE receipt_id=$1',[input.receipt]);requireThat(existing?.creator_id===who.id,409,'Receipt collision.');return {id:existing.id,created:false};}
    await q('INSERT INTO pc_giveaway_posts(giveaway_id,channel_id) VALUES($1,$2)',[id,input.channelId]);
    await record(q,id,who.id,'created','Prize: '+input.prizeKind+' · '+String(amount||prizeText).slice(0,100),now);
    return {id,created:true};
  });
}
export async function getGiveaway(db:Store,id:string){
  giveawayId(id);const [row]=await db.query('SELECT * FROM pc_giveaways WHERE id=$1',[id]);
  requireThat(row,404,'Giveaway unavailable.');return row;
}
export function giveawayEligibleMember(userId:string,member:any,giveaway:any){
  if(!member||member.user?.id!==userId||member.user.bot)return {eligible:false,booster:false,reason:'not a current human member'};
  const roles:Array<string>=Array.isArray(member.roles)?member.roles:[];
  const required:string[]=JSON.parse(giveaway.required_roles);
  const excluded:string[]=JSON.parse(giveaway.excluded_roles);
  if(!required.every(role=>roles.includes(role)))return {eligible:false,booster:false,reason:'missing required role'};
  if(excluded.some(role=>roles.includes(role)))return {eligible:false,booster:false,reason:'excluded role'};
  return {eligible:true,booster:!!member.premium_since,reason:'eligible'};
}
export async function giveawayEntry(db:Store,id:string,userId:string,member:any,join:boolean,now=Date.now()){
  requireThat(discordId.test(userId),400,'Discord member identity required.');
  return db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g,404,'Giveaway unavailable.');
    requireThat(g.status==='active'&&Number(g.starts_ms)<=now&&Number(g.ends_ms)>now,409,'Giveaway entries are not currently open.');
    const eligibility=giveawayEligibleMember(userId,member,g);
    requireThat(!join||eligibility.eligible,403,'You are not eligible to enter this giveaway ('+eligibility.reason+').');
    const [existing]=await q('SELECT active,joined_ms FROM pc_giveaway_entries WHERE giveaway_id=$1 AND user_id=$2',[id,userId]);
    if(existing&&Number(existing.active)===(join?1:0))return {changed:false,entered:join};
    if(join)await q('INSERT INTO pc_giveaway_entries(giveaway_id,user_id,active,joined_ms,updated_ms) VALUES($1,$2,1,$3,$3) ON CONFLICT(giveaway_id,user_id) DO UPDATE SET active=1,updated_ms=excluded.updated_ms',
      [id,userId,now]);
    else await q('UPDATE pc_giveaway_entries SET active=0,updated_ms=$1 WHERE giveaway_id=$2 AND user_id=$3',[now,id,userId]);
    await record(q,id,userId,join?'entered':'withdrew','User entry changed',now);
    await dirty(q,id);
    return {changed:true,entered:join};
  });
}
export function secureWeightedSelection(pool:Array<{userId:string;tickets:number}>,count:number,pick=(max:number)=>randomInt(max)){
  const available=pool.map(x=>({...x})),selected:string[]=[];
  while(selected.length<count&&available.length){
    const total=available.reduce((sum,x)=>sum+x.tickets,0);
    requireThat(total>0&&total<=Number.MAX_SAFE_INTEGER,400,'Invalid giveaway ticket pool.');
    let at=pick(total);
    requireThat(Number.isSafeInteger(at)&&at>=0&&at<total,500,'Random selection out of range.');
    let index=0;
    for(;index<available.length;index++){if(at<available[index].tickets)break;at-=available[index].tickets;}
    selected.push(available.splice(index,1)[0].userId);
  }
  return selected;
}
export async function validatedPool(db:Store,id:string,fetchMember:(userId:string)=>Promise<any>){
  const [g,entries,prior]=await Promise.all([getGiveaway(db,id),
    db.query('SELECT user_id,active FROM pc_giveaway_entries WHERE giveaway_id=$1 ORDER BY user_id',[id]),
    db.query('SELECT user_id FROM pc_giveaway_winners WHERE giveaway_id=$1',[id])]);
  const excluded=new Set(prior.map(row=>row.user_id));
  const snapshot=await Promise.all(entries.map(async row=>{
    let member:any=null;
    try{member=await fetchMember(row.user_id);}
    catch(error){
      if(error instanceof DiscordFailure&&error.status===404)member=null;
      else throw error;
    }
    const eligible=giveawayEligibleMember(row.user_id,member,g);
    const final=Number(row.active)===1&&!excluded.has(row.user_id)&&eligible.eligible;
    return {userId:row.user_id,eligible:final,booster:final&&eligible.booster,tickets:final?(eligible.booster?3:1):0,
      reason:excluded.has(row.user_id)?'previous winner':Number(row.active)!==1?'withdrawn':eligible.reason};
  }));
  return {giveaway:g,snapshot};
}
export async function concludeGiveaway(db:Store,id:string,actorId:string,fetchMember:(userId:string)=>Promise<any>,now=Date.now()){
  const {snapshot}=await validatedPool(db,id,fetchMember);
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g,404,'Giveaway unavailable.');
    if(g.status==='ended')return {drawn:false,id,winners:[]};
    requireThat(g.status==='active'&&Number(g.starts_ms)<=now,409,'Only an active giveaway can be concluded.');
    const current=await q('SELECT user_id FROM pc_giveaway_entries WHERE giveaway_id=$1 AND active=1',[id]);
    const eligible=new Set(current.map(row=>row.user_id));
    const pool=snapshot.filter(s=>s.eligible&&eligible.has(s.userId)).map(s=>({userId:s.userId,tickets:s.tickets}));
    const selected=secureWeightedSelection(pool,Number(g.winner_count));
    const drawId=randomUUID();
    await q('INSERT INTO pc_giveaway_draws(id,giveaway_id,round,actor_id,draw_type,snapshot,result,created_ms) VALUES($1,$2,1,$3,$4,$5,$6,$7)',
      [drawId,id,actorId,'random',JSON.stringify(snapshot),JSON.stringify(selected),now]);
    for(let i=0;i<selected.length;i++)
      await q('INSERT INTO pc_giveaway_winners(id,giveaway_id,draw_id,user_id,slot,draw_round,status,claim_deadline_ms) VALUES($1,$2,$3,$4,$5,1,$6,$7)',
        [randomUUID(),id,drawId,selected[i],i+1,'awaiting_claim',now+Number(g.claim_duration_ms)]);
    await q("UPDATE pc_giveaways SET status='ended',drawn_ms=$1,updated_ms=$1,version=version+1 WHERE id=$2",[now,id]);
    await record(q,id,actorId,'drawn','Selected '+selected.length+' unique winning members',now);
    await dirty(q,id);
    return {id,drawn:true,winners:selected,drawId};
  });
}
export async function manualGiveawayWinner(db:Store,id:string,who:StaffIdentity,userId:string,member:any,now=Date.now()){
  requireThat(who.isOwner,403,'Only the Owner can manually select a winner.');
  requireThat(discordId.test(userId),400,'Choose a Discord member.');
  return db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g&&g.status==='ended',409,'Manual winner selection requires an ended giveaway.');
    requireThat(giveawayEligibleMember(userId,member,g).eligible,403,'Manual winners must meet the giveaway eligibility rules at selection time.');
    const [prior]=await q('SELECT user_id FROM pc_giveaway_winners WHERE giveaway_id=$1 AND user_id=$2',[id,userId]);
    requireThat(!prior,409,'A previous winner cannot win again in this giveaway.');
    const [entry]=await q('SELECT active FROM pc_giveaway_entries WHERE giveaway_id=$1 AND user_id=$2',[id,userId]);
    requireThat(entry&&Number(entry.active)===1,403,'Choose a member with a valid active entry.');
    const [last]=await q('SELECT COALESCE(MAX(round),0)+1 AS r FROM pc_giveaway_draws WHERE giveaway_id=$1',[id]);
    const round=Number(last.r),drawId=randomUUID(),[slotRow]=await q('SELECT COALESCE(MAX(slot),0)+1 AS slot FROM pc_giveaway_winners WHERE giveaway_id=$1',[id]);
    const slot=Number(slotRow.slot);
    await q('INSERT INTO pc_giveaway_draws(id,giveaway_id,round,actor_id,draw_type,snapshot,result,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [drawId,id,round,who.id,'manual',JSON.stringify([{userId,manual:true}]),JSON.stringify([userId]),now]);
    await q('INSERT INTO pc_giveaway_winners(id,giveaway_id,draw_id,user_id,slot,draw_round,status,claim_deadline_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(),id,drawId,userId,slot,round,'awaiting_claim',now+Number(g.claim_duration_ms)]);
    await record(q,id,who.id,'owner-manual-winner','MANUALLY SELECTED '+userId+' (not a random draw)',now);
    await dirty(q,id);
    return {id,winner:userId,round,manual:true};
  });
}
export async function rerollGiveawaySlot(db:Store,id:string,slot:number,actorId:string,fetchMember:(userId:string)=>Promise<any>,now=Date.now()){
  requireThat(Number.isInteger(slot)&&slot>=1&&slot<=25,400,'Choose a valid winner slot.');
  const {snapshot}=await validatedPool(db,id,fetchMember);
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g&&g.status==='ended',409,'Rerolls require an ended giveaway.');
    const [previous]=await q("SELECT * FROM pc_giveaway_winners WHERE giveaway_id=$1 AND slot=$2 ORDER BY draw_round DESC LIMIT 1"+(db.dialect==='postgres'?' FOR UPDATE':''),[id,slot]);
    requireThat(previous,404,'Winner slot not found.');
    requireThat(previous.status==='awaiting_claim'||previous.status==='expired',409,'Claimed awards cannot be rerolled.');
    const prevExpired=previous.status==='expired';
    await q("UPDATE pc_giveaway_winners SET status='expired' WHERE id=$1",[previous.id]);
    const past=await q('SELECT user_id FROM pc_giveaway_winners WHERE giveaway_id=$1',[id]);
    const blocked=new Set(past.map(row=>row.user_id));
    const entries=await q('SELECT user_id FROM pc_giveaway_entries WHERE giveaway_id=$1 AND active=1',[id]);
    const validEntries=new Set(entries.map(e=>e.user_id));
    const pool=snapshot.filter(s=>s.eligible&&!blocked.has(s.userId)&&validEntries.has(s.userId))
      .map(s=>({userId:s.userId,tickets:s.tickets}));
    if(!pool.length){
      if(!prevExpired)await record(q,id,actorId,'reroll-exhausted','No additional eligible entrants available for slot '+slot,now);
      await dirty(q,id);
      return {id,slot,exhausted:true,winner:null};
    }
    const winner=secureWeightedSelection(pool,1)[0];
    const [latest]=await q('SELECT COALESCE(MAX(round),0)+1 AS r FROM pc_giveaway_draws WHERE giveaway_id=$1',[id]);
    const round=Number(latest.r),drawId=randomUUID();
    await q('INSERT INTO pc_giveaway_draws(id,giveaway_id,round,actor_id,draw_type,snapshot,result,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [drawId,id,round,actorId,'reroll',JSON.stringify(snapshot),JSON.stringify([winner]),now]);
    await q('INSERT INTO pc_giveaway_winners(id,giveaway_id,draw_id,user_id,slot,draw_round,status,claim_deadline_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(),id,drawId,winner,slot,round,'awaiting_claim',now+Number(g.claim_duration_ms)]);
    await record(q,id,actorId,'rerolled','Slot '+slot+' awarded to a new, previously unselected entrant',now);
    await dirty(q,id);
    return {id,slot,exhausted:false,winner,round};
  });
}
export async function claimGiveaway(db:Store,id:string,userId:string,characterId?:string,member?:any,now=Date.now()){
  requireThat(discordId.test(userId),400,'Discord member required.');
  return db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g&&g.status==='ended',409,'This giveaway cannot currently be claimed.');
    requireThat(giveawayEligibleMember(userId,member,g).eligible,403,'The winner must remain eligible at claim time.');
    const [winner]=await q('SELECT * FROM pc_giveaway_winners WHERE giveaway_id=$1 AND user_id=$2'+(db.dialect==='postgres'?' FOR UPDATE':''),[id,userId]);
    requireThat(winner,403,'You were not selected as a winner of this giveaway.');
    if(winner.status==='claimed'||winner.status==='claim_pending')return {claimed:winner.status==='claimed',pending:winner.status==='claim_pending',replayed:true};
    requireThat(winner.status==='awaiting_claim'&&Number(winner.claim_deadline_ms)>now,409,'Your claim deadline has expired.');
    if(g.prize_kind==='zeni'){
      requireThat(typeof characterId==='string'&&uuid.test(characterId),400,'Select an approved character for the Zeni bank prize.');
      const granted=await giveawayBankCredit(q,db,userId,characterId,winner.id,g.zeni_amount,id);
      await q("UPDATE pc_giveaway_winners SET status='claimed',character_id=$1,transaction_id=$2,claimed_ms=$3 WHERE id=$4",
        [characterId,granted.id,now,winner.id]);
      await record(q,id,userId,'zeni-claimed','Credited '+g.zeni_amount+' Zeni to chosen approved character bank.',now);
    }else{
      await q("UPDATE pc_giveaway_winners SET status='claim_pending',claimed_ms=$1 WHERE id=$2",[now,winner.id]);
      await record(q,id,userId,'manual-claim-pending','Winner requested a manually delivered prize. Staff confirmation required.',now);
    }
    await dirty(q,id);
    return {claimed:g.prize_kind==='zeni',pending:g.prize_kind==='manual',replayed:false};
  });
}
export async function confirmManualPrize(db:Store,id:string,who:StaffIdentity,winnerId:string,now=Date.now()){
  staffOnly(who);requireThat(discordId.test(winnerId),400,'Choose a winning member.');
  return db.transaction(async q=>{
    const [g]=await q('SELECT prize_kind FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g&&g.prize_kind==='manual',400,'Only manual prizes need staff confirmation.');
    const [w]=await q('SELECT id,status FROM pc_giveaway_winners WHERE giveaway_id=$1 AND user_id=$2',[id,winnerId]);
    requireThat(w,404,'Winner not found.');
    if(w.status==='claimed')return {replayed:true};
    requireThat(w.status==='claim_pending',409,'The winner must request the manual prize first.');
    await q("UPDATE pc_giveaway_winners SET status='claimed' WHERE id=$1",[w.id]);
    await record(q,id,who.id,'manual-prize-confirmed','Staff confirmed out-of-band prize delivery.',now);
    await dirty(q,id);
    return {replayed:false};
  });
}
export async function updateGiveawayStatus(db:Store,id:string,who:StaffIdentity,action:'pause'|'resume'|'cancel'|'start',now=Date.now()){
  staffOnly(who);
  return db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g,404,'Giveaway unavailable.');
    let status:GiveawayStatus=g.status,ends=Number(g.ends_ms);
    if(action==='pause')requireThat(status==='active',409,'Only active giveaways can be paused.'),status='paused';
    else if(action==='resume'){
      requireThat(status==='paused',409,'Only paused giveaways can resume.');
      ends+=Math.max(0,now-Number(g.updated_ms));status='active';
    }else if(action==='cancel')requireThat(['active','scheduled','paused'].includes(status),409,'This giveaway is already finished.'),status='cancelled';
    else if(action==='start')requireThat(status==='scheduled'&&Number(g.starts_ms)<=now,409,'Giveaway cannot start yet.'),status='active';
    await q('UPDATE pc_giveaways SET status=$1,ends_ms=$2,updated_ms=$3,version=version+1 WHERE id=$4',[status,ends,now,id]);
    await record(q,id,who.id,action,'Giveaway status changed to '+status,now);
    await dirty(q,id);
    return {id,status};
  });
}

export async function editGiveaway(db:Store,id:string,who:StaffIdentity,expectedVersion:number,
  changes:{title?:string;description?:string},now=Date.now()){
  staffOnly(who);giveawayId(id);
  requireThat(changes&&typeof changes==='object'&&!Array.isArray(changes),400,'Provide giveaway details to edit.');
  requireThat(changes.title!==undefined||changes.description!==undefined,400,'Specify a title or description to change.');
  requireThat(Number.isInteger(expectedVersion)&&expectedVersion>=1,400,'A valid giveaway version is required.');
  const title=changes.title===undefined?null:textValue(changes.title,120,'Giveaway title',true);
  const description=changes.description===undefined?null:textValue(changes.description,1600,'Giveaway description');
  return db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g,404,'Giveaway unavailable.');
    requireThat(['scheduled','active','paused'].includes(g.status)&&
      (g.status!=='active'||Number(g.ends_ms)>now),409,'A closed or drawn giveaway cannot be edited.');
    requireThat(Number(g.version)===expectedVersion,409,'Giveaway changed since you opened it. Refresh before editing.');
    const nextTitle=title===null?g.title:title,nextDescription=description===null?g.description:description;
    if(nextTitle===g.title&&nextDescription===g.description)return {id,version:expectedVersion,changed:false};
    await q('UPDATE pc_giveaways SET title=$1,description=$2,updated_ms=$3,version=version+1 WHERE id=$4',
      [nextTitle,nextDescription,now,id]);
    await record(q,id,who.id,'edited','Updated '+[nextTitle!==g.title?'title':null,nextDescription!==g.description?'description':null].filter(Boolean).join(' and '),now);
    await dirty(q,id);
    return {id,version:expectedVersion+1,changed:true};
  });
}

export async function extendGiveaway(db:Store,id:string,who:StaffIdentity,expectedVersion:number,minutes:number,now=Date.now()){
  staffOnly(who);giveawayId(id);
  requireThat(Number.isInteger(expectedVersion)&&expectedVersion>=1,400,'A valid giveaway version is required.');
  requireThat(Number.isSafeInteger(minutes)&&minutes>=1&&minutes<=525600,400,'Extend by 1–525600 whole minutes.');
  return db.transaction(async q=>{
    const [g]=await q('SELECT * FROM pc_giveaways WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(g,404,'Giveaway unavailable.');
    requireThat(['scheduled','active','paused'].includes(g.status)&&
      (g.status!=='active'||Number(g.ends_ms)>now),409,'A closed or drawn giveaway cannot be extended.');
    requireThat(Number(g.version)===expectedVersion,409,'Giveaway changed since you opened it. Refresh before extending.');
    const ends=Number(g.ends_ms)+minutes*60_000;
    requireThat(Number.isSafeInteger(ends)&&ends-Number(g.starts_ms)<=maxDurationMs,400,
      'The giveaway cannot run longer than one year from its start.');
    await q('UPDATE pc_giveaways SET ends_ms=$1,updated_ms=$2,version=version+1 WHERE id=$3',[ends,now,id]);
    await record(q,id,who.id,'extended','Entry deadline extended by '+minutes+' minute(s).',now);
    await dirty(q,id);
    return {id,endsMs:ends,version:expectedVersion+1};
  });
}

export async function giveawayPublic(db:Store,id:string){
  const g=await getGiveaway(db,id);
  const [entries,winners]=await Promise.all([
    db.query('SELECT COUNT(*) AS total FROM pc_giveaway_entries WHERE giveaway_id=$1 AND active=1',[id]),
    db.query('SELECT user_id,slot,draw_round,status,claim_deadline_ms,character_id,claimed_ms FROM pc_giveaway_winners WHERE giveaway_id=$1 ORDER BY slot,draw_round',[id])]);
  return {id:g.id,version:Number(g.version),title:g.title,description:g.description,channelId:g.channel_id,status:g.status,prizeKind:g.prize_kind,
    prizeText:g.prize_text,zeniAmount:g.zeni_amount,winnerCount:Number(g.winner_count),
    startsMs:Number(g.starts_ms),endsMs:Number(g.ends_ms),claimDurationMs:Number(g.claim_duration_ms),
    requiredRoles:JSON.parse(g.required_roles),excludedRoles:JSON.parse(g.excluded_roles),
    entries:Number(entries[0]?.total||0),winners,winnerHistory:winners.length,drawnMs:g.drawn_ms?Number(g.drawn_ms):null};
}
export async function listGiveaways(db:Store,limit=30){
  const rows=await db.query('SELECT id FROM pc_giveaways ORDER BY created_ms DESC LIMIT $1',[Math.min(100,Math.max(1,limit))]);
  return Promise.all(rows.map(g=>giveawayPublic(db,g.id)));
}
