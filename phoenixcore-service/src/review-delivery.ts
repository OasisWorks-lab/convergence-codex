import {randomUUID} from 'node:crypto';
import {visibleRequest,readSettings,isDesign,discordId,type Settings} from './domain.ts';
import type {Store,Row} from './db.ts';
import {DiscordFailure,reviewMessage,type Discord} from './discord.ts';
import {forumThread,playerThread,forumType,writableType,retryDelay} from './forum-threads.ts';

type Request=ReturnType<typeof visibleRequest>;
const waiting=(status:string)=>status==='pending'||status==='awaiting_judge'||status==='owner_review'||status==='needs_details';

async function sendCard(db:Store,discord:Discord,r:Request,settings:Settings,existing:Row,now:number) {
  const body=reviewMessage(r,discord.settings,settings);
  const {nonce,enforce_nonce,...message}=body;
  if(existing.message_id){
    try{
      const channel=await discord.guildChannel(existing.channel_id);
      if(channel.thread_metadata?.locked)throw Error('The review thread is locked.');
      if(channel.thread_metadata?.archived)await discord.call('/channels/'+channel.id,{method:'PATCH',body:JSON.stringify({archived:false})});
      await discord.call('/channels/'+channel.id+'/messages/'+existing.message_id,{method:'PATCH',body:JSON.stringify(message)});
      return;
    }catch(error){
      if(!(error instanceof DiscordFailure && error.status===404))throw error;
      if(!waiting(r.status))return;
    }
  }
  let channelId:string, messageId:string;
  const [native]=await db.query('SELECT channel_id FROM pc_native WHERE id=$1',[r.id]);
  if(native){
    const channel=await discord.guildChannel(native.channel_id);
    if(channel.thread_metadata?.archived)await discord.call('/channels/'+channel.id,{method:'PATCH',body:JSON.stringify({archived:false})});
    channelId=channel.id;messageId=(await discord.call('/channels/'+channelId+'/messages',{method:'POST',body:JSON.stringify(body)})).id;
  }else if(r.kind==='create'||isDesign(r.kind)){
    const channel=await discord.guildChannel(r.kind==='create'?settings.characterChannel:settings.designChannel);
    if(forumType(channel.type)){
      const thread=await forumThread(db,discord,channel.id,'request:'+r.id,async()=>({
        name:body.embeds[0].title.slice(0,100),message,tags:[r.kind==='create'?'new character':r.kind,'submission','pending']
      }),now,channel);
      // The forum starter's message ID is its thread ID, even after crash recovery.
      channelId=thread.id;
      messageId=thread.id;
      if(!thread.created){
        const saved=await discord.guildChannel(channelId);
        if(saved.thread_metadata?.archived)await discord.call('/channels/'+channelId,{method:'PATCH',body:JSON.stringify({archived:false})});
        await discord.call('/channels/'+channelId+'/messages/'+messageId,{method:'PATCH',body:JSON.stringify(message)});
      }
    }else{
      if(!writableType(channel.type)||channel.thread_metadata?.locked)throw Error('Choose a writable submissions channel.');
      channelId=channel.id;
      messageId=(await discord.call('/channels/'+channelId+'/messages',{method:'POST',body:JSON.stringify(body)})).id;
    }
  }else{
    channelId=await playerThread(db,discord,settings.updatesForum,r.ownerId,now);
    messageId=(await discord.call('/channels/'+channelId+'/messages',{method:'POST',body:JSON.stringify(body)})).id;
  }
  if(!discordId.test(messageId))throw Error('Discord did not confirm the review message.');
  await db.query('UPDATE pc_review_posts SET channel_id=$1,message_id=$2 WHERE request_id=$3 AND lease_token=$4',[channelId,messageId,r.id,existing.lease_token]);
}

export async function deliverNext(db:Store,discord:Discord,now=Date.now()){
  const token=randomUUID();
  const [post]=await db.query(`UPDATE pc_review_posts SET lease_token=$1,lease_until=$2 WHERE request_id=(
    SELECT p.request_id FROM pc_review_posts p JOIN pc_requests r ON p.request_id=r.id
    WHERE r.notified=0 AND r.notify_after<=$3 AND p.lease_until<=$3 AND (r.status<>'archived' OR p.message_id IS NOT NULL)
    ORDER BY CASE WHEN r.status IN ('pending','awaiting_judge') THEN 0 ELSE 1 END,r.created_ms,r.id LIMIT 1)
    AND lease_until<=$3 RETURNING *`,[token,now+300000,now]);
  if(!post)return false;
  try{
    const [row]=await db.query('UPDATE pc_requests SET attempts=attempts+1 WHERE id=$1 AND notified=0 RETURNING *',[post.request_id]);
    if(!row)return true;
    try{
      const {value}=await readSettings(db);
      await sendCard(db,discord,visibleRequest(row),value,post,now);
      await db.query('UPDATE pc_requests SET notified=1,last_notify_error=NULL WHERE id=$1 AND status=$2 AND attempts=$3',[row.id,row.status,row.attempts]);
    }catch(error){
      const wait=retryDelay(Number(row.attempts),error);
      const reason=error instanceof DiscordFailure?error.message:error instanceof Error&&['The review thread is locked.','Review destination is outside Convergence.','OC updates require a forum channel.','Choose a writable submissions channel.'].includes(error.message)?error.message:'Discord delivery unavailable';
      await db.query('UPDATE pc_requests SET notify_after=$1,last_notify_error=$2 WHERE id=$3 AND status=$4 AND attempts=$5',[now+wait,reason,row.id,row.status,row.attempts]);
    }
  }finally{
    await db.query('UPDATE pc_review_posts SET lease_token=NULL,lease_until=0 WHERE request_id=$1 AND lease_token=$2',[post.request_id,token]);
  }
  return true;
}

export async function deliverOwnerDenial(db:Store,discord:Discord,now=Date.now()){
  const [claim]=await db.query("UPDATE pc_denials SET retry_at=$1,attempts=attempts+1 WHERE request_id=(SELECT d.request_id FROM pc_denials d JOIN pc_requests r ON r.id=d.request_id WHERE d.dm_message IS NULL AND d.retry_at<=$2 AND r.status='owner_review' ORDER BY r.created_ms LIMIT 1) AND dm_message IS NULL AND retry_at<=$2 RETURNING *",[now+120000,now]);
  if(!claim)return false;
  try{
    const [row]=await db.query("SELECT * FROM pc_requests WHERE id=$1 AND status='owner_review'",[claim.request_id]);
    if(!row)return true;
    const channel=await discord.call('/users/@me/channels',{method:'POST',body:JSON.stringify({recipient_id:discord.settings.owner})});
    const settings=await readSettings(db),body=reviewMessage(visibleRequest(row),discord.settings,settings.value,true,'<@'+claim.helper+'>'+(claim.note?' · '+claim.note:''),claim.decision_key);
    const sent=await discord.call('/channels/'+channel.id+'/messages',{method:'POST',body:JSON.stringify(body)});
    if(!discordId.test(sent.id))throw Error('Discord did not confirm the denial DM.');
    await db.query('UPDATE pc_denials SET dm_channel=$1,dm_message=$2 WHERE request_id=$3 AND attempts=$4 AND decision_key=$5',[channel.id,sent.id,claim.request_id,claim.attempts,claim.decision_key]);
  }catch(e){
    await db.query('UPDATE pc_denials SET retry_at=$1 WHERE request_id=$2 AND attempts=$3 AND decision_key=$4',[now+retryDelay(Number(claim.attempts),e),claim.request_id,claim.attempts,claim.decision_key]);
  }
  return true;
}
