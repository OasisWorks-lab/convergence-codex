import type {Store,Query} from './db.ts';
import {aiCandidates,npcCompletionResult,type NpcAiConfig,type AiAttempt} from './npc-ai.ts';

const keyOf=(config:NpcAiConfig)=>config.provider+':'+config.model;
const dayOf=(when:number)=>new Date(when).toISOString().slice(0,10);
const nextDay=(when:number)=>Date.parse(dayOf(when)+'T00:00:00Z')+86400000;
export type ProviderStatus={provider:string;model:string;dailyUsed:number;dailyLimit:number;minuteUsed:number;minuteLimit:number;retryAt:number;lastStatus:string};
export async function reserveProvider(db:Store,config:NpcAiConfig,now=Date.now()):Promise<boolean>{
  const key=keyOf(config),day=dayOf(now),minute=Math.floor(now/60000);
  return db.transaction(async q=>{
    await q("INSERT INTO pc_npc_ai_providers(provider_key,day,minute_bucket) VALUES($1,$2,$3) ON CONFLICT(provider_key) DO NOTHING",[key,day,minute]);
    const [row]=await q("SELECT day,day_used,minute_bucket,minute_used,blocked_until FROM pc_npc_ai_providers WHERE provider_key=$1"+(db.dialect==='postgres'?' FOR UPDATE':''),[key]);
    const dayUsed=row.day===day?Number(row.day_used):0;
    const minuteUsed=Number(row.minute_bucket)===minute?Number(row.minute_used):0;
    if(Number(row.blocked_until)>now||dayUsed>=Number(config.daily)||minuteUsed>=Number(config.rpm))return false;
    await q('UPDATE pc_npc_ai_providers SET day=$1,day_used=$2,minute_bucket=$3,minute_used=$4,last_status=$5,last_checked_ms=$6 WHERE provider_key=$7',
      [day,dayUsed+1,minute,minuteUsed+1,'attempted',now,key]);
    return true;
  });
}
export async function providerOutcome(db:Store,config:NpcAiConfig,result:AiAttempt,now=Date.now()):Promise<void>{
  let until=0;
  if(result.status==='quota')until=result.daily?nextDay(now):now+Math.min(86400000,result.retryMs||90000);
  if(result.status==='invalid')until=now+86400000;
  if(result.status==='unavailable')until=now+Math.min(300000,result.retryMs||45000);
  await db.query('UPDATE pc_npc_ai_providers SET blocked_until=$1,last_status=$2,last_checked_ms=$3 WHERE provider_key=$4',
    [until,result.status,now,keyOf(config)]);
}
export async function freeProviderStatus(db:Store,env=process.env,now=Date.now()):Promise<ProviderStatus[]>{
  const configs=aiCandidates(env),day=dayOf(now),minute=Math.floor(now/60000);
  const rows=await db.query('SELECT provider_key,day,day_used,minute_bucket,minute_used,blocked_until,last_status FROM pc_npc_ai_providers');
  return configs.map(config=>{
    const row=rows.find(r=>r.provider_key===keyOf(config));
    return {provider:config.provider,model:config.model,dailyUsed:row?.day===day?Number(row.day_used):0,
      dailyLimit:config.daily||0,minuteUsed:Number(row?.minute_bucket)===minute?Number(row.minute_used):0,
      minuteLimit:config.rpm||0,retryAt:Math.max(0,Number(row?.blocked_until)||0),lastStatus:String(row?.last_status||'not used')};
  });
}
export async function routeNpcReply(db:Store,instructions:string,input:unknown,targetWords:number,
  accept:(text:string)=>boolean=()=>true,fetcher=fetch,env=process.env,now=Date.now()):Promise<{text:string;provider:string;model:string}|null>{
  const candidates=aiCandidates(env);
  for(const candidate of candidates){
    if(!await reserveProvider(db,candidate,now))continue;
    const result=await npcCompletionResult(candidate,instructions,input,targetWords,fetcher);
    await providerOutcome(db,candidate,result,now);
    if(result.status==='ok'&&result.text&&accept(result.text))
      return {text:result.text,provider:candidate.provider,model:candidate.model};
    if(result.status==='blocked')return null;
  }
  return null;
}
