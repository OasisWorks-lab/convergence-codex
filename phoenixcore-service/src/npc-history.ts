import type { Store } from './db.ts';
import type { Discord } from './discord.ts';

export type Memory = {name:string; text:string};
export const defaultHistory=0, maxHistory=50;

export async function readSceneHistory(db:Store,discord:Discord,body:any,count:number,prefixes:string) {
  const history:Memory[]=[];
  if(count===0)return {history,note:'Fresh scene'};
  const flags=String(body.member?.permissions||'0');
  const canRead=/^\d+$/.test(flags) && (BigInt(flags)&(8n|65536n))!==0n;
  if(!canRead)return {history,note:'Started fresh because you lack Read Message History here.'};
  const channel=String(body.channel_id);
  const before=/^\d{17,20}$/.test(body.id)?'&before='+body.id:'';
  const messages=await discord.call('/channels/'+channel+'/messages?limit='+count+before);
  const recent=messages.filter((m:any)=>m.channel_id===channel && (!m.guild_id||m.guild_id===body.guild_id) && [0,19].includes(m.type??0)).slice(0,count);
  if(recent.length){
    const ids=recent.map((m:any)=>String(m.id));
    const params=ids.map((_:string,i:number)=>'$'+(i+2)).join(',');
    const [players,npcs]=await Promise.all([
      db.query('SELECT source_id,posted_id,character_name FROM pc_posts WHERE channel_id=$1 AND (source_id IN ('+params+') OR posted_id IN ('+params+'))',[channel,...ids]),
      db.query('SELECT post_id FROM pc_npc_posts WHERE channel_id=$1 AND post_id IN ('+params+')',[channel,...ids])
    ]);
    const npcIds=new Set(npcs.map(row=>row.post_id));
    const playerPosts=new Map(players.map(row=>[row.posted_id,row.character_name]));
    const replaced=new Set(players.filter(row=>ids.includes(row.posted_id)).map(row=>row.source_id));
    const commands=prefixes.split(/\s+/).filter(Boolean);
    for(const m of [...recent].reverse()){
      const npc=npcIds.has(m.id);
      if(replaced.has(m.id)||m.interaction_metadata||m.interaction)continue;
      if(m.author?.bot&&!npc&&!m.webhook_id)continue;
      const text=String(m.content||(npc?m.embeds?.[0]?.description:'')||'').trim();
      if(!text||/^(?:\/\/|\(\(|\/[\w-]+\b)/.test(text)||commands.some(p=>text.startsWith(p)))continue;
      const name=playerPosts.get(m.id)||(npc?m.embeds?.[0]?.author?.name:'')||m.member?.nick||m.author?.global_name||m.author?.username||'Writer';
      history.push({name:String(name).slice(0,80),text:text.slice(0,1400)});
    }
  }
  return {history,note:'Opening context from '+history.length+' in-character '+(history.length===1?'post':'posts')+' among the last '+count+' messages.'};
}
