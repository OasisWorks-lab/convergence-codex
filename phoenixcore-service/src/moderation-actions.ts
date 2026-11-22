import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {DiscordFailure} from './discord.ts';
import {requireThat,textValue,discordId} from './domain.ts';
import {hasNativeAdmin,requireModerator,verifyModerationTarget,type StaffIdentity} from './staff.ts';
import {proxyEvidence} from './moderation.ts';

export type SanctionAction='timeout'|'untimeout'|'kick'|'ban'|'unban';
type ActionInput={action:SanctionAction;targetId:string;receipt:string;reason?:string;minutes?:number;proxyPost?:string};
const actions=['timeout','untimeout','kick','ban','unban'];
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const requiredPermission:Record<SanctionAction,bigint>={
  timeout:1n<<40n,untimeout:1n<<40n,kick:1n<<1n,ban:1n<<2n,unban:1n<<2n
};
const adminFlag=1n<<3n;
const roleHeight=(ids:string[],roles:any[])=>roles.filter(x=>ids.includes(x.id)).reduce((n,x)=>Math.max(n,Number(x.position)||0),0);
const actorPerms=(ids:string[],roles:any[],guildId:string)=>roles.filter(x=>ids.includes(x.id)||x.id===guildId)
  .reduce((flags,x)=>flags|BigInt(/^\d+$/.test(String(x.permissions))?String(x.permissions):'0'),0n);

export async function verifySanctionAuthority(discord:Pick<Discord,'call'>,config:Config,actor:StaffIdentity,
  action:SanctionAction,targetId:string){
  requireModerator(actor);
  requireThat(actions.includes(action),400,'Choose a supported moderation action.');
  requireThat(discordId.test(targetId),400,'Choose a valid Discord user ID.');
  requireThat(targetId!==config.owner&&targetId!==config.clientId&&targetId!==actor.id,403,
    'You cannot sanction the server Owner, PhoenixCore or yourself.');
  if(action!=='unban')await verifyModerationTarget(discord,config,actor,targetId);
  const [guild,roles,staff,bot]=await Promise.all([
    discord.call('/guilds/'+config.guild),discord.call('/guilds/'+config.guild+'/roles'),
    discord.call('/guilds/'+config.guild+'/members/'+actor.id),
    discord.call('/guilds/'+config.guild+'/members/'+config.clientId)
  ]);
  requireThat(guild?.id===config.guild&&guild.owner_id!==targetId&&Array.isArray(roles)&&
    staff?.user?.id===actor.id&&bot?.user?.id===config.clientId,403,
    'Current Convergence moderation permissions could not be verified.');
  const staffRoles=staff.roles||[],botRoles=bot.roles||[];
  requireThat(actor.isOwner||staffRoles.some((roleId:string)=>roles.some((row:any)=>
    row.id===roleId&&hasNativeAdmin(row.permissions))),403,'Your Administrator permission is no longer active.');
  requireThat(actor.isOwner||roleHeight(staffRoles,roles)>0,403,'Your Discord staff role cannot be verified.');
  const permission=actorPerms(botRoles,roles,config.guild);
  requireThat((permission&adminFlag)!==0n||(permission&requiredPermission[action])!==0n,403,
    'PhoenixCore lacks the Discord permission for this moderation action.');
  if(action==='unban'){
    requireThat(targetId!==guild.owner_id,403,'The Discord Owner is protected.');
    const [ban]=await Promise.all([discord.call('/guilds/'+config.guild+'/bans/'+targetId)]);
    requireThat(ban?.user?.id===targetId&&!ban.user.bot,403,'The requested Discord user is not currently banned.');
  }
}

