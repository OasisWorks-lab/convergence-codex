import {createHash} from 'node:crypto';
import type {Scene} from './npc-voice.ts';

export type TurnIntent='conversation'|'invitation'|'defence'|'demonstration'|'revert';
const lower=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[*_~]/g,'');
const tokens=(text:string)=>lower(text).match(/[\p{L}\p{N}']+/gu)||[];
export const openingOf=(text:string)=>tokens(text).slice(0,8).join(' ');
export function repeatsOpening(s:Scene,text:string){
  const opening=openingOf(text);
  return !!opening&&s.past.some(p=>openingOf(p.reply)===opening);
}
export function freshLine(s:Scene,lines:string[],salt:string){
  const unseen=lines.filter(l=>!repeatsOpening(s,l)&&!s.past.some(p=>p.reply.includes(l)));
  const pool=unseen.length?unseen:lines;
  const seed=[s.id,s.round,s.posts.at(-1)?.text,salt].join('|');
  return pool[createHash('sha256').update(seed).digest().readUInt32BE(0)%pool.length];
}
export function turnIntent(s:Scene):TurnIntent {
  // The latest explicit action wins. A setting or an old battle is never a current attack.
  for(const post of [...s.posts].reverse()){
    const clauses=lower(post.text).split(/(?:[.!?;\n]|\bbut\b|\binstead\b)+/).filter(Boolean).reverse();
    for(const line of clauses){
      if(/\b(?:stand down|revert(?: to base)?|power down|return to base|lower your (?:ki|power)|end (?:the|our) (?:spar|fight))\b/.test(line)&&!/(?:don't|do not|never) (?:stand|revert|power|return|lower|end)/.test(line))return 'revert';
      if(/\b(?:don't|do not|won't|wouldn't|no need|not here|not going|rather not|never|stop|quit|avoid|refuse|why .*|remember when|heard about|what if|what is|what's|how did|did you|used to|yesterday)\b.{0,70}\b(?:fight|attack|spar|punch|transform|strike|kick|blast|duel|sparring)\w*/.test(line))continue;
      if(/\b(?:show|demonstrate|let (?:me|us) see)\b.{0,70}\b(?:form|transformation|super saiyan|full power)\b|\b(?:ask(?:s)? (?:you|him|her|azurik) to|invite(?:s)? (?:you|him|her|azurik) to|can you|could you|would you|please|will you)\s+(?:please\s+)?transform\b|^\s*[“"']?transform(?:\s+please)?[”"']?\s*$/.test(line))return 'demonstration';
      if(/\b(?:swings?|throws?|throwing|aims?|aiming|launch(?:es)?|fires?|lunges?|rush(?:es)?|strikes?|attacks?|punch(?:es)?|kicks?)\b.{0,42}\b(?:at|toward[s]?|against|for)\s+(?:the king|azurik|you|him|her|them|his guard|her guard|your guard)\b|\b(?:i|she|he|they)\s+(?:attack|attacks|punch|punches|strike|strikes|kick|kicks)\s+(?:azurik|you|the king)\b/.test(line))return 'defence';
      if(/\b(?:let us|let's|shall we|can we|could we|want to|would you|will you|challenge you to|ready to)\s+(?:a |to )?(?:spar|duel|practice|train)\b/.test(line))return 'invitation';
    }
  }
  return 'conversation';
}
const introduction=/\b(?:call me|my name is|name's|my name's)\s+([\p{L}][\p{L}'’-]{0,23}(?:\s+[\p{L}][\p{L}'’-]{0,23})?)/iu;
function givenName(text:string){
  return introduction.exec(text.replace(/[*_~]/g,''))?.[1]?.trim()||'';
}
export function introducedName(s:Scene,speaker:string){
  const current=s.posts.filter(p=>p.name===speaker).map(p=>p.text);
  const earlier=s.past.flatMap(r=>r.posts).filter(p=>p.name===speaker).map(p=>p.text);
  return [...current,...earlier].map(givenName).filter(Boolean).at(-1)||'';
}
export function conversation(s:Scene,sheet:any,king:boolean):string {
  const last=s.posts.at(-1);if(!last)return '';
  const text=lower(last.text),npc=king?'Azurik':String(sheet.name);
  const newName=givenName(last.text),known=introducedName(s,last.name),salutation=known?', '+known:'';
  const previous=s.past.at(-1)?.reply||'';
  const pick=(lines:string[],why:string)=>freshLine(s,lines,why);
  if(/\b(?:just (?:saying|wanted to say|came to say|said) (?:hello|hi|hey)|don't want (?:a |to )(?:fight|spar)|not here to fight|why (?:are|were) you (?:fighting|attacking)|was only (?:saying|trying to say))\b/.test(text))return pick([
    '“Then a hello it is.” '+npc+' offers a small, apologetic smile. “I mistook your intention. How has the day treated you?”',
    npc+' eases his stance. “I read that badly. Thank you for correcting me.” He gives the visitor room to speak. “What did you want to talk about?”'
  ],'repair');
  if(newName)return pick([
    '“'+newName+'.” '+npc+' repeats the introduction once. “A pleasure to meet you. You may call me '+npc+'.”',
    npc+' inclines his head. “It is good to meet you, '+newName+'. I am '+npc+'. What brings you here?”'
  ],'introduction');
  if(/\b(?:how (?:are|have) you|how (?:has|was|is|goes) (?:your|the) day|how's (?:it going|your day)|how (?:you were|you are|you've been) (?:doing|feeling)|you (?:doing|holding up|all right|alright|okay|well)|what's (?:up|new))\b/.test(text))return pick([
    '“A little tired, if I am being candid.” '+npc+' considers the question. “But I appreciate you asking. How about you?”',
    npc+' pauses. “It has been a long day for the title, and a fairly good one for the man wearing it.” He offers a faint smile. “And yours?”',
    '“Well enough to listen.” '+npc+' leaves the question open. “How has your day been?”'
  ],'wellbeing');
  if(king&&/\b(?:father|ziex|dad)\b/.test(text)&&/\bziex\b/i.test(String(sheet.family)+' '+sheet.bio))return pick([
    '“Ziex was my father,” Azurik says quietly. “He was my king as well. It took me longer than I like to admit to learn that loving him and obeying him were different things.”',
    'Azurik clasps his hands behind his back. “At the Crimson Peaks, I asked King Ziex—my father—to surrender. I still remember that moment.”'
  ],'father');
  if(king&&/\b(?:how old|your age|what age)\b/.test(text)&&sheet.age)return '“'+sheet.age+'.” Azurik lets the number settle. “Long enough to have learned that years alone do not make a person wise.”';
  if(/\b(?:hey|hiya|hi|hello|howdy|greetings|good (?:morning|evening|afternoon)|yo)\b/.test(text)&&tokens(text).length<=10)return pick([
    npc+' looks toward the speaker and offers a brief nod. “Hello'+salutation+'. What can I do for you?”',
    '“Hello.” '+npc+' gives the visitor his attention. “Did you have something you wanted to discuss?”',
    npc+' answers the greeting with a small smile. “Good day. How can I help?”',
    '“Hey.” '+npc+' seems happy enough to set formality aside. “What is on your mind?”'
  ],'greeting');
  if(/\b(?:sorry|apologi[sz]e|my mistake|my fault)\b/.test(text))return pick([
    '“Thank you for telling me.” '+npc+' gives the words a moment to settle. “We can begin again whenever you are ready.”',
    npc+' shakes his head gently. “I heard you. We need not make an ordeal of it. What did you mean to say?”'
  ],'apology');
  if(/\b(?:thanks|thank you|appreciate it)\b/.test(text)&&tokens(text).length<=14)return pick([
    '“You are welcome'+salutation+'.” '+npc+' accepts the thanks without ceremony.',
    npc+' nods. “Gladly. If it helps, I would like to hear how things turn out.”'
  ],'thanks');
  if(previous&&/\b(?:good|great|fine|well|tired|rough|awful|busy)\b/.test(text)&&/how (?:about|are)|your day|day treated|and yours/i.test(previous)&&tokens(text).length<22){
    if(/tired|rough|awful|busy/.test(text))return '“One of those days.” '+npc+' answers gently. “You can tell me what happened, or we can have a little quiet.”';
    return '“I am glad to hear it.” '+npc+' gives an approving nod. “What made it a good day?”';
  }
  return '';
}
