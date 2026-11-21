import { randomUUID } from 'node:crypto';
import type { Query, Store } from './db.ts';
import type { Config } from './discord.ts';
import type { RoleplayScope } from './scope.ts';
import { actorFor, readSettings } from './domain.ts';
import { formStats, isAzurik, loadNpc, npcChoices } from './npc-catalog.ts';
import { aiOptions, openingLine, type Scene } from './npc-voice.ts';

export const npcCommands=()=>[
  {type:1,name:'roleplay-start',description:'Start a scene with an approved server NPC in this RP channel or forum post.',options:[
    {type:3,name:'npc',description:'Choose an approved NPC',required:true,autocomplete:true},
    {type:3,name:'scene',description:'Choose the kind of encounter',choices:[{name:'Audience',value:'audience'},{name:'Training spar',value:'spar'}]},
    {type:3,name:'opening',description:'Optional setting or premise for the scene',max_length:500},
    ...(aiOptions()?[{type:3,name:'dialogue',description:'Choose how the NPC responds',choices:[{name:'Guided dialogue',value:'guided'},{name:'AI dialogue · sends scene text to OpenAI',value:'ai'}]}]:[])]},
  {type:1,name:'roleplay-status',description:'Show this scene’s turn order, NPC form and controls.'},
  {type:1,name:'roleplay-cancel',description:'End this scene as its initiator or a Discord administrator.'}
];
const none={parse:[]};
function reply(content:string,privateReply=true,extra:any={}) {
  return {type:4,data:{content,allowed_mentions:none,...(privateReply?{flags:64}:{}),...extra}};
}
function controls(s:Scene,round=s.round) {
  return [{type:1,components:[['join','Join scene',3],['write','Write turn',1],['finish','Finish turn',1],['pass','Pass turn',2],['order','Turn order',2]].map(([action,label,style])=>({type:2,style,label,custom_id:['npc',s.id,round,action].join(':')}))}];
}
export const displayPL=(pl:unknown)=>/^\d+$/.test(String(pl))?BigInt(String(pl)).toLocaleString('en-US'):'unrecorded';
function order(s:Scene){
  return s.cast.map((p,i)=>(i+1)+'. <@'+p.id+'>'+(i===s.turn?' ← **up now**':i<s.turn?' ✓':'')).join('\n')+'\n'+(s.cast.length+1)+'. '+s.title+(s.turn>=s.cast.length?' ← **responding**':'');
}
const suffix=(db:Store)=>db.dialect==='postgres'?' FOR UPDATE':'';
export async function lockedScene(q:Query,db:Store,channel:string){
  const [row]=await q('SELECT * FROM pc_rp_scenes WHERE channel_id=$1'+suffix(db),[channel]);
  return row;
}
function signedAdmin(body:any,config:Config) {
  const bits=String(body.member?.permissions||'0');
  return body.member?.user?.id===config.owner || (/^\d+$/.test(bits)&&(BigInt(bits)&8n)!==0n);
}
const select=(body:any,name:string)=>body.data.options?.find((o:any)=>o.name===name)?.value;
function sceneOptions(s:Scene,sheet:any,config:Config) {
  const embed:any={title:s.title,description:openingLine(isAzurik(s.npc,sheet),s.mode,s.title),color:0xc76639,
    fields:[{name:'Turn order',value:order(s)},{name:'Your turn',value:'Post in character and click Finish turn, or use Write turn. Other writers can join before the NPC responds.'}]};
  if(s.opening)embed.fields.push({name:'Scene premise',value:s.opening});
  if(s.ai)embed.fields.push({name:'AI dialogue',value:'Joining sends your scene contributions and recent turns to OpenAI for an NPC reply.'});
  if(sheet.portrait)embed.thumbnail={url:new URL(sheet.portrait,config.dashboard).href};
  return {embeds:[embed],components:controls(s)};
}
function append(s:Scene,id:string,text:string,source:string,name:string){
  if(s.posts.some(p=>p.source===source))return 'duplicate';
  const chars=s.posts.filter(p=>p.writer===id).reduce((n,p)=>n+p.text.length,0);
  if(chars+text.length>10000 || s.posts.filter(p=>p.writer===id).length>=12)return 'full';
  s.posts.push({writer:id,text,source,name:name.slice(0,80)});
  return 'added';
}

