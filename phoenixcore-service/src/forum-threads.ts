import {DiscordFailure, type Discord} from './discord.ts';
import {discordId} from './domain.ts';
import type {Store} from './db.ts';

type Starter={name:string;message:Record<string,any>;tags:string[]};
const lease=120000;
export const forumType=(type:number)=>type===15||type===16;
export const writableType=(type:number)=>[0,5,10,11,12].includes(type);
export function retryDelay(attempt:number,error:unknown){
  return Math.max(Math.min(3600000,5000*2**Math.min(attempt,10)),error instanceof DiscordFailure?error.retryMs:0);
}

function forumTag(forum:any,preferred:string[]){
  if(!(forum.flags & 16))return [];
  const tags=forum.available_tags||[], available=tags.filter((t:any)=>!t.moderated);
  const candidates=available.length?available:tags;
  const tag=preferred.map(name=>candidates.find((t:any)=>t.name.toLowerCase()===name)).find(Boolean)||candidates[0];
  if(!tag)throw Error('The review forum requires a tag but offers none.');
  return [tag.id];
}

// The forum creation API has no idempotency key. Reconcile an uncertain create using its bot-authored starter.
async function recoverThread(discord:Discord,forum:string,title:string,marker:string,attemptedAt:number,renew:()=>Promise<void>){
  async function find(threads:any[]){
    for(const t of threads){
      if(t.parent_id!==forum || t.owner_id!==discord.settings.clientId || !discordId.test(t.id))continue;
      const created=Number(BigInt(t.id)>>22n)+1420070400000;
      if(t.name!==title && Math.abs(created-attemptedAt)>120000)continue;
      await renew();
      try{
        const msg=await discord.call('/channels/'+t.id+'/messages/'+t.id);
        if(msg.author?.id===discord.settings.clientId && msg.embeds?.some((e:any)=>e.footer?.text===marker))return t.id as string;
      }catch(e){if(!(e instanceof DiscordFailure && e.status===404))throw e;}
    }
  }
  const active=await discord.call('/guilds/'+discord.settings.guild+'/threads/active');
  const found=await find(active.threads);if(found)return found;
  let before='';
  for(;;){
    await renew();
    const page=await discord.call('/channels/'+forum+'/threads/archived/public?limit=100'+(before?'&before='+encodeURIComponent(before):''));
    const found=await find(page.threads);if(found)return found;
    const last=page.threads.at(-1)?.thread_metadata?.archive_timestamp;
    if(!page.has_more || (last && Date.parse(last)<attemptedAt-120000))return;
    if(!last || last===before)throw Error('Could not finish checking archived review posts.');
    before=last;
  }
}

