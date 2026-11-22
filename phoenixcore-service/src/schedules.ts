import {createHash,randomUUID} from 'node:crypto';
import {requireThat,textValue,discordId} from './domain.ts';
import type {Actor} from './domain.ts';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {DiscordFailure} from './discord.ts';
import {communityEnabled} from './community.ts';

export type ScheduleKind='announcement'|'bump-reminder';
export type ScheduleStyle='text'|'embed';
export type ScheduleInput={receipt:string;name:string;kind:ScheduleKind;channelId:string;body:string;
  mentionRole?:string;firstDueMs:number;intervalMinutes:number;maxRuns:number;
  style:ScheduleStyle;color?:number;imageUrl?:string};
export const scheduleIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const requireOwner=(who:Actor)=>requireThat(who.isOwner,403,'Only the Convergence Owner can manage scheduled announcements.');
function validateSchedule(input:ScheduleInput,now:number){
  requireThat(input&&typeof input==='object',400,'Choose a valid announcement schedule.');
  requireThat(/^[\w-]{8,100}$/.test(String(input.receipt||'')),400,'A unique schedule receipt is required.');
  const name=textValue(input.name,100,'Schedule name',true);
  requireThat(input.kind==='announcement'||input.kind==='bump-reminder',400,'Choose announcement or bump reminder.');
  requireThat(discordId.test(String(input.channelId||'')),400,'Choose a valid Convergence text channel.');
  const body=textValue(input.body,1800,'Scheduled message',input.kind==='announcement');
  const mentionRole=String(input.mentionRole||'').trim();
  requireThat(!mentionRole||discordId.test(mentionRole),400,'Choose a valid Discord role or no mention.');
  requireThat(Number.isSafeInteger(input.firstDueMs)&&input.firstDueMs>=now+30000&&
    input.firstDueMs<=now+365*86400000+15000,400,
    'First delivery must be between approximately 1 minute and 1 year from now.');
  requireThat(Number.isSafeInteger(input.intervalMinutes)&&(
    input.intervalMinutes===0||input.intervalMinutes>=15&&input.intervalMinutes<=43200),
    400,'Choose one-time delivery (0) or an interval from 15 to 43,200 minutes.');
  requireThat(Number.isSafeInteger(input.maxRuns)&&input.maxRuns>=0&&input.maxRuns<=365,
    400,'Choose 0 for unlimited recurring runs, or 1–365 runs.');
  requireThat(input.intervalMinutes!==0||input.maxRuns===1,400,'One-time schedules must have exactly one run.');
  requireThat(input.style==='text'||input.style==='embed',400,'Choose plain text or an embed.');
  requireThat(input.kind!=='bump-reminder'||input.style==='text',400,
    'DISBOARD bump prompts are plain-text reminders only.');
  const color=input.color??0x5865f2,imageUrl=String(input.imageUrl||'').trim();
  requireThat(Number.isSafeInteger(color)&&color>=0&&color<=0xffffff,400,'Choose a valid embed color.');
  requireThat(!imageUrl||input.style==='embed'&&input.kind==='announcement'&&imageUrl.length<=500&&
    /^https:\/\/[^\s]+$/i.test(imageUrl),400,'Use an HTTPS image URL on an announcement embed.');
  return {name,kind:input.kind,channelId:input.channelId,body,mentionRole,
    firstDueMs:input.firstDueMs,intervalMinutes:input.intervalMinutes,maxRuns:input.maxRuns,
    style:input.style,color,imageUrl};
}
function normalize(row:any){
  return {id:String(row.id),name:String(row.name),kind:String(row.kind),channelId:String(row.channel_id),
    body:String(row.body),mentionRole:String(row.mention_role||''),intervalMinutes:Number(row.interval_minutes),
    maxRuns:Number(row.max_runs),sentCount:Number(row.sent_count),nextDueMs:Number(row.next_due_ms),
    status:String(row.status),revision:Number(row.revision),style:String(row.style),
    color:Number(row.color),imageUrl:String(row.image_url||''),lastError:String(row.last_error||''),
    lastSentMs:row.last_sent_ms?Number(row.last_sent_ms):null,createdMs:Number(row.created_ms),
    pendingStatus:row.pending_status||null,pendingAttempt:row.pending_attempt?Number(row.pending_attempt):0};
}
export async function createSchedule(db:Store,actor:Actor,input:ScheduleInput,now=Date.now()){
  requireOwner(actor);const v=validateSchedule(input,now);
  return db.transaction(async q=>{
    const [existing]=await q('SELECT id,creator_id FROM pc_schedules WHERE receipt_id=$1',[input.receipt]);
    if(existing){
      requireThat(existing.creator_id===actor.id,409,'Schedule receipt is already assigned.');
      return {id:existing.id,created:false};
    }
    const id=randomUUID();
    await q(`INSERT INTO pc_schedules(id,receipt_id,creator_id,name,kind,channel_id,body,mention_role,
      interval_minutes,max_runs,next_due_ms,status,style,color,image_url,created_ms,updated_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,$15,$15)`,
      [id,input.receipt,actor.id,v.name,v.kind,v.channelId,v.body,v.mentionRole,
        v.intervalMinutes,v.maxRuns,v.firstDueMs,v.style,v.color,v.imageUrl,now]);
    await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'created','Owner created unpublished schedule.',now]);
    return {id,created:true};
  });
}
export async function editSchedule(db:Store,actor:Actor,id:string,revision:number,input:ScheduleInput,now=Date.now()){
  requireOwner(actor);requireThat(scheduleIdPattern.test(id),400,'Choose a schedule ID.');
  const v=validateSchedule(input,now);
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_schedules WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Schedule not found.');
    requireThat(Number(row.revision)===revision,409,'Schedule changed. Reload before editing.');
    requireThat(row.status==='draft'||row.status==='paused',409,'Pause a published schedule before editing.');
    const [pending]=await q("SELECT id FROM pc_schedule_deliveries WHERE schedule_id=$1 AND status IN ('pending','needs-review','failed') LIMIT 1",[id]);
    requireThat(!pending,409,'Resolve or skip the pending delivery before editing its schedule.');
    await q(`UPDATE pc_schedules SET name=$1,kind=$2,channel_id=$3,body=$4,mention_role=$5,
      interval_minutes=$6,max_runs=$7,next_due_ms=$8,style=$9,color=$10,image_url=$11,
      revision=revision+1,updated_ms=$12 WHERE id=$13`,
      [v.name,v.kind,v.channelId,v.body,v.mentionRole,v.intervalMinutes,v.maxRuns,
        v.firstDueMs,v.style,v.color,v.imageUrl,now,id]);
    await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'edited','Owner updated future delivery configuration.',now]);
    return {id,revision:revision+1};
  });
}
export async function transitionSchedule(db:Store,actor:Actor,id:string,revision:number,
  action:'publish'|'pause'|'resume'|'cancel',now=Date.now()){
  requireOwner(actor);requireThat(scheduleIdPattern.test(id),400,'Choose a schedule ID.');
  requireThat(['publish','pause','resume','cancel'].includes(action),400,'Choose a valid schedule action.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_schedules WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Schedule not found.');
    requireThat(Number(row.revision)===revision,409,'Schedule changed. Reload before continuing.');
    requireThat(action==='publish'?row.status==='draft':
      action==='pause'?row.status==='active':
      action==='resume'?row.status==='paused':
      ['draft','active','paused'].includes(row.status),
      409,'This schedule cannot make that transition.');
    if(action==='resume'){
      const [unresolved]=await q("SELECT id FROM pc_schedule_deliveries WHERE schedule_id=$1 AND status IN ('needs-review','failed') LIMIT 1",[id]);
      requireThat(!unresolved,409,'Resolve the uncertain delivery before resuming.');
    }
    const status=action==='publish'||action==='resume'?'active':action==='pause'?'paused':'cancelled';
    await q('UPDATE pc_schedules SET status=$1,revision=revision+1,updated_ms=$2 WHERE id=$3',
      [status,now,id]);
    await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,status,'Owner selected '+action+'.',now]);
    return {id,status,revision:revision+1};
  });
}
export async function listSchedules(db:Store,actor:Actor){
  requireOwner(actor);
  const rows=await db.query(`SELECT s.*,d.status AS pending_status,d.attempts AS pending_attempt
    FROM pc_schedules s LEFT JOIN pc_schedule_deliveries d ON d.schedule_id=s.id AND d.occurrence=s.sent_count+1
    ORDER BY s.created_ms DESC,s.id DESC LIMIT 100`);
  return rows.map(normalize);
}
export async function scheduleDetail(db:Store,actor:Actor,id:string){
  requireOwner(actor);requireThat(scheduleIdPattern.test(id),400,'Choose a schedule ID.');
  const [row]=await db.query(`SELECT s.*,d.status AS pending_status,d.attempts AS pending_attempt
    FROM pc_schedules s LEFT JOIN pc_schedule_deliveries d ON d.schedule_id=s.id AND d.occurrence=s.sent_count+1
    WHERE s.id=$1`,[id]);
  requireThat(row,404,'Schedule not found.');
  const events=await db.query('SELECT actor_id,event,detail,at_ms FROM pc_schedule_events WHERE schedule_id=$1 ORDER BY at_ms DESC,id DESC LIMIT 35',[id]);
  const deliveries=await db.query('SELECT occurrence,due_ms,status,message_id,last_error FROM pc_schedule_deliveries WHERE schedule_id=$1 ORDER BY occurrence DESC LIMIT 20',[id]);
  return {schedule:normalize(row),events,deliveries};
}
function calculateNext(entry:any,now:number){
  const occurrence=Number(entry.sent_count)+1,interval=Number(entry.interval_minutes),
    maxRuns=Number(entry.max_runs),complete=interval===0||maxRuns>0&&occurrence>=maxRuns;
  const nextDue=complete?Number(entry.next_due_ms):
    Math.max(now+interval*60000,Number(entry.next_due_ms)+interval*60000);
  return {occurrence,complete,nextDue};
}
export async function recoverSchedule(db:Store,actor:Actor,id:string,revision:number,
  choice:'retry'|'skip',now=Date.now()){
  requireOwner(actor);requireThat(scheduleIdPattern.test(id),400,'Choose a schedule ID.');
  requireThat(choice==='retry'||choice==='skip',400,'Select retry or skip.');
  return db.transaction(async q=>{
    const [s]=await q('SELECT * FROM pc_schedules WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(s&&s.status==='paused'&&Number(s.revision)===revision,409,
      'Pause status or revision changed; refresh the schedule.');
    const [d]=await q("SELECT * FROM pc_schedule_deliveries WHERE schedule_id=$1 AND occurrence=$2",
      [id,Number(s.sent_count)+1]);
    requireThat(d&&['needs-review','failed'].includes(d.status),409,'No failed or uncertain occurrence requires recovery.');
    if(choice==='retry'){
      await q("UPDATE pc_schedule_deliveries SET status='pending',attempts=0,retry_ms=0,lease=NULL,lease_until=0,last_error='' WHERE id=$1",[d.id]);
      await q("UPDATE pc_schedules SET status='active',revision=revision+1,updated_ms=$1,last_error='' WHERE id=$2",[now,id]);
    }else{
      const next=calculateNext(s,now);
      await q("UPDATE pc_schedule_deliveries SET status='skipped',lease=NULL,lease_until=0 WHERE id=$1",[d.id]);
      await q('UPDATE pc_schedules SET status=$1,sent_count=$2,next_due_ms=$3,revision=revision+1,updated_ms=$4,last_error=$5 WHERE id=$6',
        [next.complete?'completed':'active',next.occurrence,next.nextDue,now,
          'Owner skipped one unresolved delivery after checking the Discord channel.',id]);
    }
    await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'recovered',choice==='retry'?
        'Owner manually chose retry; a previously successful unconfirmed post may be duplicated.':
        'Owner intentionally skipped uncertain occurrence without a new Discord post.',now]);
    return {id,recovery:choice,status:choice==='retry'?'active':'reconciled'};
  });
}
export async function deliverSchedule(db:Store,discord:Pick<Discord,'call'>,config:Config,now=Date.now()){
  const token=randomUUID();
  const job=await db.transaction(async q=>{
    const [s]=await q(`SELECT s.*,d.id AS existing_id,d.status AS delivery_status,
        d.attempts AS delivery_attempts,d.lease_until AS delivery_lease_until
      FROM pc_schedules s LEFT JOIN pc_schedule_deliveries d
        ON d.schedule_id=s.id AND d.occurrence=s.sent_count+1
      WHERE s.status='active' AND s.next_due_ms<=$1
        AND (d.id IS NULL OR (d.status='pending' AND d.retry_ms<=$1 AND d.lease_until<=$1))
      ORDER BY s.next_due_ms,s.id LIMIT 1`+(db.dialect==='postgres'?' FOR UPDATE OF s SKIP LOCKED':''),[now]);
    if(!s)return null;
    const occurrence=Number(s.sent_count)+1,id='pcsched:'+s.id+':'+occurrence;
    if(s.existing_id&&Number(s.delivery_lease_until)>0&&Number(s.delivery_attempts)>0){
      await q("UPDATE pc_schedule_deliveries SET status='needs-review',last_error=$1,lease=NULL,lease_until=0 WHERE id=$2",
        ['A worker may have posted before losing confirmation. Verify the channel before retrying.',id]);
      await q("UPDATE pc_schedules SET status='paused',revision=revision+1,last_error=$1,updated_ms=$2 WHERE id=$3",
        ['Unconfirmed prior delivery requires Owner review.',now,s.id]);
      await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),s.id,config.clientId,'delivery-uncertain','Expired in-flight lease; no automatic replay.',now]);
      return {manualReview:true};
    }
    await q(`INSERT INTO pc_schedule_deliveries(id,schedule_id,occurrence,due_ms,status,attempts,retry_ms,lease,lease_until)
      VALUES($1,$2,$3,$4,'pending',1,0,$5,$6)
      ON CONFLICT(id) DO UPDATE SET attempts=pc_schedule_deliveries.attempts+1,lease=excluded.lease,
        lease_until=excluded.lease_until`,
      [id,s.id,occurrence,Number(s.next_due_ms),token,now+45000]);
    return {id,token,entry:s,occurrence};
  });
  if(!job)return false;
  if('manualReview' in job)return true;
  const {entry,id,occurrence}=job;
  try{
    requireThat(await communityEnabled(db,'schedules'),409,'Scheduled announcements are disabled.');
    const [still]=await db.query('SELECT status,sent_count FROM pc_schedules WHERE id=$1',[entry.id]);
    requireThat(still?.status==='active'&&Number(still.sent_count)===occurrence-1,409,
      'Schedule was paused or cancelled before posting.');
    const ch=await discord.call('/channels/'+entry.channel_id);
    requireThat(ch?.guild_id===config.guild&&[0,5].includes(Number(ch.type)),403,
      'The scheduled message channel is unavailable in Convergence.');
    const mention=entry.mention_role?'<@&'+entry.mention_role+'>\n':'',
      content=entry.kind==='bump-reminder'?
        (entry.body||'DISBOARD bump reminder: an authorized member can run /bump manually.')+
          '\nPhoenixCore does not bump DISBOARD automatically.':
        String(entry.body);
    const allowed_mentions={parse:[],roles:entry.mention_role?[entry.mention_role]:[]};
    const payload:any={allowed_mentions,
      nonce:createHash('sha256').update(id).digest('base64url').slice(0,24),enforce_nonce:true};
    if(entry.style==='embed'&&entry.kind==='announcement'){
      payload.content=mention.trim();
      payload.embeds=[{title:String(entry.name).slice(0,100),description:content,
        color:Number(entry.color),...(entry.image_url?{image:{url:entry.image_url}}:{})}];
    }else payload.content=(mention+content).slice(0,1950);
    const msg=await discord.call('/channels/'+entry.channel_id+'/messages',{
      method:'POST',body:JSON.stringify(payload)});
    requireThat(discordId.test(String(msg?.id||'')),502,'Discord did not provide a message ID.');
    await db.transaction(async q=>{
      const [latest]=await q('SELECT * FROM pc_schedules WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[entry.id]);
      const [delivery]=await q("SELECT status,lease FROM pc_schedule_deliveries WHERE id=$1",[id]);
      if(delivery?.status!=='pending'||delivery.lease!==job.token)return;
      await q("UPDATE pc_schedule_deliveries SET status='delivered',message_id=$1,lease=NULL,lease_until=0,last_error='' WHERE id=$2",
        [String(msg.id),id]);
      const next=calculateNext(latest,now);
      await q('UPDATE pc_schedules SET sent_count=$1,status=$2,next_due_ms=$3,revision=revision+1,last_sent_ms=$4,updated_ms=$4,last_error=$5 WHERE id=$6',
        [next.occurrence,next.complete?'completed':latest.status,next.nextDue,now,'',entry.id]);
      await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),entry.id,config.clientId,'delivered','Discord confirmed occurrence '+occurrence+'.',now]);
    });
  }catch(error:any){
    const throttled=error instanceof DiscordFailure&&error.status===429;
    const suppressed=error?.status===409&&!(error instanceof DiscordFailure);
    if(suppressed){
      await db.query('UPDATE pc_schedule_deliveries SET lease=NULL,lease_until=0,retry_ms=$1 WHERE id=$2 AND lease=$3',
        [now+15000,id,token]);
      return true;
    }
    const note=error instanceof DiscordFailure?'Discord API '+error.status:
      'Discord posting could not be confirmed; verify the channel before any retry.';
    await db.transaction(async q=>{
      await q('UPDATE pc_schedule_deliveries SET status=$1,retry_ms=$2,lease=NULL,lease_until=0,last_error=$3 WHERE id=$4 AND lease=$5',
        [throttled?'pending':'needs-review',now+Math.max(5000,error instanceof DiscordFailure?error.retryMs||0:0),note,id,token]);
      if(!throttled){
        await q('UPDATE pc_schedules SET status=$1,revision=revision+1,last_error=$2,updated_ms=$3 WHERE id=$4',
          ['paused',note,now,entry.id]);
        await q('INSERT INTO pc_schedule_events(id,schedule_id,actor_id,event,detail,at_ms) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(),entry.id,config.clientId,'delivery-unconfirmed',note,now]);
      }
    });
  }
  return true;
}