export async function queueSanction(db:Store,discord:Pick<Discord,'call'>,config:Config,
  actor:StaffIdentity,input:ActionInput,now=Date.now()){
  requireModerator(actor);
  requireThat(actions.includes(input.action),400,'Choose a valid manual moderation action.');
  requireThat(/^[\w-]{8,100}$/.test(input.receipt),400,'A unique Discord action receipt is required.');
  requireThat(discordId.test(input.targetId),400,'Choose a valid Discord user.');
  const duration=Number(input.minutes??0);
  requireThat(Number.isSafeInteger(duration)&&duration>=0&&duration<=525600,400,
    'Use a valid moderation duration in whole minutes.');
  requireThat(input.action!=='timeout'||duration>=1&&duration<=40320,400,
    'Timeouts require 1 to 40,320 minutes (Discord maximum of 28 days).');
  requireThat(input.action==='timeout'||input.action==='ban'||duration===0,400,
    'This action does not accept a duration.');
  const reason=textValue(input.reason||'',850,'Moderation reason');
  const evidence=input.proxyPost?await proxyEvidence(db,input.proxyPost,input.targetId):null;
  const [existing]=await db.query('SELECT c.id,c.actor_id,c.target_id,c.kind,s.status FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.receipt_id=$1',[input.receipt]);
  if(existing){
    requireThat(existing.actor_id===actor.id&&existing.target_id===input.targetId&&
      existing.kind===input.action,409,'Receipt already belongs to a different moderation action.');
    return {caseId:existing.id,status:existing.status,created:false};
  }
  await verifySanctionAuthority(discord,config,actor,input.action,input.targetId);
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',['mod-target:'+input.targetId]);
    const [duplicate]=await q('SELECT c.id,c.actor_id,c.target_id,c.kind,s.status FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.receipt_id=$1',[input.receipt]);
    if(duplicate){
      requireThat(duplicate.actor_id===actor.id&&duplicate.target_id===input.targetId&&duplicate.kind===input.action,
        409,'The receipt was used for a different sanction.');
      return {caseId:duplicate.id,status:duplicate.status,created:false};
    }
    const [busy]=await q("SELECT c.id FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.target_id=$1 AND s.status IN ('pending','applying') LIMIT 1",[input.targetId]);
    requireThat(!busy,409,'Another sanction for this member is unfinished. Review its private case before proceeding.');
    const id=randomUUID(),until=(input.action==='timeout'||input.action==='ban')&&duration?now+duration*60000:null;
    await q('INSERT INTO pc_mod_cases(id,receipt_id,target_id,actor_id,kind,reason,created_ms,source_message_id,posted_message_id,source_channel_id,character_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0)',
      [id,input.receipt,input.targetId,actor.id,input.action,reason,now,
        evidence?.sourceMessageId||null,evidence?.postedMessageId||null,
        evidence?.sourceChannelId||null,evidence?.characterId||null]);
    await q('INSERT INTO pc_mod_sanctions(case_id,action,status,until_ms,updated_ms) VALUES($1,$2,$3,$4,$5)',
      [id,input.action,'pending',until,now]);
    await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'sanction-queued','Action authorized; awaiting the Discord API operation.',now]);
    return {caseId:id,status:'pending',created:true};
  });
}

function auditReason(caseId:string,reason:string){
  return encodeURIComponent(('PhoenixCore case '+caseId+' · '+(reason||'Unspecified')).slice(0,350));
}
async function discordSanction(discord:Pick<Discord,'call'>,config:Config,record:any,until:number|null){
  const target=String(record.target_id),kind=String(record.kind),reason=String(record.reason||'');
  const base='/guilds/'+config.guild;
  const headers={'X-Audit-Log-Reason':auditReason(record.id,reason)};
  if(kind==='timeout'||kind==='untimeout')await discord.call(base+'/members/'+target,{
    method:'PATCH',headers,body:JSON.stringify({communication_disabled_until:kind==='untimeout'?null:new Date(Number(until)).toISOString()})
  });
  else if(kind==='kick')await discord.call(base+'/members/'+target,{method:'DELETE',headers});
  else if(kind==='ban')await discord.call(base+'/bans/'+target,{method:'PUT',headers,
    body:JSON.stringify({delete_message_seconds:0})});
  else if(kind==='unban')await discord.call(base+'/bans/'+target,{method:'DELETE',headers});
  else throw Error('Unsupported moderation kind');
}

