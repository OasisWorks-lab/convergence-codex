export type NpcProvider='openai'|'gemini'|'groq'|'openrouter';
export type NpcAiConfig={provider:NpcProvider;model:string;key:string;cap:number;daily?:number;rpm?:number};
export type AiAttempt={status:'ok'|'quota'|'unavailable'|'invalid'|'blocked';text?:string;retryMs?:number;daily?:boolean};
const modelName=(name:string)=>/^[a-zA-Z0-9_./:-]{2,120}$/.test(name)?name:'';
const positive=(value:string|undefined,defaultValue:number,max=10000)=>{
  const result=value===undefined?defaultValue:Number(value);
  return Number.isInteger(result)&&result>0&&result<=max?result:0;
};
function preferred(env:NodeJS.ProcessEnv):NpcProvider|null {
  const explicit=String(env.PHOENIX_NPC_AI_PROVIDER||'').toLowerCase();
  if(explicit)return ['openai','gemini','groq','openrouter'].includes(explicit)?explicit as NpcProvider:null;
  if(env.PHOENIX_NPC_OPENAI_KEY)return 'openai';
  if(env.PHOENIX_NPC_GEMINI_KEY)return 'gemini';
  if(env.PHOENIX_NPC_GROQ_KEY)return 'groq';
  if(env.PHOENIX_NPC_OPENROUTER_KEY)return 'openrouter';
  return null;
}
function configured(env:NodeJS.ProcessEnv,provider:NpcProvider,cap:number,lite=false):NpcAiConfig|null {
  const keys:Record<NpcProvider,string|undefined>={
    openai:env.PHOENIX_NPC_OPENAI_KEY,
    gemini:env.PHOENIX_NPC_GEMINI_KEY,
    groq:env.PHOENIX_NPC_GROQ_KEY,
    openrouter:env.PHOENIX_NPC_OPENROUTER_KEY
  };
  const key=keys[provider]?.trim();
  if(!key)return null;
  const models:Record<NpcProvider,string>={
    openai:env.PHOENIX_NPC_OPENAI_MODEL||env.PHOENIX_NPC_AI_MODEL||'gpt-4.1-mini',
    gemini:lite?env.PHOENIX_NPC_GEMINI_LITE_MODEL||'gemini-2.5-flash-lite':
      env.PHOENIX_NPC_GEMINI_MODEL||env.PHOENIX_NPC_AI_MODEL||'gemini-2.5-flash',
    groq:env.PHOENIX_NPC_GROQ_MODEL||'openai/gpt-oss-120b',
    openrouter:env.PHOENIX_NPC_OPENROUTER_MODEL||'openrouter/free'
  };
  const model=modelName(models[provider]);
  if(!model)return null;
  if(provider==='openrouter'&&model!=='openrouter/free'&&!model.endsWith(':free'))return null;
  const dayKey=lite?'PHOENIX_NPC_GEMINI_LITE_DAILY_REPLIES':{
    openai:'PHOENIX_NPC_OPENAI_DAILY_REPLIES',
    gemini:'PHOENIX_NPC_GEMINI_DAILY_REPLIES',
    groq:'PHOENIX_NPC_GROQ_DAILY_REPLIES',
    openrouter:'PHOENIX_NPC_OPENROUTER_DAILY_REPLIES'
  }[provider];
  const rpmKey=lite?'PHOENIX_NPC_GEMINI_LITE_RPM':{
    openai:'PHOENIX_NPC_OPENAI_RPM',
    gemini:'PHOENIX_NPC_GEMINI_RPM',
    groq:'PHOENIX_NPC_GROQ_RPM',
    openrouter:'PHOENIX_NPC_OPENROUTER_RPM'
  }[provider];
  const dailyDefault:Record<NpcProvider,number>={openai:cap,gemini:20,groq:200,openrouter:40};
  const rpmDefault:Record<NpcProvider,number>={openai:5,gemini:3,groq:8,openrouter:8};
  const daily=positive(env[dayKey],lite?50:dailyDefault[provider]);
  const rpm=positive(env[rpmKey],lite?3:rpmDefault[provider],60);
  return daily&&rpm?{provider,key,model,cap,daily,rpm}:null;
}
export function aiOptions(env:NodeJS.ProcessEnv=process.env):NpcAiConfig|null {
  const cap=positive(env.PHOENIX_NPC_AI_DAILY_REPLIES,0);
  const provider=preferred(env);
  return cap&&provider?configured(env,provider,cap):null;
}
export function aiCandidates(env:NodeJS.ProcessEnv=process.env):NpcAiConfig[] {
  const head=aiOptions(env);
  if(!head)return [];
  const configs=[head];
  const requested=env.PHOENIX_NPC_AI_FREE_FALLBACKS===undefined?
    ['gemini-lite','groq','openrouter']:
    env.PHOENIX_NPC_AI_FREE_FALLBACKS.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  for(const id of requested){
    let config:NpcAiConfig|null=null;
    if(id==='gemini-lite'&&head.provider==='gemini')config=configured(env,'gemini',head.cap,true);
    if(id==='groq')config=configured(env,'groq',head.cap);
    if(id==='openrouter')config=configured(env,'openrouter',head.cap);
    // OpenAI is never part of automatic free-provider failover.
    if(config&&!configs.some(x=>x.provider===config!.provider&&x.model===config!.model))configs.push(config);
  }
  return configs.slice(0,4);
}
const delayFrom=(response:Response,defaultMs=120000)=>{
  const header=response.headers.get('retry-after');
  if(header){
    const numeric=Number(header);
    const value=Number.isFinite(numeric)?numeric*1000:Date.parse(header)-Date.now();
    if(Number.isFinite(value)&&value>=0)return Math.max(1500,Math.min(86400000,value));
  }
  return defaultMs;
};
export async function npcCompletionResult(config:NpcAiConfig,instructions:string,input:unknown,maxWords:number,fetcher=fetch):Promise<AiAttempt>{
  const limit=Math.max(280,Math.min(2400,Math.ceil(maxWords*4.4)));
  let response:Response;
  try{
    if(config.provider==='openai'){
      response=await fetcher('https://api.openai.com/v1/responses',{
        method:'POST',signal:AbortSignal.timeout(11500),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
        body:JSON.stringify({model:config.model,store:false,instructions,max_output_tokens:limit,input:JSON.stringify(input)})});
    }else if(config.provider==='gemini'){
      response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(config.model)+':generateContent',{
        method:'POST',signal:AbortSignal.timeout(11500),headers:{'x-goog-api-key':config.key,'Content-Type':'application/json'},
        body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],
          generationConfig:{maxOutputTokens:limit,temperature:0.9,...(config.model.startsWith('gemini-2.5-')?{thinkingConfig:{thinkingBudget:0}}:{})}})});
    }else{
      if(config.provider==='openrouter'&&config.model!=='openrouter/free'&&!config.model.endsWith(':free'))return {status:'invalid'};
      response=await fetcher(config.provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',signal:AbortSignal.timeout(11500),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
        body:JSON.stringify({model:config.model,messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(input)}],
          max_tokens:limit,temperature:0.85,stream:false,...(config.provider==='groq'&&config.model.startsWith('openai/gpt-oss-')?{reasoning_effort:'low',include_reasoning:false}:{})})});
    }
  }catch{return {status:'unavailable',retryMs:45000};}
  if(!response.ok){
    if(response.status===429){
      let daily=false;
      try{const body=(await response.text()).slice(0,3500);daily=/per.day|requests.per.day|daily|RPD|GenerateRequestsPerDay|free_tier_requests|quota exceeded.*day/i.test(body);}catch{}
      return {status:'quota',retryMs:daily?86400000:delayFrom(response,90000),daily};
    }
    if(response.status===401||response.status===402||response.status===403)return {status:'invalid',retryMs:86400000};
    if(response.status>=500||response.status===408)return {status:'unavailable',retryMs:delayFrom(response,45000)};
    if(response.status===400||response.status===404)return {status:'invalid',retryMs:86400000};
    return {status:'blocked',retryMs:600000};
  }
  let data:any;
  try{data=await response.json();}catch{return {status:'unavailable',retryMs:45000};}
  if(config.provider==='openai'){
    if(data.status!=='completed')return {status:'unavailable',retryMs:60000};
    const text=data.output?.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[])
      .filter((p:any)=>p.type==='output_text').map((p:any)=>p.text).join('\n')?.trim();
    return typeof text==='string'&&text?{status:'ok',text}:{status:'blocked',retryMs:120000};
  }
  if(config.provider==='gemini'){
    const candidate=data.candidates?.[0];
    if(!candidate||candidate.finishReason!=='STOP')return {status:'blocked',retryMs:120000};
    const text=candidate.content?.parts?.filter((p:any)=>typeof p.text==='string'&&!p.thought).map((p:any)=>p.text).join('\n').trim();
    return typeof text==='string'&&text?{status:'ok',text}:{status:'blocked',retryMs:120000};
  }
  const message=data.choices?.[0]?.message;
  const text=typeof message?.content==='string'?message.content.trim():'';
  if(data.choices?.[0]?.finish_reason==='content_filter')return {status:'blocked',retryMs:120000};
  return text?{status:'ok',text}:{status:'unavailable',retryMs:45000};
}
export async function npcCompletion(config:NpcAiConfig,instructions:string,input:unknown,maxWords:number,fetcher=fetch):Promise<string|null>{
  const result=await npcCompletionResult(config,instructions,input,maxWords,fetcher);
  return result.status==='ok'?result.text||null:null;
}
