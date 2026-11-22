export type NpcProvider='openai'|'gemini';
export type NpcAiConfig={provider:NpcProvider;model:string;key:string;cap:number};
const modelName=(s:string)=>/^[\w.-]{2,96}$/.test(s)?s:'';
export function aiOptions(env=process.env):NpcAiConfig|null{
  const cap=Number(env.PHOENIX_NPC_AI_DAILY_REPLIES);
  if(!Number.isInteger(cap)||cap<1||cap>10000)return null;
  const name=String(env.PHOENIX_NPC_AI_PROVIDER||'').toLowerCase();
  const provider:NpcProvider=name==='openai'||name==='gemini'?name:env.PHOENIX_NPC_OPENAI_KEY?'openai':'gemini';
  const key=provider==='openai'?env.PHOENIX_NPC_OPENAI_KEY:env.PHOENIX_NPC_GEMINI_KEY;
  if(!key?.trim()||(name&&name!=='gemini'&&name!=='openai'))return null;
  const requested=provider==='openai'
    ?env.PHOENIX_NPC_OPENAI_MODEL||env.PHOENIX_NPC_AI_MODEL||'gpt-4.1-mini'
    :env.PHOENIX_NPC_GEMINI_MODEL||env.PHOENIX_NPC_AI_MODEL||'gemini-2.5-flash';
  const model=modelName(requested);
  return model?{provider,key,model,cap}:null;
}
export async function npcCompletion(config:NpcAiConfig,instructions:string,input:unknown,maxWords:number,fetcher=fetch):Promise<string|null>{
  const limit=Math.max(300,Math.min(1400,Math.ceil(maxWords*5)));
  let response:Response;
  if(config.provider==='openai'){
    response=await fetcher('https://api.openai.com/v1/responses',{
      method:'POST',signal:AbortSignal.timeout(23000),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
      body:JSON.stringify({model:config.model,store:false,instructions,
        max_output_tokens:limit,input:JSON.stringify(input)})});
  }else{
    response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(config.model)+':generateContent',{
      method:'POST',signal:AbortSignal.timeout(23000),headers:{'x-goog-api-key':config.key,'Content-Type':'application/json'},
      body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},
        contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],
        generationConfig:{maxOutputTokens:limit,temperature:0.95}})});
  }
  if(!response.ok)return null;
  const data:any=await response.json();
  if(config.provider==='openai'){
    if(data.status!=='completed')return null;
    return data.output?.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[])
      .filter((p:any)=>p.type==='output_text').map((p:any)=>p.text).join('\n')?.trim()||null;
  }
  const candidate=data.candidates?.[0];
  if(!candidate||candidate.finishReason!=='STOP')return null;
  return candidate.content?.parts?.filter((p:any)=>typeof p.text==='string'&&!p.thought).map((p:any)=>p.text).join('\n').trim()||null;
}
