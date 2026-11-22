import {createHash,randomUUID} from 'node:crypto';
import type {Query,Store} from './db.ts';
import type {Scene} from './npc-voice.ts';

export const turnWindow=2*60*60*1000;
export const reminderDelay=30*60*1000;
export const noMentions={parse:[]};
export const currentSlot=(s:Scene)=>s.cast[s.turn];
export const currentWriter=(s:Scene)=>currentSlot(s)?.id;
export const slotHasPost=(s:Scene,slot=currentSlot(s))=>!!slot&&s.posts.some(p=>p.writer===slot.id&&(!slot.characterId||p.characterId===slot.characterId));
export const turnKey=(s:Scene)=>[s.round,s.turn,s.paused?'paused':currentSlot(s)?.characterId||currentWriter(s)||'npc'].join(':');

export function order(s:Scene){
  const list=s.cast.map((p,i)=>(i+1)+'. <@'+p.id+'>'+(p.characterId?' · '+p.name:'')+(s.paused?'':i===s.turn?' ← **up now**':i<s.turn?' ✓':''));
  list.push((list.length+1)+'. '+s.title+(!s.paused&&s.turn>=s.cast.length?' ← **responding**':''));
  if(s.waiting?.length)list.push('Joining next round: '+s.waiting.map(p=>'<@'+p.id+'>'+(p.characterId?' · '+p.name:'')).join(', '));
  return list.join('\n');
}
export function controls(s:Scene) {
  const buttons=s.paused?[['join','Join scene',3],['resume','Resume scene',1],['order','Turn order',2]]:[['join','Join scene',3],['pass','Pass turn',2],['order','Turn order',2]];
  return [{type:1,components:buttons.map(([action,label,style])=>({type:2,style,label,custom_id:['npc',s.id,s.round,action,...(action==='pass'?[s.turn]:[])].join(':')}))}];
}
export async function lockedScene(q:Query,db:Store,channel:string){
  const [row]=await q('SELECT * FROM pc_rp_scenes WHERE channel_id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[channel]);
  return row;
}
export async function setClock(q:Query,s:Scene,now:number){
  s.startedAt=now;
  await q('DELETE FROM pc_rp_clocks WHERE scene_id=$1',[s.id]);
  if(!s.paused&&currentWriter(s)){
    if(!slotHasPost(s))await q('INSERT INTO pc_rp_clocks(scene_id,due_at) VALUES($1,$2)',[s.id,now+turnWindow]);
    await queueTurnReminder(q,s,now);
  }
}
export async function queueNotice(q:Query,s:Scene,lead:string,options:Record<string,unknown>={}){
  const writer=s.paused?undefined:currentWriter(s);
  const content=lead+(writer?'\n<@'+writer+'>, it’s your turn.':'');
  const payload={content,allowed_mentions:writer?{parse:[],users:[writer]}:noMentions,components:controls(s),...options};
  await q('INSERT INTO pc_rp_notices(id,scene_id,turn_key,payload,retry_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),s.id,turnKey(s),JSON.stringify(payload),Date.now()]);
}
export async function queueTurnReminder(q:Query,s:Scene,now:number){
  const writer=currentWriter(s);
  if(!writer||s.paused)return;
  const key=turnKey(s),id='reminder:'+s.id+':'+key;
  const payload={content:'<@'+writer+'>, your character’s turn has been open for 30 minutes. When you finish posting, use /finish-turn. You may also use Pass turn.',allowed_mentions:{parse:[],users:[writer]}};
  await q('INSERT INTO pc_rp_notices(id,scene_id,turn_key,payload,retry_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
    [id,s.id,key,JSON.stringify(payload),now+reminderDelay]);
}
export function includeWaiting(s:Scene) {
  s.cast.push(...(s.waiting||[]));s.waiting=[];
}
export async function nextTurn(q:Query,s:Scene,now:number,lead:string){
  s.turn++;
  const done=s.turn===s.cast.length;
  if(done&&!s.posts.length){
    includeWaiting(s);s.round++;s.turn=0;s.paused=true;
    lead+='\nEveryone passed this round. The scene is paused. Choose Resume scene when you are ready.';
  }
  await setClock(q,s,now);
  await q('UPDATE pc_rp_scenes SET state=$1,ready_at=$2 WHERE scene_id=$3',[JSON.stringify(s),done&&!s.paused?now:0,s.id]);
  const {touchScenePanel}=await import('./npc-panel.ts');
  await touchScenePanel(q,s);
}
export async function resumeTurn(q:Query,s:Scene,writer:string,now:number,characterId?:string){
  const index=s.cast.findIndex(p=>p.id===writer&&(!characterId||p.characterId===characterId));
  if(index<0||!s.paused)return false;
  s.cast=[...s.cast.slice(index),...s.cast.slice(0,index)];s.turn=0;s.paused=false;
  await setClock(q,s,now);
  await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
  const {touchScenePanel}=await import('./npc-panel.ts');
  await touchScenePanel(q,s);
  return true;
}
export async function restoreTurnClocks(db:Store,now=Date.now()){
  const rows=await db.query('SELECT channel_id FROM pc_rp_scenes WHERE ready_at=0');
  for(const old of rows)await db.transaction(async q=>{
    const row=await lockedScene(q,db,old.channel_id);
    if(!row||Number(row.ready_at))return;
    const s:Scene=JSON.parse(row.state);
    if(s.startedAt!==undefined)return;
    await setClock(q,s,now);
    await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
  });
}
export async function expireTurn(db:Store,now=Date.now()){
  const [due]=await db.query('SELECT s.channel_id,c.scene_id FROM pc_rp_clocks c JOIN pc_rp_scenes s ON c.scene_id=s.scene_id WHERE c.due_at<=$1 ORDER BY c.due_at LIMIT 1',[now]);
  if(!due)return false;
  return db.transaction(async q=>{
    const row=await lockedScene(q,db,due.channel_id);
    if(!row||row.scene_id!==due.scene_id)return false;
    const [timer]=await q('SELECT due_at FROM pc_rp_clocks WHERE scene_id=$1',[row.scene_id]);
    if(!timer||Number(timer.due_at)>now)return false;
    const s:Scene=JSON.parse(row.state),writer=currentWriter(s);
    if(!writer||s.paused||slotHasPost(s)){await q('DELETE FROM pc_rp_clocks WHERE scene_id=$1',[s.id]);return true;}
    await nextTurn(q,s,now,'<@'+writer+'> was skipped after two hours without an in-character post.');
    return true;
  });
}
export async function deliverTurnNotice(db:Store,send:(channel:string,payload:any)=>Promise<unknown>,now=Date.now()){
  const lease=randomUUID();
  const job=await db.transaction(async q=>{
    const [n]=await q('SELECT n.*,s.channel_id,s.state FROM pc_rp_notices n JOIN pc_rp_scenes s ON n.scene_id=s.scene_id WHERE n.retry_at<=$1 ORDER BY n.retry_at,n.id LIMIT 1'+(db.dialect==='postgres'?' FOR UPDATE OF n SKIP LOCKED':''),[now]);
    if(!n)return;
    const s:Scene=JSON.parse(n.state);
    if(n.turn_key!==turnKey(s)){await q('DELETE FROM pc_rp_notices WHERE id=$1',[n.id]);return {stale:true};}
    await q('UPDATE pc_rp_notices SET retry_at=$1,lease=$2 WHERE id=$3',[now+30000,lease,n.id]);
    return n;
  });
  if(!job)return false;
  if(job.stale)return true;
  const nonce=createHash('sha256').update(job.id).digest('base64url').slice(0,24);
  try{
    await send(job.channel_id,{...JSON.parse(job.payload),nonce,enforce_nonce:true});
    await db.query('DELETE FROM pc_rp_notices WHERE id=$1 AND lease=$2',[job.id,lease]);
  }catch(e:any){
    await db.query('UPDATE pc_rp_notices SET retry_at=$1,lease=NULL WHERE id=$2 AND lease=$3',[Date.now()+Math.max(e?.retryMs||0,15000),job.id,lease]);
  }
  return true;
}
