import {createHash,randomUUID} from 'node:crypto';
import {DiscordFailure,type Discord} from './discord.ts';
import type {Store} from './db.ts';
import {supportIdleMs} from './support.ts';

export async function closeInactiveSupport(db:Store,now=Date.now()):Promise<boolean>{
  return db.transaction(async q=>{
    const [timer]=await q('SELECT * FROM pc_support_idle WHERE due_ms<=$1 ORDER BY due_ms LIMIT 1'+(db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!timer)return false;
    const [record]=await q('SELECT * FROM pc_support_cases WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[timer.case_id]);
    if(!record||['Resolved','Closed'].includes(record.status)){
      await q('DELETE FROM pc_support_idle WHERE case_id=$1',[timer.case_id]);return true;
    }
    const actualDue=Number(record.activity_ms)+supportIdleMs;
    if(actualDue>now){
      await q('UPDATE pc_support_idle SET due_ms=$1 WHERE case_id=$2',[actualDue,timer.case_id]);return true;
    }
    const [unsent]=await q("SELECT COUNT(*) AS total FROM pc_support_outbox o JOIN pc_support_events e ON e.id=o.event_id WHERE e.case_id=$1 AND o.status='pending'",[record.id]);
    if(Number(unsent.total)>0){
      await q('UPDATE pc_support_idle SET due_ms=$1 WHERE case_id=$2',[now+5*60000,record.id]);
      return true;
    }
    await q("UPDATE pc_support_cases SET status='Closed',closed_ms=$1,close_reason='Closed after four hours without case conversation activity.',updated_ms=$1,revision=revision+1 WHERE id=$2",[now,record.id]);
    await q('INSERT INTO pc_support_events(id,receipt_id,case_id,actor_id,event_type,visibility,body,occurred_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(receipt_id) DO NOTHING',
      [randomUUID(),'idle:'+record.id+':'+record.activity_ms,record.id,'system','inactivity-closed','member','Closed after four hours of inactivity. Contact staff to reopen this case.',now]);
    await q('DELETE FROM pc_support_idle WHERE case_id=$1',[record.id]);
    return true;
  });
}
export async function deliverSupportOutbox(db:Store,discord:Pick<Discord,'call'>,now=Date.now()):Promise<boolean>{
  const lease=randomUUID();
  const job=await db.transaction(async q=>{
    const [row]=await q("SELECT o.*,e.event_type,e.body,e.actor_id,e.case_id,c.kind FROM pc_support_outbox o JOIN pc_support_events e ON o.event_id=e.id JOIN pc_support_cases c ON c.id=e.case_id WHERE o.status='pending' AND o.retry_ms<=$1 AND o.lease_until<=$1 ORDER BY o.retry_ms,e.occurred_ms LIMIT 1"+
      (db.dialect==='postgres'?' FOR UPDATE OF o SKIP LOCKED':''),[now]);
    if(!row)return null;
    await q('UPDATE pc_support_outbox SET lease=$1,lease_until=$2 WHERE event_id=$3',[lease,now+45000,row.event_id]);
    return row;
  });
  if(!job)return false;
  try{
    const signed=job.event_type==='staff-signed-reply';
    const header=signed?'**Convergence Staff · <@'+job.actor_id+'>**':'**Convergence Staff**';
    const content=header+'\nRegarding your '+job.kind+' case '+job.case_id+':\n'+String(job.body).slice(0,1900);
    const dm=await discord.call('/users/@me/channels',{method:'POST',body:JSON.stringify({recipient_id:job.recipient_id})});
    const nonce=createHash('sha256').update('support:'+job.event_id).digest('base64url').slice(0,24);
    const message=await discord.call('/channels/'+dm.id+'/messages',{method:'POST',
      body:JSON.stringify({content:content.slice(0,1990),nonce,enforce_nonce:true,allowed_mentions:{parse:[]}})});
    await db.query("UPDATE pc_support_outbox SET status='delivered',delivery_id=$1,lease=NULL,lease_until=0,last_error=NULL WHERE event_id=$2 AND lease=$3",
      [String(message?.id||''),job.event_id,lease]);
  }catch(error:any){
    const attempts=Number(job.attempts||0)+1;
    const blocked=error instanceof DiscordFailure&&(error.status===403||error.code===50007||error.status===404);
    const terminal=blocked||attempts>=9;
    const interval=error instanceof DiscordFailure&&error.retryMs?error.retryMs:Math.min(3600000,15000*2**Math.min(attempts,8));
    await db.query('UPDATE pc_support_outbox SET status=$1,retry_ms=$2,attempts=$3,lease=NULL,lease_until=0,last_error=$4 WHERE event_id=$5 AND lease=$6',
      [terminal?'undeliverable':'pending',now+interval,attempts,blocked?'Member has blocked DMs.':'Temporary Discord delivery issue.',job.event_id,lease]);
  }
  return true;
}
