import {createHash,randomUUID} from 'node:crypto';
import {requireThat,textValue,discordId} from './domain.ts';
import type {Store} from './db.ts';
import {DiscordFailure,type Discord,type Config} from './discord.ts';
import {expireModerationSanction} from './moderation-actions.ts';

export const maxReminderMinutes=10080;
export async function createReminder(db:Store,userId:string,receipt:string,minutes:number,message:string,now=Date.now()){
  requireThat(discordId.test(userId),400,'Only verified Discord users can schedule reminders.');
  requireThat(/^[\w-]{8,100}$/.test(receipt),400,'Invalid interaction receipt.');
  requireThat(Number.isInteger(minutes)&&minutes>=1&&minutes<=maxReminderMinutes,400,'Choose a reminder between 1 minute and 7 days.');
  const content=textValue(message,500,'Reminder text',true),id='remind:'+receipt;
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);
    const [existing]=await q('SELECT id,due_ms FROM pc_core_jobs WHERE id=$1',[id]);
    if(existing)return {id:existing.id,dueAt:Number(existing.due_ms),created:false};
    const [total]=await q("SELECT COUNT(*) AS n FROM pc_core_jobs WHERE recipient_id=$1 AND job_type='reminder' AND status='pending'",[userId]);
    requireThat(Number(total.n)<20,429,'You already have 20 pending reminders. Cancel one before scheduling another.');
    const dueAt=now+minutes*60000;
    await q('INSERT INTO pc_core_jobs(id,job_type,recipient_id,payload,due_ms,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [id,'reminder',userId,JSON.stringify({message:content}),dueAt,now]);
    return {id,dueAt,created:true};
  });
}
export async function listReminders(db:Store,userId:string){
  requireThat(discordId.test(userId),400,'Choose a valid Discord user.');
  return db.query("SELECT id,due_ms,payload,status FROM pc_core_jobs WHERE recipient_id=$1 AND job_type='reminder' AND status='pending' ORDER BY due_ms LIMIT 20",[userId]);
}
export async function cancelReminder(db:Store,userId:string,id:string){
  requireThat(id.startsWith('remind:')&&id.length<=110,400,'Choose a reminder ID you created.');
  const changed=await db.query("UPDATE pc_core_jobs SET status='cancelled',lease=NULL,lease_until=0 WHERE id=$1 AND job_type='reminder' AND recipient_id=$2 AND status='pending' AND lease_until<=$3 RETURNING id",
    [id,userId,Date.now()]);
  return changed.length>0;
}
export async function deliverScheduledJob(db:Store,discord:Pick<Discord,'call'>,now=Date.now(),config?:Config):Promise<boolean>{
  const token=randomUUID();
  const job=await db.transaction(async q=>{
    const [row]=await q("SELECT * FROM pc_core_jobs WHERE status='pending' AND due_ms<=$1 AND lease_until<=$1 ORDER BY due_ms,id LIMIT 1"+(db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!row)return null;
    await q('UPDATE pc_core_jobs SET lease=$1,lease_until=$2 WHERE id=$3',[token,now+45000,row.id]);
    return row;
  });
  if(!job)return false;
  try{
    const data=JSON.parse(job.payload);
    if(job.job_type==='moderation-expiry'){
      requireThat(config,503,'Moderation expiry requires the configured Convergence bot.');
      await expireModerationSanction(db,discord,config,String(data.caseId||''),now);
      await db.query("UPDATE pc_core_jobs SET status='delivered',lease=NULL,lease_until=0,last_error=NULL WHERE id=$1 AND lease=$2",
        [job.id,token]);
      return true;
    }
    let content:string;
    if(job.job_type==='reminder')content='⏰ **Your PhoenixCore reminder**\n'+String(data.message||'').slice(0,500);
    else if(job.job_type==='moderation-notice')content=
      '**Convergence staff warning**\nCase: '+String(data.caseId||'').slice(0,50)+'\n'+
      'Reason: '+String(data.reason||'Unspecified').slice(0,900)+'\n'+
      'Warnings are reviewed by staff. This notice does not announce an automatic ban or other penalty.';
    else if(job.job_type==='automod-alert'){
      content='**PhoenixCore automod observation — audit only**\\n'+
        'Possible issue: '+String(data.rules||'').slice(0,150)+
        '\\nMember: '+String(data.memberId||'').slice(0,24)+
        '\\nChannel: '+String(data.channelId||'').slice(0,24)+
        '\\nMessage: '+String(data.messageId||'').slice(0,24)+
        '\\nNo message deletion, warning or sanction was applied. Review the Moderation Center.';
    }
    else if(job.job_type==='moderation-action-notice'){
      const kind=String(data.action||'sanction'),until=Number(data.untilMs||0);
      content='**Convergence moderation notice**\nAction: '+kind+
        '\nCase: '+String(data.caseId||'').slice(0,60)+
        '\nReason: '+String(data.reason||'Unspecified').slice(0,850)+
        (until?'\nExpected end: <t:'+Math.floor(until/1000)+':F>':'')+
        '\nIf you wish to appeal, contact PhoenixCore Support through a private message.';
    }
    else throw Error('Unsupported scheduled job type');
    const channel=await discord.call('/users/@me/channels',{method:'POST',body:JSON.stringify({recipient_id:job.recipient_id})});
    requireThat(/^\d{17,20}$/.test(String(channel?.id||'')),502,'Discord did not provide a usable DM channel.');
    const nonce=createHash('sha256').update(job.id).digest('base64url').slice(0,24);
    const message=await discord.call('/channels/'+channel.id+'/messages',{method:'POST',
      body:JSON.stringify({content:content.slice(0,1950),allowed_mentions:{parse:[]},nonce,enforce_nonce:true})});
    await db.query("UPDATE pc_core_jobs SET status='delivered',delivery_id=$1,lease=NULL,lease_until=0,last_error=NULL WHERE id=$2 AND lease=$3",
      [String(message?.id||''),job.id,token]);
  }catch(error:any){
    const attempts=Number(job.attempts||0)+1;
    const blocked=error instanceof DiscordFailure&&(error.code===50007||error.status===403||error.status===404);
    const terminal=blocked||attempts>=7;
    const nextDue=now+Math.max(error instanceof DiscordFailure?error.retryMs||0:0,Math.min(3600000,5000*2**Math.min(attempts,9)));
    await db.query('UPDATE pc_core_jobs SET status=$1,attempts=$2,due_ms=$3,lease=NULL,lease_until=0,last_error=$4 WHERE id=$5 AND lease=$6',
      [terminal?'undeliverable':'pending',attempts,nextDue,blocked?'Recipient does not accept DMs.':'Scheduled delivery temporarily failed.',job.id,token]);
  }
  return true;
}
