import {createHash,randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import {getSuggestion,suggestionDisplay} from './community.ts';
import {DiscordFailure,type Discord} from './discord.ts';

export async function deliverSuggestionPost(db:Store,discord:Pick<Discord,'call'>,now=Date.now()):Promise<boolean>{
  const token=randomUUID();
  const job=await db.transaction(async q=>{
    const [row]=await q('SELECT p.* FROM pc_suggestion_posts p WHERE p.revision>p.delivered_revision AND p.retry_at<=$1 AND p.lease_until<=$1 ORDER BY p.retry_at,p.suggestion_id LIMIT 1'+(db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!row)return null;
    await q('UPDATE pc_suggestion_posts SET lease=$1,lease_until=$2 WHERE suggestion_id=$3',[token,now+45000,row.suggestion_id]);
    return row;
  });
  if(!job)return false;
  try{
    const [removed]=await db.query('SELECT suggestion_id FROM pc_suggestion_removals WHERE suggestion_id=$1',[job.suggestion_id]);
    let id=String(job.message_id||'');
    if(removed){
      if(id)try{
        await discord.call('/channels/'+job.channel_id+'/messages/'+id,{method:'DELETE'});
      }catch(e){
        if(!(e instanceof DiscordFailure&&e.status===404))throw e;
      }
      id='';
    }else{
      const publicMessage:any=suggestionDisplay(await getSuggestion(db,job.suggestion_id));
      if(!id){
        publicMessage.nonce=createHash('sha256').update('suggestion:'+job.suggestion_id).digest('base64url').slice(0,24);
        publicMessage.enforce_nonce=true;
      }
      const route='/channels/'+job.channel_id+'/messages'+(id?'/'+id:'');
      try{
        const sent=await discord.call(route,{method:id?'PATCH':'POST',body:JSON.stringify(publicMessage)});
        id=String(sent?.id||id);
      }catch(e){
        if(id&&e instanceof DiscordFailure&&e.status===404){
          await db.query('UPDATE pc_suggestion_posts SET message_id=NULL,delivered_revision=0,retry_at=0,lease=NULL,lease_until=0 WHERE suggestion_id=$1 AND lease=$2',[job.suggestion_id,token]);
          return true;
        }
        throw e;
      }
      if(!/^\d{17,20}$/.test(id))throw Error('Discord did not return a canonical suggestion message ID.');
    }
    await db.transaction(async q=>{
      const [current]=await q('SELECT revision FROM pc_suggestion_posts WHERE suggestion_id=$1 AND lease=$2'+(db.dialect==='postgres'?' FOR UPDATE':''),[job.suggestion_id,token]);
      if(!current)return;
      await q('UPDATE pc_suggestion_posts SET message_id=$1,delivered_revision=$2,retry_at=0,lease=NULL,lease_until=0,last_error=NULL WHERE suggestion_id=$3 AND lease=$4',
        [id||null,Number(job.revision),job.suggestion_id,token]);
    });
  }catch(error){
    const rate=error instanceof DiscordFailure&&error.retryMs?error.retryMs:0;
    const backoff=error instanceof DiscordFailure&&error.status===403?3600000:30000;
    await db.query('UPDATE pc_suggestion_posts SET retry_at=$1,lease=NULL,lease_until=0,last_error=$2 WHERE suggestion_id=$3 AND lease=$4',
      [Date.now()+Math.max(rate,backoff),error instanceof DiscordFailure?'Discord status '+error.status:'Post delivery temporarily failed',job.suggestion_id,token]);
  }
  return true;
}
