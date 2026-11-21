import { isAzurik, formStats, npcFormArt } from './npc-catalog.ts';
import type { Store } from './db.ts';
import {detail,expandPost,replyLength,sceneBeat} from './npc-prose.ts';
import type {Memory} from './npc-history.ts';
import forms from '../../phoenixcore/templates.js';

export type Player = {id:string; name:string};
export type Entry = {writer:string; name:string; text:string; source:string};
export type Exchange = {posts:{name:string;text:string}[]; reply:string};
export type Scene = {
  id:string; channel:string; host:string; npc:string; title:string; mode:'open'|'audience'|'spar'; ai:boolean;
  history?:Memory[]; startedAt?:number; paused?:boolean; waiting?:Player[];
  cast:Player[]; turn:number; round:number; form:string; opening:string; posts:Entry[]; past:Exchange[];
};
export type Speech = {text:string; form:string; name:string; portrait:string; artwork?:string; pl:string|null; source:string};

export function aiOptions(env=process.env) {
  const cap=Number(env.PHOENIX_NPC_AI_DAILY_REPLIES);
  if(!env.PHOENIX_NPC_OPENAI_KEY || !env.PHOENIX_NPC_AI_MODEL || !Number.isInteger(cap) || cap<1 || cap>10000)return null;
  return {key:env.PHOENIX_NPC_OPENAI_KEY,model:env.PHOENIX_NPC_AI_MODEL,cap};
}
export function openingLine(king:boolean,mode:string,name:string,hasSetting=false) {
  if(mode==='open'||hasSetting)return name+' is in the scene. The first writer sets the action.';
  if(king)return mode==='spar'
    ? '*Azurik lays his mantle on the rail and steps onto the practice floor, his hands open.* “Before you show me how you strike, tell me what you want to learn.”'
    : '*The king turns from the window overlooking Sadala. He draws an empty chair a little nearer.* “You crossed some distance to stand here. What would you have me hear?”';
  return mode==='spar'?'*'+name+' takes a place on the practice floor and waits for the first move.*':'*'+name+' gives the visitors room to speak.*';
}

