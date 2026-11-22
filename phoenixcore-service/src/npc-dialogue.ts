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
const introduction=/\b(?:call me|my name is|name's|my name's)\s+([\p{L}][\p{L}'’\-]{0,23}(?: [A-Z][\p{L}'’\-]{0,23})?)/u;
function givenName(text:string){return introduction.exec(text.replace(/[*_]/g,'').replace(/\b(?:Call me|My name is|My name's|Name's)\b/g,v=>v.toLowerCase()))?.[1];}
export function conversation(s:Scene,sheet:any,king:boolean):string{
  const last=s.posts.at(-1);if(!last)return '';
  const text=lower(last.text),npc=king?'Azurik':String(sheet.name);
  const memory=s.past.flatMap(r=>r.posts).filter(p=>p.name===last.name);
  const newName=givenName(last.text);
  const name=newName||[...memory].reverse().map(p=>givenName(p.text)).find(Boolean)||last.name;
  const previous=s.past.at(-1)?.reply||'';
  const pick=(lines:string[],why:string)=>freshLine(s,lines,why);
  if(/\b(?:just (?:saying|wanted to say|came to say|said) (?:hello|hi|hey)|don't want (?:a |to )(?:fight|spar)|not here to fight|why (?:are|were) you (?:fighting|attacking)|was only (?:saying|trying to say))\b/.test(text))return pick([
    '“Then a hello it is.” '+npc+' gives '+name+' a rueful smile. “You came over to be kind. I can at least return the courtesy. How has the day treated you?”',
    npc+' lets out a quiet breath. “I read that badly, '+name+'. Thank you for saying so plainly.” The next smile comes more easily. “I am glad you came to talk.”',
    '“Of course. You have my attention.” The formality slips out of '+npc+'’s voice. “Call me by my name. It sounded quite natural the first time.”'
  ],'repair');
  if(newName)return pick([
    '“'+name+'.” '+npc+' repeats the name once, carefully enough to get it right. “You may call me '+npc+'. I get called a great many other things in a day. That one still suits me best.”',
    npc+' inclines his head at the introduction. “It is good to meet you, '+name+'. And since you gave me a name instead of a title, let me return the favor. I’m '+npc+'.”'
  ],'introduction');
  if(/\b(?:how (?:are|have) you|how (?:has|was|is|goes) (?:your|the) day|how's (?:it going|your day)|how (?:you were|you are|you've been) (?:doing|feeling)|you (?:doing|holding up|all right|alright|okay|well)|what's (?:up|new))\b/.test(text))return pick([
    '“Better for being asked, '+name+'.” '+npc+' smiles at the small surprise of it. “Most people who ask how I am have a second question waiting behind the first. For once I think someone meant it. How about you?”',
    npc+' takes the question seriously enough to think before answering. “A little tired. Glad of the company, though. It has been a long day for the title and a fairly good one for the man wearing it.”',
    '“Honestly? I could use a little company.” A hint of amusement warms '+npc+'’s voice. “I have given quite enough formal answers for one day. Tell me something from yours, '+name+'.”'
  ],'wellbeing');
  if(king&&/\b(?:father|ziex|dad)\b/.test(text)&&/\bziex\b/i.test(String(sheet.family)+' '+sheet.bio))return pick([
    '“Ziex. My father’s name was Ziex.” Azurik lets the name sit between them for a moment. “He was my king as well as my father. It took me longer than I like to admit to learn that loving him and obeying him were two different things.”',
    'Azurik’s hands come together behind his back. “My father was King Ziex. At the Crimson Peaks I asked him to surrender. Of all the things I said to him, that is the one I remember word for word.”',
    '“I still think of him as my father first,” Azurik admits. “The histories have an easier time of it. They can call him King Ziex and let that stand. A son remembers the voice that answered to the name.”'
  ],'father');
  if(king&&/\b(?:how old|your age|what age)\b/.test(text)&&sheet.age)return '“'+sheet.age+'.” Azurik catches himself smiling at how quickly the answer came. “Long enough for someone to call me wise before I have even opened my mouth. I find that a rather generous arrangement.”';
  if(/\b(?:hey|hiya|hi|hello|howdy|greetings|good (?:morning|evening|afternoon)|yo)\b/.test(text)&&tokens(text).length<=10)return pick([
    '“Hello, '+name+'.” '+npc+' turns at the sound of his name. There is an easy warmth in the answer. “You caught me with a moment to myself. Come, keep me company. Was there something on your mind, or did you simply come to say hello?”',
    npc+' glances up. “Hey yourself, '+name+'.” The informality seems to please him. “I spend enough of my day answering to a title. It’s good to hear my name once in a while. How are you?”',
    'At the greeting, '+npc+' gives '+name+' his full attention. “Good to see you. I was rather hoping for an ordinary conversation today.” A small smile follows. “I’ll let you decide where we begin.”',
    '“There you are.” '+npc+' inclines his head to '+name+'. “For a moment I thought I was about to be addressed as ‘Your Majesty’ again. Azurik will do nicely.” He smiles. “What brings you my way?”'
  ],'greeting');
  if(/\b(?:sorry|apologi[sz]e|my mistake|my fault)\b/.test(text))return pick([
    '“Thank you for telling me.” '+npc+' gives the words a moment to land. “I would rather have an honest correction now than have you carry an awkward silence away with you. We can begin again, '+name+'.”',
    npc+' shakes his head gently. “I heard you. We needn’t make an ordeal of it.” His expression softens. “What did you mean to tell me before we got sidetracked?”'
  ],'apology');
  if(/\b(?:thanks|thank you|appreciate it)\b/.test(text)&&tokens(text).length<=14)return pick([
    '“You’re welcome, '+name+'.” '+npc+' accepts the thanks as simply as it was offered. “If you ever have something difficult to say to me, I hope you remember you can come to me just as easily then.”',
    npc+' smiles. “Gladly. And if it does help, I’d like to hear how it turns out.” He allows the moment to settle, content to leave the next word to '+name+'.'
  ],'thanks');
  if(previous&&/\b(?:good|great|fine|well|tired|rough|awful|busy)\b/.test(text)&&/how (?:about|are)|your day|day treated|from yours/i.test(previous)&&tokens(text).length<22){
    if(/tired|rough|awful|busy/.test(text))return '“One of those days.” '+npc+' lets the formality fall away. “We can sit a moment if you like, '+name+'. You can tell me what happened, or we can both have a little quiet. I should be grateful for either.”';
    return '“I’m glad to hear it.” '+npc+' looks pleased at the answer. “Good days have a habit of slipping by while everybody is busy recording the bad ones. What made this one worth remembering, '+name+'?”';
  }
  return '';
}
