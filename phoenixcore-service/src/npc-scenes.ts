import {randomUUID} from 'node:crypto';
import type {Query,Store} from './db.ts';
import type {Config,Discord} from './discord.ts';
import type {RoleplayScope} from './scope.ts';
import {actorFor,readSettings} from './domain.ts';
import {formStats,isAzurik,loadNpc,npcChoices} from './npc-catalog.ts';
import {aiOptions,openingLine,type Scene} from './npc-voice.ts';
import {defaultHistory,maxHistory,readSceneHistory,type Memory} from './npc-history.ts';
import {controls,currentSlot,currentWriter,slotHasPost,lockedScene,nextTurn,noMentions,order,resumeTurn,setClock,turnWindow} from './npc-turns.ts';
import {createScenePanel,touchScenePanel} from './npc-panel.ts';

export const sceneCommand=(name:string)=>['roleplay-start','roleplay-join','finish-turn','roleplay-status','roleplay-cancel'].includes(name);
export const npcCommands=()=>[
  {type:1,name:'roleplay-start',description:'Start a scene with an approved server NPC in this RP channel or forum post.',options:[
    {type:3,name:'npc',description:'Choose an approved NPC',required:true,autocomplete:true},
    {type:3,name:'character',description:'Your approved character (required if you have multiple)',autocomplete:true},
    {type:4,name:'context',description:'Recent messages to read in this channel or thread (default 5, fresh scene 0)',min_value:0,max_value:maxHistory},
    {type:3,name:'scene',description:'Choose a style (default Open roleplay)',choices:[{name:'Open roleplay',value:'open'},{name:'Audience',value:'audience'},{name:'Training spar',value:'spar'}]},
    {type:3,name:'opening',description:'Optional setting or premise for the scene',max_length:500},
    ...(aiOptions()?[{type:3,name:'dialogue',description:'How the NPC responds (AI shares selected history and turns with OpenAI)',choices:[{name:'Guided dialogue',value:'guided'},{name:'AI dialogue · sends scene text to OpenAI',value:'ai'}]}]:[])]},
  {type:1,name:'roleplay-join',description:'Join this NPC scene with an approved character.',options:[{type:3,name:'character',description:'Your approved character',required:true,autocomplete:true}]},
  {type:1,name:'finish-turn',description:'Finish your in-character posts and pass to the next writer in this scene.'},
  {type:1,name:'roleplay-status',description:'Show this scene’s turn order, NPC form and controls.'},
  {type:1,name:'roleplay-cancel',description:'End this scene as its initiator or a Discord administrator.'}
];
function reply(content:string,privateReply=true,extra:any={}) {
  return {type:4,data:{content,allowed_mentions:noMentions,...(privateReply?{flags:64}:{}),...extra}};
}
export const displayPL=(pl:unknown)=>/^\d+$/.test(String(pl))?BigInt(String(pl)).toLocaleString('en-US'):'unrecorded';
function signedAdmin(body:any,config:Config) {
  const bits=String(body.member?.permissions||'0');
  return body.member?.user?.id===config.owner || (/^\d+$/.test(bits)&&(BigInt(bits)&8n)!==0n);
}
const select=(body:any,name:string)=>body.data.options?.find((o:any)=>o.name===name)?.value;
function sceneOptions(s:Scene,sheet:any,config:Config,note:string) {
  const embed:any={title:s.title+' · Round 1',description:openingLine(isAzurik(s.npc,sheet),s.mode,s.title,!!s.history?.length||!!s.opening),color:0xc76639,
    fields:[{name:'Turn order',value:order(s)},{name:'On your turn',value:'Write using your character tag or channel default. You can send several posts. Type /finish-turn to pass. A reminder comes after 30 minutes if your turn remains open. An unanswered turn passes after two hours.'},{name:'Opening context',value:note}]};
  if(s.opening)embed.fields.push({name:'Scene premise',value:s.opening});
  if(s.ai)embed.fields.push({name:'AI dialogue',value:'Selected opening history and participating writers’ turns are shared with OpenAI.'});
  if(sheet.portrait)embed.thumbnail={url:new URL(sheet.portrait,config.dashboard).href};
  return {embeds:[embed],components:controls(s)};
}
async function playable(q:Query,writer:string){
  const rows=await q('SELECT c.id,c.sheet,t.tag FROM pc_characters c LEFT JOIN pc_post_tags t ON t.character_id=c.id WHERE c.owner_id=$1 ORDER BY c.id',[writer]);
  return rows.map(row=>({id:String(row.id),tag:String(row.tag||''),sheet:JSON.parse(row.sheet)})).filter(row=>row.sheet.characterType!=='NPC');
}
async function selectedCharacter(q:Query,actor:string,search:string){
  const all=await playable(q,actor),term=search.trim().toLowerCase();
  const matches=term?all.filter(row=>row.id.toLowerCase()===term||row.tag.toLowerCase()===term||String(row.sheet.name).toLowerCase()===term):all;
  if(matches.length===1)return {id:actor,name:String(matches[0].sheet.name).slice(0,80),characterId:matches[0].id};
  if(term||all.length>1)return null;
  return {id:actor,name:'',characterId:undefined};
}
function inCharacter(text:string){return !!text.trim()&&!/^\s*(?:\/\/|\(\(|\/[\w-]+\b)/.test(text);}
export async function captureTurn(db:Store,channel:string,writer:string,source:string,
  resolve:(q:Query)=>Promise<{name:string;text:string;characterId?:string}>,postedAt=Date.now()){
  if(!(await db.query('SELECT 1 FROM pc_rp_scenes WHERE channel_id=$1',[channel])).length)return;
  return db.transaction(async q=>{
    const row=await lockedScene(q,db,channel);
    if(!row||Number(row.ready_at))return;
    const s:Scene=JSON.parse(row.state);
    if(!s.cast.some(p=>p.id===writer)||(!s.paused&&currentWriter(s)!==writer))return;
    if(s.startedAt!==undefined&&postedAt<s.startedAt)return;
    const part=await resolve(q);
    if(!inCharacter(part.text))return;
    const slot=s.paused?s.cast.find(p=>p.id===writer&&(!p.characterId||p.characterId===part.characterId)):currentSlot(s);
    if(!slot||slot.id!==writer||(slot.characterId&&slot.characterId!==part.characterId))return;
    if(s.posts.some(p=>p.source===source))return 'duplicate';
    const previous=s.posts.filter(p=>p.writer===writer&&(!slot.characterId||p.characterId===slot.characterId));
    if(previous.length>=12||previous.reduce((total,p)=>total+p.text.length,0)+part.text.length>10000)return 'full';
    if(!s.paused&&!previous.length&&s.startedAt!==undefined&&postedAt>=s.startedAt+turnWindow){
      await nextTurn(q,s,Date.now(),'<@'+writer+'> was skipped after two hours without an in-character post.');return 'late';
    }
    if(s.paused)await resumeTurn(q,s,writer,Date.now(),slot.characterId);
    s.posts.push({writer,text:part.text.trim(),source,name:part.name.slice(0,80),characterId:part.characterId});
    await q('DELETE FROM pc_rp_clocks WHERE scene_id=$1',[s.id]);
    await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
    return 'added';
  });
}
export async function sceneInteraction(db:Store,config:Config,body:any,scope:RoleplayScope|undefined,discord:Discord) {
  const act=body.data?.name||'',custom=String(body.data?.custom_id||'');
  const actor=body.member?.user?.id,channel=String(body.channel_id||''),roles=body.member?.roles||[];
  if(body.guild_id!==config.guild||!actor||!/^\d{17,20}$/.test(channel))return body.type===4?{type:8,data:{choices:[]}}:reply('Open this in Convergence.');
  const settings=(await readSettings(db)).value,player=actorFor(actor,roles,config.owner,settings);
  if(body.type===4){
    if(!player.isPlayer&&!player.isOwner)return {type:8,data:{choices:[]}};
    const focus=body.data.options?.find((o:any)=>o.focused);
    if(focus?.name==='character'){
      const rows=await playable(db.query,actor);
      const term=String(focus.value||'').toLowerCase();
      return {type:8,data:{choices:rows.filter(row=>String(row.sheet.name).toLowerCase().includes(term)||row.tag.toLowerCase().includes(term)).slice(0,25).map(row=>({name:String(row.sheet.name).slice(0,100),value:row.id}))}};
    }
    return {type:8,data:{choices:act==='roleplay-start'?await npcChoices(db.query,String(select(body,'npc')||'')):[]}};
  }
  let opening:{history:Memory[];note:string}={history:[],note:'Fresh scene'};
  if(act==='roleplay-start'){
    if(!player.isPlayer&&!player.isOwner)return reply('A current player role is required to start a scene.');
    if(!scope?.interactionEligible(settings,body))return reply('Choose a configured RP text channel or forum post. The owner can check the RP scope and gateway in Bot settings.');
    const count=select(body,'context')??defaultHistory;
    if(!Number.isInteger(count)||count<0||count>maxHistory)return reply('Choose a context count between 0 and '+maxHistory+'.');
    const [receipt]=body.id?await db.query('SELECT result FROM pc_rp_receipts WHERE id=$1',[body.id]):[];
    if(receipt?.result)return JSON.parse(receipt.result);
    if((await db.query('SELECT 1 FROM pc_rp_scenes WHERE channel_id=$1',[channel])).length)return reply('There is already a scene here. Use /roleplay-status to join or see the turn order.');
    try{opening=await readSceneHistory(db,discord,body,count,settings.commandPrefixes);}
    catch{return reply('PhoenixCore could not read this channel’s history. Check Read Message History and try again, or use context: 0 for a fresh scene.');}
  }
  const component=/^npc:([a-f0-9-]{36}):(\d+):(join|order|finish|write|submit|pass|resume)(?::(\d+))?$/.exec(custom);
  if(custom&&!component)return reply('That scene control has expired.');
  return db.transaction(async q=>{
    if(body.id){
      const inserted=await q('INSERT INTO pc_rp_receipts(id,created_ms,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[body.id,Date.now(),'']);
      if(!inserted.length){const [old]=await q('SELECT result FROM pc_rp_receipts WHERE id=$1',[body.id]);return JSON.parse(old.result);}
    }
    const process=async()=>{
      const row=await lockedScene(q,db,channel);
      const actorEntry={id:actor,name:body.member.nick||body.member.user.global_name||body.member.user.username||'Writer'};
      const requested=String(select(body,'character')||'');
      if(act==='roleplay-start'){
        if(row)return reply('There is already a scene here. Use /roleplay-status.');
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
        const mode=select(body,'scene');
        const picked=await selectedCharacter(q,actor,requested);
        if(!picked)return reply('Choose one of your approved characters using the character option.');
        const s:Scene={id:randomUUID(),channel,host:actor,npc:id,title:sheet.name,mode:['spar','audience'].includes(mode)?mode:'open',ai,
          cast:[picked.characterId?picked:actorEntry],round:1,turn:0,form:'',opening:String(select(body,'opening')||'').slice(0,500),history:opening.history,posts:[],past:[],startedAt:Date.now()};
        const saved=await q('INSERT INTO pc_rp_scenes(channel_id,scene_id,state) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING scene_id',[channel,s.id,JSON.stringify(s)]);
        if(!saved.length)return reply('Another writer just started a scene here. Use /roleplay-status.');
        await setClock(q,s,s.startedAt!);
        const panel=sceneOptions(s,sheet,config,opening.note);
        await createScenePanel(q,s,panel.embeds[0]);
        return reply('Scene opened with '+s.title+'. '+opening.note.replace(/\.$/,'')+'.',true,panel);
      }
      if(!row)return reply('There is no active NPC scene here. Use /roleplay-start.');
      const s:Scene=JSON.parse(row.state),action=act==='finish-turn'?'finish':component?.[3];
      if(component&&s.id!==component[1])return reply('This control belongs to an earlier scene. Use /roleplay-status.');
      const privateState=async()=>{
        const sheet=await loadNpc(q,s.npc),stats=sheet?formStats(sheet,s.form):null;
        const wrote=slotHasPost(s);
        const status=s.paused?'Paused. Any joined writer can resume.':wrote?'The current writer has posted. Use /finish-turn when ready.':currentWriter(s)&&s.startedAt?'Unanswered turn passes <t:'+Math.floor((s.startedAt+turnWindow)/1000)+':R>.':'';
        return reply('**'+s.title+' · Round '+s.round+'**\n'+order(s)+'\n'+(stats?(stats.form?.name||'Base')+' · PL '+displayPL(stats.pl):'NPC sheet unavailable')+(status?'\n'+status:'')+(row.delivery_note?'\n'+row.delivery_note:'')+(s.ai?'\nAI dialogue shares scene history and participating writers’ posts with OpenAI.':''),true,{components:controls(s)});
      };
      if(act==='roleplay-status'||action==='order')return privateState();
      if(act==='roleplay-cancel'){
        if(actor!==s.host&&!signedAdmin(body,config))return reply('Only the writer who started this scene or a Discord administrator can cancel it.');
        await q('DELETE FROM pc_rp_scenes WHERE scene_id=$1',[s.id]);return reply('The scene with '+s.title+' has ended.',false);
      }
      if(!action&&act!=='roleplay-join')return reply('Unknown roleplay control.');
      if(!scope?.interactionEligible(settings,body))return reply('This location is outside current RP coverage. The initiator or an administrator can still cancel the scene.');
      if(!player.isPlayer&&!player.isOwner&&!(action==='pass'&&signedAdmin(body,config)))return reply('A current player role is required.');
      if(action==='join'||act==='roleplay-join'){
        const picked=await selectedCharacter(q,actor,requested);
        if(!picked)return reply('Choose one of your approved characters with /roleplay-join. Each character has a separate turn.');
        const all=[...s.cast,...(s.waiting||[])];
        if(all.some(p=>p.id===actor&&p.characterId===picked.characterId))return reply('That character is already in this scene.\n'+order(s));
        if(s.cast.length+(s.waiting?.length||0)>=12)return reply('This scene already has twelve character slots.');
        const entrant=picked.characterId?picked:actorEntry;
        if(Number(row.ready_at)){(s.waiting??=[]).push(entrant);}else{s.cast.push(entrant);}
        await q('UPDATE pc_rp_scenes SET state=$1 WHERE scene_id=$2',[JSON.stringify(s),s.id]);
        await touchScenePanel(q,s);
        return reply('Joined as '+entrant.name+' '+(Number(row.ready_at)?'for the next round':'in round '+s.round)+'. The scene panel has been updated.\n'+order(s),true);
      }
      if(component&&(Number(component[2])!==s.round||component[4]!==undefined&&Number(component[4])!==s.turn))return privateState();
      if(action==='write'||action==='submit')return reply('Write directly in this channel using your character tag, then type /finish-turn.');
      if(s.paused){
        if(action==='resume'&&await resumeTurn(q,s,actor,Date.now()))return reply('Your turn has started.');
        return privateState();
      }
      if(Number(row.ready_at))return reply(s.title+' is responding. '+(row.delivery_note||'The next round opens after the reply.'));
      if(actor!==currentWriter(s)&&!(action==='pass'&&(signedAdmin(body,config)||actor===s.host)))return reply('It is <@'+currentWriter(s)+'>’s turn. Use /roleplay-join to enter the order.');
      if(action!=='finish'&&action!=='pass')return privateState();
      if(action==='finish'&&!slotHasPost(s))return reply('Post in character first, then type /finish-turn. Use Pass turn to skip.');
      const writer=currentWriter(s);
      await nextTurn(q,s,Date.now(),'<@'+writer+'>'+ (action==='pass'?' passed.':' finished their turn.'));
      return reply(s.paused?'The round is paused.':currentWriter(s)?'Turn passed to <@'+currentWriter(s)+'>.':s.title+' is responding.');
    };
    const result=await process();
    if(body.id)await q('UPDATE pc_rp_receipts SET result=$1 WHERE id=$2',[JSON.stringify(result),body.id]);
    return result;
  });
}