export async function captureTurn(db:Store,channel:string,writer:string,source:string,
  resolve: (q:Query)=>Promise<{name:string;text:string}>) {
  if(!(await db.query('SELECT 1 FROM pc_rp_scenes WHERE channel_id=$1',[channel])).length)return;
  return db.transaction(async q=>{
    const row=await lockedScene(q,db,channel);
    if(!row || row.ready_at>0)return;
    const s:Scene=JSON.parse(row.state);
    if(s.cast[s.turn]?.id!==writer)return;
    const part=await resolve(q);
    if(!part.text.trim()||/^\s*(?:\/\/|\(\()/.test(part.text))return;
    const result=append(s,writer,part.text.trim(),source,part.name);
    if(result==='added')await q('UPDATE pc_rp_scenes SET state=$1 WHERE channel_id=$2',[JSON.stringify(s),channel]);
    return result;
  });
}

export async function sceneInteraction(db:Store,config:Config,body:any,scope?:RoleplayScope) {
  const act=body.data?.name||'', custom=String(body.data?.custom_id||'');
  const actor=body.member?.user?.id,channel=String(body.channel_id||''),roles=body.member?.roles||[];
  if(body.guild_id!==config.guild || !actor || !/^\d{17,20}$/.test(channel))return body.type===4?{type:8,data:{choices:[]}}:reply('Open this in Convergence.');
  const settings=(await readSettings(db)).value;
  const player=actorFor(actor,roles,config.owner,settings);
  if(body.type===4)return {type:8,data:{choices:act==='roleplay-start'&&(player.isPlayer||player.isOwner)?await npcChoices(db.query,String(select(body,'npc')||'')):[]}};
  if(act==='roleplay-start'){
    if(!player.isPlayer&&!player.isOwner)return reply('A current player role is required to start a scene.');
    if(!scope?.interactionEligible(settings,body))return reply('Choose a configured RP text channel or forum post. The owner can check the RP scope and gateway in Bot settings.');
  }
  const component=/^npc:([a-f0-9-]{36}):(\d+):(join|order|finish|write|submit|pass)$/.exec(custom);
  if(custom && !component)return reply('That scene control has expired.');
  return db.transaction(async q=>{
    // Reserving the Discord interaction serializes duplicate deliveries even on different workers.
    if(body.id){
      const inserted=await q('INSERT INTO pc_rp_receipts(id,created_ms,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[body.id,Date.now(),'']);
      if(!inserted.length){const [old]=await q('SELECT result FROM pc_rp_receipts WHERE id=$1',[body.id]);return JSON.parse(old.result);}
    }
    const process=async()=>{
      const row=await lockedScene(q,db,channel);
      if(act==='roleplay-start'){
        if(row)return reply('There is already a scene here. Use /roleplay-status to join or see the turn order.');
        let id=String(select(body,'npc')||'');
        if(!/^[\da-f-]{36}$/i.test(id)){
          const matches=(await npcChoices(q,id)).filter(c=>c.name.toLowerCase()===id.toLowerCase());
          if(matches.length!==1)return reply('Choose an NPC from the suggested names.');
          id=matches[0].value;
        }
        const sheet=await loadNpc(q,id);
        if(!sheet)return reply('That NPC is no longer in the approved catalog.');
        const ai=select(body,'dialogue')==='ai';
        if(ai&&!aiOptions())return reply('AI dialogue is currently unavailable. Choose guided dialogue.');
        const s:Scene={id:randomUUID(),channel,host:actor,npc:id,title:sheet.name,mode:select(body,'scene')==='spar'?'spar':'audience',ai,
          cast:[{id:actor,name:body.member.nick||body.member.user.global_name||body.member.user.username||'Writer'}],round:1,turn:0,form:'',opening:String(select(body,'opening')||'').slice(0,500),posts:[],past:[]};
        const saved=await q('INSERT INTO pc_rp_scenes(channel_id,scene_id,state) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING scene_id',[channel,s.id,JSON.stringify(s)]);
        return saved.length?reply('Round 1 · '+(s.mode==='spar'?'Training spar':'Audience'),false,sceneOptions(s,sheet,config)):reply('Another writer just started a scene here. Use /roleplay-status.');
      }
      if(!row)return reply('There is no active NPC scene here. Use /roleplay-start.');
      const s:Scene=JSON.parse(row.state),action=component?.[3];
      if(component && s.id!==component[1])return reply('This control belongs to an earlier scene. Use /roleplay-status.');
      const privateState=async()=>{
        const sheet=await loadNpc(q,s.npc);
        const stats=sheet?formStats(sheet,s.form):null;
        return reply('**'+s.title+' · Round '+s.round+'**\n'+order(s)+'\n'+(stats?(stats.form?.name||'Base')+' · PL '+displayPL(stats.pl):'NPC sheet unavailable')+(row.delivery_note?'\n'+row.delivery_note:'')+(s.ai?'\nAI dialogue shares participating writers’ scene text with OpenAI.':''),true,{components:controls(s)});
      };
      if(act==='roleplay-status'||action==='order')return privateState();
      if(act==='roleplay-cancel'){
        if(actor!==s.host&&!signedAdmin(body,config))return reply('Only the writer who started this scene or a Discord administrator can cancel it.');
        await q('DELETE FROM pc_rp_scenes WHERE scene_id=$1',[s.id]);
        return reply('The scene with '+s.title+' has ended.',false);
      }
      if(!action)return reply('Unknown roleplay control.');
      if(!scope?.interactionEligible(settings,body))return reply('This location is outside current RP coverage. The initiator or an administrator can still cancel the scene.');
      if(!player.isPlayer&&!player.isOwner&&!(action==='pass'&&signedAdmin(body,config)))return reply('A current player role is required.');
      if(action==='join'){
        if(s.cast.some(p=>p.id===actor))return privateState();
        if(row.ready_at>0)return reply('The NPC is finishing this round. Join when the next round opens.');
        if(s.cast.length>=12)return reply('This scene already has twelve writers.');
        s.cast.push({id:actor,name:body.member.nick||body.member.user.global_name||body.member.user.username||'Writer'});
        await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
        return reply('Joined round '+s.round+'.\n'+order(s),false,{components:controls(s)});
      }
      if(row.ready_at>0)return reply(s.title+' is responding. '+(row.delivery_note||'The next round will open after the reply.'));
      if(Number(component?.[2])!==s.round)return privateState();
      if(actor!==s.cast[s.turn]?.id && !(action==='pass'&&(signedAdmin(body,config)||actor===s.host)))return reply('It is <@'+s.cast[s.turn]?.id+'>’s turn. Use Join scene to enter the order.');
      if(action==='write' && body.type===3)return {type:9,data:{custom_id:['npc',s.id,s.round,'submit'].join(':'),title:'Write your roleplay turn',components:[{type:1,components:[{type:4,custom_id:'post',style:2,label:'In-character action or dialogue',required:true,max_length:4000}]}]}};
      if(action==='submit' && body.type===5){
        const text=String(body.data.components?.flatMap((r:any)=>r.components||[]).find((p:any)=>p.custom_id==='post')?.value||'').trim().slice(0,4000);
        if(!text)return reply('Write an action or dialogue before submitting.');
        if(append(s,actor,text,body.id,s.cast[s.turn].name)==='full')return reply('This turn already has 10,000 characters or 12 posts. Use Finish turn.');
      }else if(action!=='finish'&&action!=='pass')return reply('Open the current scene controls again.');
      if(action==='finish'&&!s.posts.some(p=>p.writer===actor))return reply('Post in character first, or use Write turn to enter it here.',true,{components:controls(s)});
      const writer=s.cast[s.turn];
      if(action==='pass')s.posts=s.posts.filter(p=>p.writer!==writer.id);
      s.turn++;
      const done=s.turn===s.cast.length;
      await q('UPDATE pc_rp_scenes SET state=$1,ready_at=$2 WHERE scene_id=$3',[JSON.stringify(s),done?Date.now():0,s.id]);
      const submitted=action==='submit'?s.posts.at(-1)?.text:'';
      const extra:any={components:controls(s,done?s.round+1:s.round)};
      if(submitted)extra.embeds=[{author:{name:writer.name.slice(0,80)},description:submitted.slice(0,4000)}];
      return reply((action==='pass'?'Passed <@'+writer.id+'>’s turn.':'<@'+writer.id+'> finished their turn.')+'\n'+(done?s.title+' is responding.':order(s)),false,extra);
    };
    const result=await process();
    if(body.id)await q('UPDATE pc_rp_receipts SET result=$1 WHERE id=$2',[JSON.stringify(result),body.id]);
    return result;
  });
}
