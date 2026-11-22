import {createHash,randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import {DiscordFailure,type Discord} from './discord.ts';

export async function deliverCommunityNotice(db:Store,discord:Pick<Discord,'call'>,now=Date.now()){
  const token=randomUUID();
  const job=await db.transaction(async q=>{
    const [row]=await q("SELECT * FROM pc_community_notifications WHERE status='pending' AND not_before<=$1 AND lease_until<=$1 ORDER BY not_before,id LIMIT 1"+(db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!row)return null;
    await q('UPDATE pc_community_notifications SET lease=$1,lease_until=$2 WHERE id=$3',[token,now+45000,row.id]);
    return row;
  });
  if(!job)return false;
  try{
    const payload=JSON.parse(job.payload);
    const dm=await discord.call('/users/@me/channels',{method:'POST',body:JSON.stringify({recipient_id:job.user_id})});
    const content='**Convergence suggestion update**\n**'+String(payload.title).slice(0,120)+'**\nStatus: **'+String(payload.status).slice(0,40)+'**'+
      (payload.response?'\nStaff response: '+String(payload.response).slice(0,950):'')+
      '\nThis update was sent by PhoenixCore. If you cannot receive DMs, check the current status with /suggest view.';
    const nonce=createHash('sha256').update(job.id).digest('base64url').slice(0,24);
    const sent=await discord.call('/channels/'+dm.id+'/messages',{method:'POST',body:JSON.stringify({content:content.slice(0,1900),allowed_mentions:{parse:[]},nonce,enforce_nonce:true})});
    await db.query("UPDATE pc_community_notifications SET status='delivered',lease=NULL,lease_until=0,message_id=$1,last_error=NULL WHERE id=$2 AND lease=$3",
      [String(sent.id||''),job.id,token]);
  }catch(error:any){
    const attempts=Number(job.attempts||0)+1;
    const cannotDm=error instanceof DiscordFailure&&(error.status===403||error.code===50007||error.status===404);
    const status=cannotDm?'undeliverable':attempts>=8?'failed':'pending';
    const wait=error instanceof DiscordFailure&&error.retryMs?error.retryMs:Math.min(3600000,10000*2**Math.min(8,attempts));
    await db.query('UPDATE pc_community_notifications SET status=$1,not_before=$2,attempts=$3,lease=NULL,lease_until=0,last_error=$4 WHERE id=$5 AND lease=$6',
      [status,now+wait,attempts,cannotDm?'Member does not accept bot DMs.':'Discord delivery will retry.',job.id,token]);
  }
  return true;
}
