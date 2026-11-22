import { createHash,randomUUID } from 'node:crypto';
import type { Store } from './db.ts';
import type { Discord } from './discord.ts';
import { loadNpc } from './npc-catalog.ts';
import {displayPL} from './npc-scenes.ts';
import {lockedScene,includeWaiting,setClock} from './npc-turns.ts';
import {touchScenePanel} from './npc-panel.ts';
import { narrate, type Scene,type Speech } from './npc-voice.ts';
import {writeEncounters} from './npc-memory.ts';

export async function sendNpcPost(discord:Discord,s:Scene,move:Speech,retry:boolean,eligible?:(channel:any)=>Promise<boolean>) {
  const tag='Scene '+s.id.slice(0,8)+' · Round '+s.round;
  const channel=await discord.guildChannel(s.channel);
  if(eligible && !await eligible(channel))throw Object.assign(new Error('Outside RP scope'),{status:409});
  const thread=[10,11,12].includes(channel.type), parent=thread?channel.parent_id:channel.id;
  const api='/channels/'+parent+'/webhooks';
  let hook:any;
  try{
    const hooks=await discord.call(api);
    hook=hooks.find((h:any)=>(h.user?.id===discord.settings.clientId||h.application_id===discord.settings.clientId)&&h.name==='PhoenixCore RP'&&h.token);
    if(!hook)hook=await discord.call(api,{method:'POST',body:JSON.stringify({name:'PhoenixCore RP'})});
  }catch(e:any){if(![403,404].includes(e.status))throw e;}
  if(retry){
    const recent=await discord.call('/channels/'+s.channel+'/messages?limit=100');
    const found=recent.find((m:any)=>(m.author?.id===discord.settings.clientId||(hook&&m.webhook_id===hook.id))&&m.embeds?.some((b:any)=>b.footer?.text===tag));
    if(found)return String(found.id);
  }
  const portrait=move.portrait?new URL(move.portrait,discord.settings.dashboard).href:undefined;
  const artwork=move.artwork?new URL(move.artwork,discord.settings.dashboard).href:undefined;
  // Discord accepts 2,000 characters of ordinary message text. Keep longer narration in the same post.
  const text=move.text;
  let cut=text.length;
  if(cut>2000){
    const split=text.slice(0,2000).search(/\s+\S*$/);
    cut=split>=Math.max(1000,text.length-4096)?split:2000;
  }
  const rest=text.slice(cut).trimStart();
  const embed={author:{name:move.name,...(portrait?{icon_url:portrait}:{})},color:0xc76639,
    ...(rest?{description:rest}:{}),fields:[{name:'Power Level',value:displayPL(move.pl),inline:true}],
    footer:{text:tag},...(artwork?{image:{url:artwork}}:{})};
  const payload={content:text.slice(0,cut).trimEnd(),embeds:[embed],allowed_mentions:{parse:[]}};
  if(hook?.token){
    try{
      const posted=await discord.call('/webhooks/'+hook.id+'/'+encodeURIComponent(hook.token)+'?wait=true'+(thread?'&thread_id='+s.channel:''),{method:'POST',body:JSON.stringify({...payload,username:move.name.slice(0,80),avatar_url:portrait})});return String(posted.id);
    }catch(e:any){if(![400,401,403,404].includes(e.status))throw e;}
  }
  const nonce=createHash('sha256').update(s.id+':'+s.round).digest('base64url').slice(0,24);
  const posted=await discord.call('/channels/'+s.channel+'/messages',{method:'POST',body:JSON.stringify({...payload,nonce,enforce_nonce:true})});
  return String(posted.id);
}

export async function deliverScene(db:Store,send:(s:Scene,move:Speech,retry:boolean)=>Promise<string>,voice=narrate) {
  const lease=randomUUID(),now=Date.now();
  const row=await db.transaction(async q=>{
    const [job]=await q('SELECT * FROM pc_rp_scenes WHERE ready_at>0 AND ready_at<=$1 AND lease_until<=$1 ORDER BY ready_at LIMIT 1'+(db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!job)return;
    await q('UPDATE pc_rp_scenes SET lease_token=$1,lease_until=$2 WHERE scene_id=$3',[lease,now+90000,job.scene_id]);
    return job;
  });
  if(!row)return false;
  const s:Scene=JSON.parse(row.state);
  try{
    const sheet=await loadNpc(db.query,s.npc);
    let move:Speech;
    if(row.speech)move=JSON.parse(row.speech);
    else if(sheet)move=await voice(db,s,sheet);
    else move={name:s.title,text:'This NPC is no longer available in the catalog. This scene has ended.',form:'',portrait:'',pl:null,source:'Guided'};
    const owned=await db.query('UPDATE pc_rp_scenes SET speech=$1,lease_until=$2 WHERE scene_id=$3 AND lease_token=$4 RETURNING scene_id',[JSON.stringify(move),Date.now()+45000,s.id,lease]);
    if(!owned.length)return true;
    const postId=await send(s,move,Number(row.attempts)>0||!!row.speech);
    await db.transaction(async q=>{
      const live=await lockedScene(q,db,s.channel);
      if(live?.lease_token!==lease)return;
      await q('INSERT INTO pc_npc_posts(post_id,channel_id,character_id,form_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[postId,s.channel,s.npc,move.form]);
      if(!sheet){await q('DELETE FROM pc_rp_scenes WHERE scene_id=$1',[s.id]);return;}
      const liveScene:Scene=JSON.parse(live.state);
      s.waiting=liveScene.waiting;
      const speakers=new Map<string,string>();
      for(const part of s.posts)speakers.set(part.name,(speakers.get(part.name)||'')+'\n'+part.text);
      await writeEncounters(q,s,move.text);
      s.past.push({posts:[...speakers].map(([name,text])=>({name,text:text.trim().slice(-1200)})),reply:move.text});
      s.past=s.past.slice(-4);s.posts=[];s.turn=0;s.round++;s.form=move.form;s.title=sheet.name;
      includeWaiting(s);await setClock(q,s,Date.now());
      await touchScenePanel(q,s);
      await q('UPDATE pc_rp_scenes SET state=$1,ready_at=0,lease_token=NULL,lease_until=0,speech=NULL,attempts=0,delivery_note=NULL WHERE scene_id=$2',[JSON.stringify(s),s.id]);
    });
  }catch(e:any){
    const attempts=Number(row.attempts)+1;
    const delay=Math.max(Number(e?.retryMs)||0,Math.min(120000,3000*2**Math.min(6,attempts-1)));
    const note=e?.status===409?'This location is outside current RP coverage.':e?.status===403?'Check PhoenixCore’s channel, thread, embed and history permissions.':'Discord delivery will retry.';
    await db.query('UPDATE pc_rp_scenes SET ready_at=$1,lease_until=0,lease_token=NULL,attempts=$2,delivery_note=$3 WHERE scene_id=$4 AND lease_token=$5',[Date.now()+delay,attempts,note,s.id,lease]);
    console.warn('NPC reply queued for retry ('+(e?.status||'service unavailable')+').');
  }
  return true;
}
