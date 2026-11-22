import {createHash,randomUUID} from 'node:crypto';
import type {Query,Store} from './db.ts';
import type {Scene} from './npc-voice.ts';
import {controls,noMentions,order} from './npc-turns.ts';

type PanelRecord={scene_id:string;message_id?:string;embed:string;revision:number;delivered_revision:number;lease?:string;channel_id:string;state:string};
const fallback=(s:Scene)=>({
  title:s.title+' · Round '+s.round,
  description:'An active NPC roleplay scene. The first writer establishes the situation.',
  color:0xc76639,
  fields:[{name:'Turn order',value:order(s)},{name:'On your turn',value:'Post as your approved character and use /finish-turn when ready. A reminder arrives after 30 minutes if your turn remains open.'}]
});
export async function createScenePanel(q:Query,s:Scene,embed:any){
  await q('INSERT INTO pc_rp_panels(scene_id,embed,retry_at) VALUES($1,$2,0) ON CONFLICT(scene_id) DO NOTHING',[s.id,JSON.stringify(embed)]);
}
export async function touchScenePanel(q:Query,s:Scene){
  await q('INSERT INTO pc_rp_panels(scene_id,embed,retry_at) VALUES($1,$2,0) ON CONFLICT(scene_id) DO UPDATE SET revision=pc_rp_panels.revision+1,retry_at=0',
    [s.id,JSON.stringify(fallback(s))]);
}
export function scenePanel(s:Scene,embed:any) {
  const fields=(Array.isArray(embed.fields)?embed.fields:[]).filter((f:any)=>f.name!=='Turn order');
  return {embeds:[{...embed,title:s.title+' · Round '+s.round,
    fields:[{name:'Turn order',value:order(s)},...fields]}],components:controls(s),allowed_mentions:noMentions};
}
export async function deliverScenePanel(db:Store,send:(channel:string,payload:any,messageId?:string)=>Promise<any>,now=Date.now()){
  const lease=randomUUID();
  const job:PanelRecord|undefined=await db.transaction(async q=>{
    const [row]=await q('SELECT p.*,s.channel_id,s.state FROM pc_rp_panels p JOIN pc_rp_scenes s ON p.scene_id=s.scene_id WHERE p.revision>p.delivered_revision AND p.retry_at<=$1 AND p.lease_until<=$1 ORDER BY p.retry_at,p.scene_id LIMIT 1'+(db.dialect==='postgres'?' FOR UPDATE OF p SKIP LOCKED':''),[now]);
    if(!row)return undefined;
    await q('UPDATE pc_rp_panels SET lease=$1,lease_until=$2 WHERE scene_id=$3',[lease,now+30000,row.scene_id]);
    return row;
  });
  if(!job)return false;
  const scene:Scene=JSON.parse(job.state);
  const payload:any=scenePanel(scene,JSON.parse(job.embed));
  if(!job.message_id){
    payload.nonce=createHash('sha256').update('panel:'+job.scene_id).digest('base64url').slice(0,24);
    payload.enforce_nonce=true;
  }
  try{
    const result=await send(job.channel_id,payload,job.message_id||undefined);
    const messageId=String(result?.id||job.message_id||'');
    if(!/^\d{17,20}$/.test(messageId))throw new Error('Discord did not return a scene panel message ID.');
    await db.transaction(async q=>{
      const [current]=await q('SELECT revision FROM pc_rp_panels WHERE scene_id=$1 AND lease=$2'+(db.dialect==='postgres'?' FOR UPDATE':''),[job.scene_id,lease]);
      if(!current)return;
      await q('UPDATE pc_rp_panels SET message_id=$1,delivered_revision=$2,lease=NULL,lease_until=0,retry_at=$3 WHERE scene_id=$4 AND lease=$5',
        [messageId,Number(job.revision),Number(current.revision)>Number(job.revision)?0:Date.now(),job.scene_id,lease]);
    });
  }catch(e:any){
    await db.query('UPDATE pc_rp_panels SET retry_at=$1,lease=NULL,lease_until=0,message_id=CASE WHEN $2=1 THEN NULL ELSE message_id END WHERE scene_id=$3 AND lease=$4',
      [Date.now()+Math.max(15000,Number(e?.retryMs)||0),e?.status===404?1:0,job.scene_id,lease]);
  }
  return true;
}