export async function forumThread(db:Store,discord:Discord,forumId:string,subject:string,makeStarter:()=>Promise<Starter>,now:number,knownForum?:any):Promise<{id:string;created:boolean}>{
  const key=[forumId,subject];
  await db.query('INSERT INTO pc_forum_threads(forum_id,subject) VALUES($1,$2) ON CONFLICT DO NOTHING',key);
  const [binding]=await db.query('SELECT thread_id FROM pc_forum_threads WHERE forum_id=$1 AND subject=$2',key);
  if(binding.thread_id){
    try{
      const thread=await discord.guildChannel(binding.thread_id);
      if(thread.type!==11 || thread.parent_id!==forumId)throw Error('Review thread is outside its forum.');
      if(thread.thread_metadata?.locked)throw Error('The review thread is locked.');
      return {id:thread.id,created:false};
    }catch(error){
      if(!(error instanceof DiscordFailure && error.status===404))throw error;
      await db.query('UPDATE pc_forum_threads SET thread_id=NULL,attempted_name=NULL,attempts=0,retry_at=0 WHERE forum_id=$1 AND subject=$2 AND thread_id=$3',[...key,binding.thread_id]);
    }
  }
  const [claim]=await db.query(`UPDATE pc_forum_threads SET retry_at=$3,attempts=attempts+1
    WHERE forum_id=$1 AND subject=$2 AND thread_id IS NULL AND retry_at<=$4 RETURNING *`,[...key,now+lease,now]);
  if(!claim){
    const [row]=await db.query('SELECT thread_id,retry_at FROM pc_forum_threads WHERE forum_id=$1 AND subject=$2',key);
    if(row.thread_id)return {id:row.thread_id,created:false};
    throw new DiscordFailure(429,Math.max(1000,Number(row.retry_at)-now));
  }
  const args=[...key,claim.attempts];
  const guard=' WHERE forum_id=$1 AND subject=$2 AND attempts=$3 AND thread_id IS NULL';
  async function renew(){
    const rows=await db.query('UPDATE pc_forum_threads SET retry_at=$4'+guard+' RETURNING subject',[...args,Math.max(now,Date.now())+lease]);
    if(!rows.length)throw Error('Review post creation is in progress.');
  }
  try{
    const forum=knownForum||await discord.guildChannel(forumId);
    if(!forumType(forum.type))throw Error('OC updates require a forum channel.');
    const starter=await makeStarter();
    let id=claim.attempted_name?await recoverThread(discord,forumId,claim.attempted_name,starter.message.embeds[0].footer.text,Number(claim.attempted_ms),renew):undefined;
    const created=!id;
    if(!id){
      const applied_tags=forumTag(forum,starter.tags);
      await renew();
      await db.query('UPDATE pc_forum_threads SET attempted_name=$4,attempted_ms=$5'+guard,[...args,starter.name,now]);
      try{
        const result=await discord.call('/channels/'+forumId+'/threads',{method:'POST',body:JSON.stringify({name:starter.name,message:starter.message,applied_tags})});
        if(!discordId.test(result.id) || result.parent_id!==forumId || (result.guild_id && result.guild_id!==discord.settings.guild))throw Error('Discord did not confirm the review post.');
        id=String(result.id);
      }catch(error){
        if(error instanceof DiscordFailure && error.status>=400 && error.status<500)await db.query('UPDATE pc_forum_threads SET attempted_name=NULL'+guard,args);
        throw error;
      }
    }
    const saved=await db.query('UPDATE pc_forum_threads SET thread_id=$4,attempted_name=NULL,attempts=0,retry_at=0'+guard+' RETURNING thread_id',[...args,id]);
    if(!saved.length)throw Error('Unable to confirm the saved review thread.');
    return {id,created};
  }catch(error){
    await db.query('UPDATE pc_forum_threads SET retry_at=$4'+guard,[...args,now+retryDelay(Number(claim.attempts),error)]);
    throw error;
  }
}

export function playerThread(db:Store,discord:Discord,forum:string,owner:string,now:number){
  return forumThread(db,discord,forum,'player:'+owner,async()=>{
    const member=await discord.member(owner);
    return {name:member.user.username+"'s OC Updates",tags:['oc updates','character updates','updates','training'],message:{
      allowed_mentions:{parse:[]},embeds:[{title:'Character updates and training',description:'Submissions for all characters belonging to <@'+owner+'> appear here for review.',footer:{text:'PhoenixCore player '+owner}}]}};
  },now).then(thread=>thread.id);
}

export async function provisionNext(db:Store,discord:Discord,forum:string,now=Date.now()){
  const [job]=await db.query("SELECT subject FROM pc_forum_threads WHERE forum_id=$1 AND subject LIKE 'player:%' AND thread_id IS NULL AND retry_at<=$2 ORDER BY retry_at,subject LIMIT 1",[forum,now]);
  if(!job)return false;
  try{await playerThread(db,discord,forum,job.subject.slice(7),now);}
  catch(error){console.warn('OC updates forum '+forum+' could not open a player post. '+(error instanceof DiscordFailure?error.message:'Delivery will retry.'));}
  return true;
}
