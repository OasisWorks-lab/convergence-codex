import type {Query,Store} from './db.ts';
import type {Scene} from './npc-voice.ts';

export type Encounter={characterId:string;occurredAt:number;round:number;spoken:string;npcReplied:string};
export async function writeEncounters(q:Query,s:Scene,npcReply:string,now=Date.now()){
  if(s.memory!=='story')return;
  const participants=new Set(s.posts.map(post=>post.characterId).filter((id):id is string=>!!id));
  for(const id of participants){
    const own=s.posts.filter(p=>p.characterId===id).map(p=>p.text).join('\n').slice(0,1700);
    if(!own.trim())continue;
    await q('INSERT INTO pc_npc_encounters(id,npc_id,character_id,scene_id,round,occurred_ms,player_text,npc_reply) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',
      [s.id+':'+s.round+':'+id,s.npc,id,s.id,s.round,now,own,npcReply.slice(0,1800)]);
  }
}
export async function remembered(db:Store,npcId:string,characterIds:string[],limit=6):Promise<Record<string,Encounter[]>>{
  const unique=[...new Set(characterIds)].filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,12),out:Record<string,Encounter[]>={};
  for(const id of unique){
    const first=await db.query('SELECT id,character_id,round,occurred_ms,player_text,npc_reply FROM pc_npc_encounters WHERE npc_id=$1 AND character_id=$2 ORDER BY occurred_ms ASC,id ASC LIMIT 1',[npcId,id]);
    const recent=await db.query('SELECT id,character_id,round,occurred_ms,player_text,npc_reply FROM pc_npc_encounters WHERE npc_id=$1 AND character_id=$2 ORDER BY occurred_ms DESC,id DESC LIMIT $3',[npcId,id,Math.max(1,Math.min(limit,12))-1||1]);
    const rows=[...new Map([...first,...recent.reverse()].map(row=>[row.id,row])).values()].sort((a,b)=>Number(a.occurred_ms)-Number(b.occurred_ms));
    out[id]=rows.map(r=>({characterId:r.character_id,round:Number(r.round),occurredAt:Number(r.occurred_ms),spoken:r.player_text,npcReplied:r.npc_reply}));
  }
  return out;
}
export async function clearPair(q:Query,npcId:string,characterId:string){
  const removed=await q('DELETE FROM pc_npc_encounters WHERE npc_id=$1 AND character_id=$2 RETURNING id',[npcId,characterId]);
  return removed.length;
}
export async function clearScene(q:Query,sceneId:string){
  const removed=await q('DELETE FROM pc_npc_encounters WHERE scene_id=$1 RETURNING id',[sceneId]);
  return removed.length;
}