export async function executeQueuedSanction(db:Store,discord:Pick<Discord,'call'>,config:Config,
  actor:StaffIdentity,caseId:string,now=Date.now()){
  requireModerator(actor);requireThat(uuid.test(caseId),400,'Choose a sanction case.');
  const selected=await db.transaction(async q=>{
    const [row]=await q('SELECT c.*,s.status,s.until_ms FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.id=$1'+
      (db.dialect==='postgres'?' FOR UPDATE OF s':''),[caseId]);
    requireThat(row&&row.actor_id===actor.id,403,'Only the initiating moderator can execute this queued action.');
    if(row.status!=='pending')return {...row,run:false};
    const changed=await q("UPDATE pc_mod_sanctions SET status='applying',updated_ms=$1 WHERE case_id=$2 AND status='pending' RETURNING case_id",
      [now,caseId]);
    return {...row,run:changed.length>0};
  });
  if(!selected.run)return {caseId,status:selected.status,applied:false};
  try{
    await verifySanctionAuthority(discord,config,actor,selected.kind,selected.target_id);
    await discordSanction(discord,config,selected,selected.until_ms?Number(selected.until_ms):null);
  }catch(error:any){
    const explanation=error instanceof DiscordFailure?'Discord HTTP '+error.status+
      (error.code?' ('+error.code+')':''):'Discord action could not be confirmed';
    await db.transaction(async q=>{
      await q("UPDATE pc_mod_sanctions SET status='needs-review',last_error=$1,updated_ms=$2 WHERE case_id=$3 AND status='applying'",
        [explanation,Date.now(),caseId]);
      await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),caseId,actor.id,'delivery-unconfirmed',
          'Discord result uncertain; do not replay blindly. '+explanation,Date.now()]);
    });
    return {caseId,status:'needs-review',applied:false};
  }
  await db.transaction(async q=>{
    const now2=Date.now();
    await q("UPDATE pc_mod_sanctions SET status='applied',applied_ms=$1,updated_ms=$1,last_error='' WHERE case_id=$2 AND status='applying'",
      [now2,caseId]);
    await q('UPDATE pc_mod_cases SET active=$1 WHERE id=$2',
      [['ban','timeout'].includes(selected.kind)?1:0,caseId]);
    if(['ban','unban','timeout','untimeout'].includes(selected.kind)){
      const previousKind=['ban','unban'].includes(selected.kind)?'ban':'timeout';
      const previous=await q("SELECT c.id FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.target_id=$1 AND c.kind=$2 AND c.id!=$3 AND c.active=1 AND s.status='applied'",
        [selected.target_id,previousKind,caseId]);
      for(const row of previous){
        await q('UPDATE pc_mod_cases SET active=0 WHERE id=$1',[row.id]);
        await q("UPDATE pc_mod_sanctions SET status='superseded',ended_ms=$1,updated_ms=$1 WHERE case_id=$2",
          [now2,row.id]);
      }
    }
    await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),caseId,actor.id,'discord-applied','Discord confirmed the manual '+selected.kind+' operation.',now2]);
    if(selected.until_ms&&['ban','timeout'].includes(selected.kind)){
      await q('INSERT INTO pc_core_jobs(id,job_type,recipient_id,payload,due_ms,created_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        ['mod-expire:'+caseId,'moderation-expiry',selected.target_id,
          JSON.stringify({caseId}),Number(selected.until_ms),now2]);
    }
    if(!['unban','untimeout'].includes(selected.kind))
      await q('INSERT INTO pc_core_jobs(id,job_type,recipient_id,payload,due_ms,created_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
        ['mod-action-notice:'+caseId,'moderation-action-notice',selected.target_id,
          JSON.stringify({caseId,action:selected.kind,reason:selected.reason||'Unspecified',
            untilMs:selected.until_ms||null}),now2,now2]);
  });
  return {caseId,status:'applied',applied:true};
}

