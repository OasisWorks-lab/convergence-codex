import {createHash} from 'node:crypto';
import {discordId,requireThat,textValue,type Actor} from './domain.ts';
import {DiscordFailure,type Discord} from './discord.ts';
import {retryDelay,writableType} from './forum-threads.ts';
import type {Store} from './db.ts';

export async function nicknameJob(db:Store,discord:Discord,now=Date.now()){
  const [job]=await db.query("UPDATE pc_bot_profile SET retry_at=$1 WHERE slot=1 AND status<>'Applied' AND retry_at<=$2 RETURNING nick",[now+60000,now]);
  if(!job)return;
  try{
    await discord.call('/guilds/'+discord.settings.guild+'/members/@me',{method:'PATCH',body:JSON.stringify({nick:job.nick||null})});
    await db.query("UPDATE pc_bot_profile SET status='Applied' WHERE nick=$1 AND slot=1",[job.nick]);
  }catch(e){
    await db.query('UPDATE pc_bot_profile SET status=$1,retry_at=$2 WHERE nick=$3 AND slot=1',[e instanceof DiscordFailure?'Waiting for Discord ('+e.status+')':'Waiting for Discord',now+Math.max(60000,retryDelay(2,e)),job.nick]);
  }
}
export async function announcement(db:Store,discord:Discord,actor:Actor,input:any){
  requireThat(actor.isOwner,403,'Only the configured owner can post announcements.');
  requireThat(['welcome','guidelines'].includes(input?.kind)&&['save','publish'].includes(input.action),400,'Choose a welcome or guidelines embed.');
  const kind=input.kind,draft={channel:textValue(input.channel,20,'Channel ID'),title:textValue(input.title,256,'Embed title',true),body:textValue(input.body,4096,'Embed message',true),color:textValue(input.color,7,'Embed color'),image:textValue(input.image||'',2048,'Embed image')};
  requireThat(!draft.channel||discordId.test(draft.channel),400,'Enter a Discord channel ID.');
  requireThat(/^#[a-f0-9]{6}$/i.test(draft.color),400,'Choose a six-digit color.');
  if(draft.image){let url;try{url=new URL(draft.image);}catch{}requireThat(url?.protocol==='https:'&&!url.username&&!url.password,400,'Choose an HTTPS image address.');}
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',['phoenixcore-embed:'+kind]);
    const [old]=await q('SELECT * FROM pc_announcements WHERE kind=$1',[kind]);
    requireThat(input.revision===Number(old?.revision||0),409,'This embed changed. Reload its latest draft.');
    let channel=old?.channel_id??null,message=old?.message_id??null;
    if(input.action==='publish'){
      requireThat(discordId.test(draft.channel),400,'Choose a destination channel to publish.');
      const target=await discord.guildChannel(draft.channel);
      requireThat(writableType(target.type)&&!target.thread_metadata?.locked,400,'Choose a writable text channel or thread.');
      const embed={title:draft.title,description:draft.body,color:parseInt(draft.color.slice(1),16),...(draft.image?{image:{url:draft.image}}:{})};
      const body={embeds:[embed],allowed_mentions:{parse:[]}};
      if(message&&channel===target.id){
        try{await discord.call('/channels/'+channel+'/messages/'+message,{method:'PATCH',body:JSON.stringify(body)});}
        catch(error){if(!(error instanceof DiscordFailure&&error.status===404))throw error;message=null;}
      }else message=null;
      if(!message){
        const nonce=createHash('sha256').update(kind+':'+target.id+':'+input.revision).digest('hex').slice(0,24);
        const sent=await discord.call('/channels/'+target.id+'/messages',{method:'POST',body:JSON.stringify({...body,nonce,enforce_nonce:true})});
        requireThat(discordId.test(sent.id),502,'Discord did not confirm the embed.');message=sent.id;
      }
      channel=target.id;
    }
    await q('INSERT INTO pc_announcements VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind) DO UPDATE SET revision=excluded.revision,draft=excluded.draft,channel_id=excluded.channel_id,message_id=excluded.message_id',[kind,input.revision+1,JSON.stringify(draft),channel,message]);
    return {ok:true};
  });
}
