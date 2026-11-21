import type {Scene} from './npc-voice.ts';
import type {Memory} from './npc-history.ts';

const words=(value:string)=>value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length||0;
export function replyLength(s:Scene) {
  const totals=new Map<string,number>();
  for(const post of s.posts)totals.set(post.writer,(totals.get(post.writer)||0)+words(post.text));
  const sample=totals.size?[...totals.values()]:(s.history||[]).slice(-3).map(p=>words(p.text));
  const average=sample.length?sample.reduce((a,b)=>a+b,0)/sample.length:70;
  return Math.max(65,Math.min(260,Math.round(average)));
}
export function detail(value:string) {
  const text=value.replace(/https?:\/\/\S+|<[@#][^>]*>|[*_~\x60@]/g,' ').replace(/\s+/g,' ').trim();
  const quoted=text.match(/[“"]([^"”]{3,170})[”"]/);
  const phrases=(quoted?.[1]||text).split(/[.!?;:\n]/u).map(p=>p.trim()).filter(Boolean);
  const phrase=phrases.sort((a,b)=>Math.min(72,b.length)-Math.min(72,a.length))[0]||'';
  return phrase.split(/\s+/).slice(0,12).join(' ').replace(/[,–—\s]+$/,'');
}
type Beat={words:RegExp;opening:[string,string];development:string;choice:string};
const beats:Beat[]=[
  {words:/\b(bridge|wreck|cave|rift|ruins?|gate|tunnel|door|passage|hatch|corridor|vault)\b/i,
    opening:['stops at the threshold. One hand comes up, palm open, while the other feels along the edge nearest him. “Give me a moment. I would like to know what opens from this side.”','moves far enough aside to keep the way clear and studies the entrance from a different angle. “Someone expected to pass through here. I wonder which direction they were travelling.”'],
    development:'He looks back along the approach. From here he can keep an eye on the way in as well as the way ahead. He shifts his weight and leaves space beside him for someone to take a closer look.',
    choice:'“I can take the first step or keep watch from here. Which would help you?”'},
  {words:/\b(signal|radio|static|beacon|transmission|broadcast|distress|frequency|receiver|comms)\b/i,
    opening:['falls quiet to catch the next break in the signal. He counts the gap on his fingers. “If someone is trying to reach us, I would like to hear the part they thought worth repeating.”','angles his head toward the sound and waits through a stretch of silence. “There. Did that break come in the same place? Give it one more breath before we answer.”'],
    development:'He repeats the rhythm softly, under his breath. When he reaches the place where he expected an answer, he stops. The silence is long enough to give somebody on the other end a chance to speak.',
    choice:'“What should they hear from us first? I can give them my name, if a name will keep them listening.”'},
  {words:/\b(storm|rain|snow|flood|avalanche|winds?|lightning|earthquake|shelter|blizzard)\b/i,
    opening:['turns a shoulder into the weather and raises his voice just enough to carry. “Can you still hear me at this distance?” He takes one careful step and waits to judge the footing.','comes alongside, close enough that an ordinary voice can carry. “We can change our destination. We have less choice about the next few steps.” He checks the ground immediately ahead.'],
    development:'He picks out a spot he can still see when he lowers his head. It is a small distance to aim for, a place where someone can stop and count heads before committing to the next stretch.',
    choice:'“Is there someone still out here whom we ought to be looking for?”'},
  {words:/\b(market|stall|merchant|trade|coin|price|deal|bargain|cargo|auction)\b/i,
    opening:['turns out an empty palm. “Before I name a price, tell me what part of this bargain you need most.” He waits, giving the question the weight of a genuine offer.','listens to the terms a second time. “There are two promises in what you are asking. Let us put a name to each before anyone gives their word.”'],
    development:'He considers what he could actually promise with the people present. It takes him longer to arrive at something modest than it would have taken to offer everything. This time he wants the other party to be able to collect.',
    choice:'“What would make the agreement worth keeping tomorrow, when both of us have what we came for?”'},
  {words:/\b(festival|music|song|dance|feast|dinner|cook\w*|tea|bread|meal|cake|joke|laugh\w*)\b/i,
    opening:['lets a small smile show. “You may have to teach me the custom. I would rather make a fool of myself honestly than have everybody pretend I have it right.” He turns his palms up in invitation.','looks round for the person who began it, a hint of amusement softening his expression. “It seems I came just in time. Show me the part a newcomer usually gets wrong.”'],
    development:'For once he gives himself permission to be a guest. He lends the occasion his full attention, listening for the little pause that might tell him when to join in and when to leave the moment to someone else.',
    choice:'“Who taught you? It sounds as though there is a story in the way you remember it.”'},
  {words:/\b(hurt|wound\w*|afraid|grief|lost|mourn\w*|miss(?:ing)?|funeral|sorry|regret\w*|frighten\w*)\b/i,
    opening:['stays within earshot and lets the first silence pass. “I can stay,” he says at last. “Would you like company, or is there someone in particular you want me to find?”','lowers his voice. “You need only tell me as much as you choose.” He leaves a little space beside him, an invitation that can be taken up or quietly left alone.'],
    development:'His hands settle at his sides. There are questions he wants to ask, but the answer to his first one ought to belong to the person who has to live with it. He waits for that answer.',
    choice:'“If there is one thing you need done before we leave, I have time to do it.”'},
  {words:/\b(map|trail|ship|tracks?|journey|road|sail\w*|land(?:ed|ing)|pilot|planet|travel\w*|river)\b/i,
    opening:['takes a moment to find his bearings. “Show me where you last knew the way for certain.” He turns to look back along the route, giving the return journey as much thought as the road ahead.','comes level with the party and glances over his shoulder. “I can follow your lead from here. Tell me what you expect to see first, so I know what to watch for.”'],
    development:'He takes a few steps in the proposed direction and stops where his companions can still reach him. A plan laid out from a distance looks rather different with the ground actually under his feet.',
    choice:'“If we find that the way has changed, where would you have us meet again?”'},
  {words:/\b(clue|cipher|letter|key|ledger|rune|secret|mark|symbol|envelope|suspect|theft|stole|evidence)\b/i,
    opening:['leans in for a closer look, keeping his hands clear. “What first drew your attention to it?” He studies the detail again from the angle the speaker indicated.','asks to see it where it was found. “Someone made a choice when they put it here. I would like to understand that choice before I make one of my own.”'],
    development:'He considers a second explanation and looks for the detail that would tell the two apart. What interests him most is the part a hurried observer might have dismissed as ordinary.',
    choice:'“Suppose we have read it wrong. Which detail would you check first?”'}
];
function relevant(s:Scene) {
  const sources=[...s.posts].reverse().map(p=>p.text);
  sources.push(...s.past.slice(-1).flatMap(r=>[...r.posts].reverse().map(p=>p.text)),s.opening,...[...(s.history||[])].reverse().map(p=>p.text));
  for(const source of sources){const b=beats.find(b=>b.words.test(source));if(b)return b;}
}
function npcVoice(text:string,name:string,gender:unknown){
  if(/^(male|man|he\/him)$/i.test(String(gender)))return text;
  const feminine=/^(female|woman|she\/her)$/i.test(String(gender));
  const forms:Record<string,string>=feminine?{he:'she',him:'her',his:'her',himself:'herself'}:{he:name,him:'them',his:'their',himself:'themself'};
  return text.replace(/\b(he|him|his|himself)\b/gi,match=>{
    const word=forms[match.toLowerCase()];
    return /^[A-Z]/.test(match)?word.charAt(0).toUpperCase()+word.slice(1):word;
  });
}
export function sceneBeat(s:Scene,name:string,gender:unknown) {
  const beat=relevant(s);
  return beat?name+' '+npcVoice(beat.opening[(s.round-1)%2],name,gender):'';
}
function voices(s:Scene):Memory[]{
  const speakers=new Map<string,Memory>();
  for(const post of s.posts)speakers.set(post.writer+'|'+post.name,post);
  return [...speakers.values()];
}
export function expandPost(s:Scene,sheet:any,first:string,combat:boolean,king:boolean){
  const name=king?'Azurik':sheet.name,goal=replyLength(s),cast=voices(s);
  const beat=relevant(s),last=cast.at(-1),prior=s.past.at(-1)?.posts.at(-1)??s.history?.at(-1);
  const additions:string[]=[];
  if(cast.length>1){
    const other=cast.find(p=>p!==last)!;
    additions.push(name+' turns to '+other.name+(last?' and then to '+last.name:'')+'. “'+(detail(other.text)?'You gave me another angle when you spoke of ‘'+detail(other.text)+'’. ':'')+'Is there something each of you can see from where you stand that the other might miss?”');
  }
  if(combat){
    additions.push(...(s.round%2?[
      'He eases out a breath and shifts his rear foot a handspan. For a moment he holds that position, giving the other fighter a clear look at the change in his balance. His eyes stay on the space between them.',
      '“Watch what I have to move before I can move toward you. A shoulder, perhaps. The heel lifting. You have time to choose an answer in that little space.” He leaves the invitation open.']: [
      'He opens the distance by a single pace. It gives him time to see where his partner means to take the exchange, and enough room to change his own answer if he has read it poorly.',
      '“Show me what you saw that time.” He keeps his guard loose as he waits. Even a small adjustment will give him something different to work with on the next exchange.']));
  }else if(beat){
    additions.push(npcVoice(beat.development,name,sheet.gender),beat.choice);
  }
  if(combat&&!king)for(let i=cast.length>1?1:0;i<additions.length;i++)additions[i]=npcVoice(additions[i],name,sheet.gender);
  if(prior&&detail(prior.text)&&(!s.past.length||goal>110)){
    additions.push('“'+prior.name+' spoke of ‘'+detail(prior.text)+'’.” '+name+' considers that detail again in light of what has just happened. “Does that still hold, or have we learned something that changes it?”');
  }
  if(s.opening&&goal>110&&detail(s.opening))additions.push(name+' recalls what first brought them here. “'+detail(s.opening)+'.” It gives the conversation a place to start, even if the decision facing them now turns out to be quite different.');
  if(king){
    additions.push(...(s.round%2?[
      'Azurik clasps his hands behind his back. His thumb finds the old seam of his glove as he weighs his first answer. By the time he speaks, the question he meant to ask has grown a little gentler.',
      '“I am willing to put my name to the next step. Before I do, tell me whose word I ought to hear besides my own.” He waits, looking to the people who brought him here.']: [
      'The king opens his mouth, then thinks better of the reply. He unclasps his hands and gives the speaker his whole attention. Whatever answer he gives here, someone else will have to carry a part of it.',
      '“If I have misunderstood, say so while there is time to choose differently.” His voice is quiet enough to leave room for an interruption. He has learned to value the person willing to make one.']));
  }else{
    additions.push(name+' leaves the decision open long enough for the others to speak. “I can offer you my part in this. Tell me where it would count for the most.”');
  }
  if(last&&detail(last.text))additions.push('“'+last.name+', when you said ‘'+detail(last.text)+'’, what were you hoping I would understand?” '+name+' holds still to hear the answer before choosing the next move.');
  const used=s.past.slice(-1)[0]?.reply||'';
  const parts=[first];
  for(const line of [...additions.filter(v=>!used.includes(v)),...additions.filter(v=>used.includes(v))]){
    if(words(parts.join(' '))>=goal)break;
    if(!parts.includes(line))parts.push(line);
  }
  return parts.join('\n\n');
}