export async function expireModerationSanction(db:Store,discord:Pick<Discord,'call'>,
  config:Config,caseId:string,now=Date.now()){
  requireThat(uuid.test(caseId),400,'Unknown moderation expiry.');
  const [row]=await db.query('SELECT c.id,c.target_id,c.kind,c.active,s.status,s.until_ms FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.id=$1',[caseId]);
  if(!row||row.status!=='applied'||Number(row.active)!==1)return {status:'superseded',changed:false};
  requireThat(row.until_ms&&Number(row.until_ms)<=now,409,'Sanction expiry is not due.');
  let state:'expired'|'superseded'='expired';
  if(row.kind==='ban'){
    let ban:any=null;
    try{ban=await discord.call('/guilds/'+config.guild+'/bans/'+row.target_id);}
    catch(error){if(!(error instanceof DiscordFailure&&error.status===404))throw error;}
    if(!ban||!String(ban.reason||'').includes('PhoenixCore case '+caseId))state='superseded';
    else await discord.call('/guilds/'+config.guild+'/bans/'+row.target_id,{
      method:'DELETE',headers:{'X-Audit-Log-Reason':auditReason(caseId,'Timed PhoenixCore ban expired')}
    });
  }else if(row.kind!=='timeout')return {status:'superseded',changed:false};
  const changed=await db.transaction(async q=>{
    const [current]=await q('SELECT c.active,s.status FROM pc_mod_cases c JOIN pc_mod_sanctions s ON s.case_id=c.id WHERE c.id=$1'+
      (db.dialect==='postgres'?' FOR UPDATE OF s':''),[caseId]);
    if(!current||current.status!=='applied'||Number(current.active)!==1)return false;
    await q('UPDATE pc_mod_cases SET active=0 WHERE id=$1',[caseId]);
    await q('UPDATE pc_mod_sanctions SET status=$1,ended_ms=$2,updated_ms=$2 WHERE case_id=$3',[state,now,caseId]);
    await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),caseId,config.clientId,state==='expired'?'sanction-expired':'expiry-superseded',
        state==='expired'?'Configured sanction duration reached.':'Discord sanction was changed externally; no automatic unban performed.',now]);
    return true;
  });
  return {status:state,changed};
}

export async function reconcileUnconfirmedSanctions(db:Store,now=Date.now()){
  const stale=await db.query("SELECT case_id FROM pc_mod_sanctions WHERE status='applying' AND updated_ms<=$1",
    [now-120000]);
  let changed=0;
  for(const row of stale){
    await db.transaction(async q=>{
      const [candidate]=await q('SELECT status,updated_ms FROM pc_mod_sanctions WHERE case_id=$1'+
        (db.dialect==='postgres'?' FOR UPDATE':''),[row.case_id]);
      if(candidate?.status!=='applying'||Number(candidate.updated_ms)>now-120000)return;
      await q("UPDATE pc_mod_sanctions SET status='needs-review',last_error=$1,updated_ms=$2 WHERE case_id=$3",
        ['Bot restarted or lost confirmation during the Discord operation. Verify manually before taking any new action.',now,row.case_id]);
      await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),row.case_id,'system','delivery-unconfirmed','An interrupted action requires human review; no retry was sent.',now]);
      changed++;
    });
  }
  return changed;
}

export async function moderationWorkspace(db:Store,actor:StaffIdentity,targetId='',page=1){
  requireModerator(actor);
  requireThat(!targetId||discordId.test(targetId),400,'Choose an exact Discord member ID.');
  requireThat(Number.isSafeInteger(page)&&page>=1&&page<=1000,400,'Choose a valid moderation history page.');
  const where=targetId?' WHERE c.target_id=$1':'',args=targetId?[targetId]:[];
  const [total]=await db.query('SELECT COUNT(*) AS n FROM pc_mod_cases c'+where,args);
  const rows=await db.query(`SELECT c.id,c.target_id,c.actor_id,c.kind,c.reason,c.created_ms,c.active,
    c.removed_by,c.removed_ms,c.source_message_id,c.posted_message_id,c.character_id,
    s.status AS sanction_status,s.until_ms,s.applied_ms,s.ended_ms,s.last_error,
    j.status AS expiry_job_status,j.last_error AS expiry_job_error
    FROM pc_mod_cases c LEFT JOIN pc_mod_sanctions s ON s.case_id=c.id
    LEFT JOIN pc_core_jobs j ON j.id=('mod-expire:' || c.id)`+where+
    ' ORDER BY c.created_ms DESC,c.id DESC LIMIT 25 OFFSET $'+(args.length+1),
    [...args,(page-1)*25]);
  return {total:Number(total.n),page,pages:Math.max(1,Math.ceil(Number(total.n)/25)),cases:rows,
    ...(targetId?{targetId}:{} )};
}