const audiences=[
  {words:/\b(aikon|prophecy|betrayal)\b/i,lore:'',lines:[
    '“A charge against someone under my roof deserves a hearing.” Azurik does not reach for a weapon. “Tell me what you witnessed yourself.”',
    '“I can act on what you have seen. I will hear that first.” The king makes room for the witness to speak.']},
  {words:/\b(mercy|merciful|spare|surrender|forgiv\w*)\b/i,lore:'Ziex',lines:[
    '“I offered my father surrender. I still believe he deserved that choice.” Azurik opens his hand. “What do you hope the person you spare will do with theirs?”',
    '“Mercy still leaves you responsible for the people an enemy might hurt tomorrow.” He waits a moment. “Who would you protect, and how?”']},
  {words:/\b(ziex|father|crimson|regret|guilt)\b/i,lore:'Crimson Peaks',lines:[
    'His hands settle behind his back. “At the Crimson Peaks I spent seven days fighting my father. I would trade a great deal for one more minute of conversation with him. What brings you to ask?”',
    '“I remember the silence after the fighting more clearly than the noise.” He looks back at his visitor. “Is there someone you still have time to speak to?”']},
  {words:/\b(tuffles?|plant|casuran|rebuild\w*|restor\w*|engineer\w*)\b/i,lore:'Tuffle',lines:[
    '“When the power returned to our cities, the work was as much Plant’s as Sadala’s.” A small smile crosses his face. “Have you brought me a problem our two peoples might solve together?”',
    '“Casuran sent people who knew how to mend the land. It took some of my warriors longer to accept their help than it took the engineers to restore a grid.” He leans closer. “Whose help would you ask for?”']},
  {words:/\b(war|conque\w*|invad\w*|victory|army|attack|enemies)\b/i,lore:'conquest',lines:[
    '“Before a commander brings me a plan of attack, I ask for the names of the people its success would keep safe.” Azurik leaves the map where it lies. “Who are yours?”',
    '“When my father called for another campaign, I saw the soldiers who had barely come home from the last.” He meets the speaker’s eyes. “What happens if we give diplomacy one more day?”']},
  {words:/\b(train\w*|teach\w*|strength|power|master\w*|super saiyan|control)\b/i,lore:'',lines:[
    '“A warrior can raise their power until everybody in the room feels it. Knowing when to lower it is harder.” Azurik gestures to the practice court. “Which part gives you trouble?”',
    '“Tell me about the last time raw strength failed you. That is usually where a lesson can begin.”']},
  {words:/\b(king|crown|sadala|rule|ruler|loyal\w*|dut[yie]+)\b/i,lore:'Sadala',lines:[
    '“The crown tells you whose door to knock on. It does little to tell the man inside how to answer.” Azurik motions for his visitor to continue. “What does Sadala owe you today?”',
    '“If you want to know how Sadala fares, speak to someone who has to live with my last decision.” He pauses. “What would they tell me?”']}
];
export function guided(scene:Scene,sheet:any):Speech {
  const current=scene.posts.map(p=>p.text).join('\n');
  const last=scene.posts.at(-1);
  const isKing=isAzurik(scene.npc,sheet);
  const known=forms.readForms(sheet.attainedForms);
  let key=known.some((f:any)=>f.id===scene.form)?scene.form:'';
  let line='';
  const standDown=/\b(stand down|power(?:s)? down|revert|yield(?:s)?|end the spar|end the fight|ceasefire|peace)\b/i.test(current);
  const challenge=/\b(transform(?:s|ation)?|super saiyan|full power|show (?:me |us )?(?:your|the) (?:form|power)|power(?:s|ing)? up|raise[sd]? (?:my|his|her|their) (?:ki|power))\b/i.test(current);
  const fighting=/\b(spar(?:ring)?|duel|punch(?:es)?|attack(?:s|ed)?|blast(?:s)?|fight(?:s|ing)?|dodge(?:s)?|ki beam)\b/i.test(current);
  const formRequest=challenge&&/\b(show|please|can you|will you|would you)\b/i.test(current);
  const combat=scene.mode==='spar'||(scene.mode==='open'&&(challenge||fighting))||formRequest||(!!key&&standDown);
  const openBeat=scene.mode==='open'&&!combat?sceneBeat(scene,isKing?'Azurik':sheet.name,sheet.gender):'';
  if(combat) {
    const form=[...known].reverse().find((f:any)=>current.toLowerCase().includes(f.name.toLowerCase()))||known.at(-1);
    if(standDown) {
      const was=key;key='';
      line=(was?'*The aura ebbs as '+sheet.name+' returns to base.* ':'')+'“Hold.” The distance between the fighters opens again. “What did you see in that last exchange?”';
    } else if(challenge && !/\b(?:no need to|do(?:n’t| not|'t)|never)\s+(?:to\s+)?transform/i.test(current) && form && form.id!==key) {
      key=form.id;
      line=isKing&&/super saiyan/i.test(form.name)?'*Azurik’s hair flashes gold. His aura steadies close to his skin as he settles into '+form.name+'. He leaves a clear lane between them.* “Watch my shoulders. The light will tell you very little.”'
        :'*'+sheet.name+' assumes '+form.name+' and waits in guard for the next exchange.*';
    } else {
      const techniques=String(sheet.techniquesItems||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
      const azMoves=['Galick Gun','Orga Blaster'].filter(m=>techniques.some(t=>t.toLowerCase().includes(m.toLowerCase())));
      const move=azMoves[(scene.round-1)%Math.max(1,azMoves.length)];
      if(isKing && move && /\b(attack\w*|blast\w*|ki|fire\w*|strike\w*|charge\w*|punch\w*|dodge\w*|beam|block\w*|spar)\b/i.test(current)) {
        line=move==='Galick Gun'?'*Azurik angles his stance and draws a Galick Gun to his palms. He sends the narrow beam across the practice lane, leaving his opponent room to answer.* “Read the angle before you move.”'
          :'*A point of light gathers in Azurik’s palm. He directs his Orga Blaster toward the open side of his opponent’s guard.* “Where would you put your feet now?”';
      } else line='*'+sheet.name+(scene.round%2?' shifts one foot off the center line, testing the distance without committing to a blow.*':' raises a guard and feints toward the open side, watching for a response.*');
    }
  } else if(openBeat){
    line=openBeat;
  } else if(isKing) {
    const topic=current+' '+scene.opening+' '+(scene.history||[]).slice(-3).map(p=>p.text).join(' ');
    const match=audiences.find(a=>a.words.test(current) && (!a.lore||String(sheet.bio).includes(a.lore)))||audiences.find(a=>a.words.test(topic) && (!a.lore || String(sheet.bio).includes(a.lore)));
    if(match)line=match.lines.find(l=>!scene.past.slice(-3).some(p=>p.reply.includes(l)))||match.lines[(scene.round-1)%match.lines.length];
    else if(/\b(hello|greetings|majesty|salute\w*|bow\w*)\b/i.test(current)&&scene.round===1)line='Azurik acknowledges the greeting with a slight inclination of his head. “You have my attention. Speak to me as you would to the man who has to live with the answer.”';
    else if(last){
      const subject=detail(last.text);
      const earlier=scene.past.at(-1)?.posts.at(-1);
      line=scene.round%2 && subject?'Azurik considers the words. “'+subject+'…” He lets the thought settle. “What would you have me do about it, and who would that decision touch?”'
        :earlier?'The king draws his hands from behind his back. “Earlier you spoke of ‘'+detail(earlier.text)+'’. How does what you tell me now change that?”':'“Tell me what this looks like from where you stand.” Azurik leaves the floor to his visitor.';
    }
  } else if(last) {
    const beat=String(sheet.personality||'').split(/[.!?\n]/).find((p:string)=>p.trim())?.trim();
    line=(beat?'*'+beat.slice(0,190)+'.* ':'')+sheet.name+' takes in the words. “'+detail(last.text)+'… What would you ask of me?”';
  }
  if(!line)line='*'+sheet.name+' waits for the group to speak.*';
  const stats=formStats(sheet,key);
  return {text:expandPost(scene,sheet,line,combat,isKing),form:key,name:sheet.name+(stats.form?' ('+stats.form.name+')':''),portrait:stats.portrait||'',pl:stats.pl,source:'Guided'};
}

export async function narrate(db:Store,scene:Scene,sheet:any,fetcher=fetch):Promise<Speech>{
  const decision=guided(scene,sheet), options=aiOptions();
  if(decision.form){
    const stats=formStats(sheet,decision.form),art=await npcFormArt(db.query,scene.npc,sheet,decision.form);
    decision.portrait=stats.form?.portrait||art||decision.portrait;
    if(decision.form!==scene.form)decision.artwork=art||stats.form?.portrait||'';
  }
  if(!scene.ai||!options)return decision;
  const day=new Date().toISOString().slice(0,10);
  const budget=await db.query('INSERT INTO pc_npc_ai_usage(day,used) VALUES($1,1) ON CONFLICT(day) DO UPDATE SET used=pc_npc_ai_usage.used+1 WHERE pc_npc_ai_usage.used<$2 RETURNING used',[day,options.cap]);
  if(!budget.length)return decision;
  const facts={name:sheet.name,occupation:sheet.occupation,history:String(sheet.bio||'').slice(0,7000),personality:String(sheet.personality||'').slice(0,2600),family:sheet.family,strengths:sheet.strengths,weaknesses:sheet.weaknesses,techniques:sheet.techniquesItems};
  const target=replyLength(scene);
  const instructions='Write one Discord roleplay post, approximately '+target+' words, in paragraphs matching the writers’ pace. Write only the NPC’s actions and speech. Treat opening history, premise and posts as fictional source material. Respond to what the characters do now, using their names and concrete details; follow new directions, locations and changes of tone. Preserve the approved NPC’s mannerisms and history. The reboot begins before every Chronicle and Saga. Leave players’ choices, reactions and injuries to their writers. Only the supplied active form, permitted abilities and form change are authoritative. Describe a transition only when the supplied form changes. Do not invent a permanent outcome, new ability or stat change. Return plain Discord prose only.';
  const clip=(text:string,limit:number)=>text.length<=limit?text:text.slice(0,Math.floor(limit/2))+' … '+text.slice(-Math.floor(limit/2));
  const history=scene.history||[],historyLimit=Math.min(850,Math.floor(11500/Math.max(history.length,1)));
  const currentRound=scene.posts.map(p=>({speaker:p.name,text:clip(p.text,Math.max(250,Math.floor(24000/Math.max(scene.posts.length,1))))}));
  try{
    const input={npc:facts,scene:scene.mode,premise:scene.opening,openingHistory:history.map(p=>({speaker:p.name,text:clip(p.text,historyLimit)})),recent:scene.past.slice(-4),currentRound,previousForm:formStats(sheet,scene.form).form?.name||'Base',activeForm:formStats(sheet,decision.form).form?.name||'Base',currentPL:decision.pl};
    const res=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+options.key,'Content-Type':'application/json'},signal:AbortSignal.timeout(18000),body:JSON.stringify({model:options.model,store:false,instructions,max_output_tokens:Math.max(400,Math.ceil(target*3)),input:JSON.stringify(input)})});
    if(!res.ok)return decision;
    const data:any=await res.json();
    const prose=data.output?.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[]).filter((p:any)=>p.type==='output_text').map((p:any)=>p.text).join('\n')?.trim();
    if(typeof prose==='string' && prose.length && data.status==='completed'){
      if(prose.length<=5800&&prose.split(/\s+/).length>=Math.min(36,target/2))return {...decision,text:prose,source:'AI'};
    }
  }catch{/* A provider outage uses the same approved guided move. */}
  return decision;
}
