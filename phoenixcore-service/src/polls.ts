import {createHash,randomUUID} from 'node:crypto';
import {requireThat,textValue,discordId} from './domain.ts';
import type {Store,Query} from './db.ts';
import type {Actor} from './domain.ts';
import type {Discord} from './discord.ts';
import {DiscordFailure} from './discord.ts';
import {communityEnabled} from './community.ts';

export const pollIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const receiptPattern=/^[\w-]{8,100}$/;
const oneMonth=30*86_400_000;
const safeColor=0x5865f2;
type Mode='single'|'multiple';
type PollInput={receipt:string;question:string;description?:string;choices:string[];
  mode:Mode;anonymous:boolean;allowChange:boolean;resultsEarly:boolean;
  channelId:string;endsMs:number;requiredRoles?:string[];excludedRoles?:string[];
  color?:number;imageUrl?:string;};
const requireOwner=(actor:Actor)=>requireThat(actor.isOwner,403,'Only the configured Convergence Owner can manage polls.');
function roleIds(input:unknown,label:string){
  requireThat(Array.isArray(input)&&input.length<=20&&input.every(id=>typeof id==='string'&&discordId.test(id)),
    400,label+' must contain at most 20 valid Discord role IDs.');
  return [...new Set(input as string[])];
}
const parseArray=(raw:any):string[]=>JSON.parse(String(raw||'[]'));
function validateInput(input:PollInput,now:number){
  requireThat(input&&typeof input==='object',400,'Choose a valid poll.');
  requireThat(receiptPattern.test(String(input.receipt||'')),400,'A unique poll receipt is required.');
  const question=textValue(input.question,200,'Poll question',true);
  const description=textValue(input.description||'',1000,'Poll description');
  requireThat(Array.isArray(input.choices)&&input.choices.length>=2&&input.choices.length<=10,
    400,'Choose between two and ten poll options.');
  const choices=input.choices.map(value=>textValue(value,100,'Poll option',true));
  requireThat(new Set(choices.map(x=>x.toLowerCase())).size===choices.length,400,
    'Each poll option must have a distinct label.');
  requireThat(input.mode==='single'||input.mode==='multiple',400,'Choose single or multiple answers.');
  for(const field of ['anonymous','allowChange','resultsEarly'] as const)
    requireThat(typeof input[field]==='boolean',400,'Choose whether '+field+' is enabled.');
  requireThat(discordId.test(String(input.channelId||'')),400,'Choose a Convergence text channel.');
  requireThat(Number.isSafeInteger(input.endsMs)&&input.endsMs>=now+60000&&input.endsMs<=now+oneMonth,
    400,'Poll closing time must be between 1 minute and 30 days from now.');
  const requiredRoles=roleIds(input.requiredRoles||[],'Required roles'),
    excludedRoles=roleIds(input.excludedRoles||[],'Excluded roles');
  requireThat(!requiredRoles.some(x=>excludedRoles.includes(x)),400,'A role cannot both qualify and exclude a voter.');
  const color=input.color??safeColor;
  requireThat(Number.isInteger(color)&&color>=0&&color<=0xffffff,400,'Choose a valid Discord embed color.');
  const imageUrl=String(input.imageUrl||'').trim();
  requireThat(!imageUrl||imageUrl.length<=500&&/^https:\/\/[^\s]+$/i.test(imageUrl),400,
    'Use an optional HTTPS image URL of at most 500 characters.');
  return {question,description,choices,mode:input.mode,anonymous:input.anonymous,
    allowChange:input.allowChange,resultsEarly:input.resultsEarly,channelId:input.channelId,
    endsMs:input.endsMs,requiredRoles,excludedRoles,color,imageUrl};
}
function parseRow(row:any){
  return {id:String(row.id),creatorId:String(row.creator_id),question:String(row.question),
    description:String(row.description||''),choices:parseArray(row.choices),
    mode:row.mode as Mode,anonymous:Boolean(Number(row.anonymous)),allowChange:Boolean(Number(row.allow_change)),
    resultsEarly:Boolean(Number(row.results_early)),channelId:String(row.channel_id),
    endsMs:Number(row.ends_ms),status:String(row.status),revision:Number(row.revision),
    requiredRoles:parseArray(row.required_roles),excludedRoles:parseArray(row.excluded_roles),
    color:Number(row.color),imageUrl:String(row.image_url||''),messageId:row.message_id||null,
    createdMs:Number(row.created_ms),closedMs:row.closed_ms?Number(row.closed_ms):null,
    lastError:row.last_error||null};
}
export async function createPoll(db:Store,actor:Actor,input:PollInput,now=Date.now()){
  requireOwner(actor);const v=validateInput(input,now);
  return db.transaction(async q=>{
    const [existing]=await q('SELECT id,creator_id FROM pc_polls WHERE receipt_id=$1',[input.receipt]);
    if(existing){
      requireThat(existing.creator_id===actor.id,409,'This request receipt belongs to a different user.');
      return {id:existing.id,created:false};
    }
    const id=randomUUID();
    await q(`INSERT INTO pc_polls(id,receipt_id,creator_id,question,description,choices,mode,anonymous,allow_change,
      results_early,required_roles,excluded_roles,channel_id,ends_ms,status,color,image_url,created_ms,updated_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17,$17)`,
      [id,input.receipt,actor.id,v.question,v.description,JSON.stringify(v.choices),v.mode,
        v.anonymous?1:0,v.allowChange?1:0,v.resultsEarly?1:0,JSON.stringify(v.requiredRoles),
        JSON.stringify(v.excludedRoles),v.channelId,v.endsMs,v.color,v.imageUrl,now]);
    await q('INSERT INTO pc_poll_events(id,poll_id,actor_id,event,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'created','Owner created draft poll.',now]);
    await q('INSERT INTO pc_poll_posts(poll_id) VALUES($1)',[id]);
    return {id,created:true};
  });
}
export async function editPoll(db:Store,actor:Actor,id:string,revision:number,
  input:PollInput,now=Date.now()){
  requireOwner(actor);requireThat(pollIdPattern.test(id),400,'Choose a poll ID.');
  const v=validateInput(input,now);
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_polls WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Poll not found.');
    requireThat(row.status==='draft',409,'Only unpublished draft polls can change their answers or voting rules.');
    requireThat(Number(row.revision)===revision,409,'Poll changed. Reload before editing.');
    await q(`UPDATE pc_polls SET question=$1,description=$2,choices=$3,mode=$4,anonymous=$5,allow_change=$6,
      results_early=$7,required_roles=$8,excluded_roles=$9,channel_id=$10,ends_ms=$11,color=$12,image_url=$13,
      revision=revision+1,updated_ms=$14 WHERE id=$15`,
      [v.question,v.description,JSON.stringify(v.choices),v.mode,v.anonymous?1:0,v.allowChange?1:0,
        v.resultsEarly?1:0,JSON.stringify(v.requiredRoles),JSON.stringify(v.excludedRoles),v.channelId,
        v.endsMs,v.color,v.imageUrl,now,id]);
    await q('INSERT INTO pc_poll_events(id,poll_id,actor_id,event,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'edited','Draft options and policy revised.',now]);
    return {id,revision:revision+1};
  });
}
export async function transitionPoll(db:Store,actor:Actor,id:string,revision:number,
  action:'publish'|'close'|'cancel',now=Date.now()){
  requireOwner(actor);requireThat(pollIdPattern.test(id),400,'Choose a valid poll ID.');
  requireThat(['publish','close','cancel'].includes(action),400,'Choose a supported poll action.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_polls WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Poll not found.');
    requireThat(Number(row.revision)===revision,409,'Poll changed. Reload before changing its status.');
    requireThat(action==='publish'?row.status==='draft'&&Number(row.ends_ms)>now+30000:
      row.status==='active'||action==='cancel'&&row.status==='draft',
      409,'This poll cannot make the requested status transition.');
    const status=action==='publish'?'active':action==='close'?'closed':'cancelled';
    await q('UPDATE pc_polls SET status=$1,revision=revision+1,updated_ms=$2,closed_ms=$3 WHERE id=$4',
      [status,now,status==='active'?null:now,id]);
    await q('UPDATE pc_poll_posts SET retry_ms=0,lease=NULL,lease_until=0 WHERE poll_id=$1',[id]);
    await q('INSERT INTO pc_poll_events(id,poll_id,actor_id,event,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,status,'Owner requested '+status+'.',now]);
    return {id,status,revision:revision+1};
  });
}
export async function advancePolls(db:Store,now=Date.now(),max=20){
  let closed=0;
  for(let i=0;i<max;i++){
    const updated=await db.transaction(async q=>{
      const [row]=await q("SELECT id FROM pc_polls WHERE status='active' AND ends_ms<=$1 ORDER BY ends_ms,id LIMIT 1"+
        (db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
      if(!row)return false;
      await q("UPDATE pc_polls SET status='closed',revision=revision+1,updated_ms=$1,closed_ms=$1 WHERE id=$2",
        [now,row.id]);
      await q('UPDATE pc_poll_posts SET retry_ms=0 WHERE poll_id=$1',[row.id]);
      await q('INSERT INTO pc_poll_events(id,poll_id,actor_id,event,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(),row.id,'system','closed','Timed poll ended automatically.',now]);
      return true;
    });
    if(!updated)break;closed++;
  }
  return closed;
}
export async function votePoll(db:Store, pollId:string,userId:string,roles:string[],
  rawSelections:unknown,receipt:string,now=Date.now()){
  requireThat(pollIdPattern.test(pollId)&&discordId.test(userId),400,'Choose an eligible Discord poll/member.');
  requireThat(receiptPattern.test(receipt),400,'A unique ballot interaction receipt is required.');
  requireThat(Array.isArray(rawSelections)&&rawSelections.length>=1&&rawSelections.length<=10&&
    rawSelections.every((x:any)=>typeof x==='string'&&/^\d{1,2}$/.test(x)),
    400,'Choose valid poll answers.');
  const selections=[...new Set(rawSelections as string[])].map(Number).sort((a,b)=>a-b);
  requireThat(selections.length===(rawSelections as string[]).length,400,'Choose each answer only once.');
  const fingerprint=createHash('sha256').update(JSON.stringify([pollId,userId,selections])).digest('hex');
  requireThat(await communityEnabled(db,'polls'),403,'Poll voting is disabled by the Convergence Owner.');
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',[pollId+':'+userId]);
    const [duplicate]=await q('SELECT poll_id,voter_id,fingerprint FROM pc_poll_receipts WHERE receipt_id=$1',[receipt]);
    if(duplicate){
      requireThat(duplicate.poll_id===pollId&&duplicate.voter_id===userId&&duplicate.fingerprint===fingerprint,
        409,'A previous ballot receipt cannot be reused for different votes.');
      return {changed:false,replayed:true};
    }
    const [row]=await q('SELECT * FROM pc_polls WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[pollId]);
    requireThat(row&&row.status==='active'&&Number(row.ends_ms)>now,409,'This poll is not open for voting.');
    const options=parseArray(row.choices);
    requireThat(selections.every(n=>n>=0&&n<options.length),400,'Choose only published poll options.');
    requireThat(row.mode==='multiple'||selections.length===1,400,'This poll accepts one choice.');
    requireThat(!parseArray(row.excluded_roles).some(role=>roles.includes(role)),403,'Your roles are excluded from this poll.');
    const required=parseArray(row.required_roles);
    requireThat(!required.length||required.some(role=>roles.includes(role)),403,'A required poll participation role is missing.');
    const [previous]=await q('SELECT selections FROM pc_poll_votes WHERE poll_id=$1 AND voter_id=$2',[pollId,userId]);
    if(previous&&String(previous.selections)!==JSON.stringify(selections))
      requireThat(Number(row.allow_change)===1,409,'This poll does not allow changing an existing ballot.');
    await q('INSERT INTO pc_poll_receipts(receipt_id,poll_id,voter_id,fingerprint,created_ms) VALUES($1,$2,$3,$4,$5)',
      [receipt,pollId,userId,fingerprint,now]);
    if(previous&&String(previous.selections)===JSON.stringify(selections))return {changed:false,replayed:false};
    await q(`INSERT INTO pc_poll_votes(poll_id,voter_id,selections,updated_ms) VALUES($1,$2,$3,$4)
      ON CONFLICT(poll_id,voter_id) DO UPDATE SET selections=excluded.selections,updated_ms=excluded.updated_ms`,
      [pollId,userId,JSON.stringify(selections),now]);
    await q('UPDATE pc_polls SET revision=revision+1,updated_ms=$1 WHERE id=$2',[now,pollId]);
    await q('UPDATE pc_poll_posts SET retry_ms=$1 WHERE poll_id=$2',[now+3000,pollId]);
    return {changed:true,replayed:false};
  });
}
async function tally(q:Query,id:string,size:number){
  const votes=await q('SELECT selections FROM pc_poll_votes WHERE poll_id=$1',[id]);
  const counts=Array.from({length:size},()=>0);
  for(const vote of votes)for(const index of JSON.parse(String(vote.selections)) as number[])
    if(Number.isInteger(index)&&index>=0&&index<size)counts[index]++;
  return {voters:votes.length,counts};
}
export async function getPoll(db:Store,id:string,actor?:Actor){
  requireThat(pollIdPattern.test(id),400,'Choose a valid poll.');
  const [row]=await db.query(`SELECT p.*,o.message_id,o.last_error FROM pc_polls p
    LEFT JOIN pc_poll_posts o ON o.poll_id=p.id WHERE p.id=$1`,[id]);
  requireThat(row&&(row.status!=='draft'&&row.status!=='cancelled'||actor?.isOwner),
    404,'Poll is unavailable.');
  const poll=parseRow(row),totals=await tally(db.query,id,poll.choices.length);
  return {...poll,voters:totals.voters,counts:
    poll.resultsEarly||['closed','cancelled'].includes(poll.status)||actor?.isOwner?totals.counts:null};
}
export async function listPolls(db:Store,actor?:Actor,limit=50){
  const rows=await db.query(`SELECT p.id FROM pc_polls p WHERE $1=1 OR p.status IN ('active','closed')
    ORDER BY p.created_ms DESC,p.id DESC LIMIT $2`,[actor?.isOwner?1:0,Math.min(100,Math.max(1,limit))]);
  return Promise.all(rows.map(row=>getPoll(db,String(row.id),actor)));
}
export async function pollAudit(db:Store,actor:Actor,id:string){
  requireOwner(actor);requireThat(pollIdPattern.test(id),400,'Choose a poll.');
  return db.query('SELECT event,actor_id,detail,created_ms FROM pc_poll_events WHERE poll_id=$1 ORDER BY created_ms DESC,id DESC LIMIT 50',[id]);
}
export function pollMessage(poll:any,enabled=true){
  const counts=Array.isArray(poll.counts)?poll.counts:null;
  const total=Number(poll.voters||0);
  const lines=poll.choices.map((choice:string,i:number)=>{
    if(!counts)return '**'+(i+1)+'.** '+choice;
    const pct=total?Math.round(100*counts[i]/total):0;
    return '**'+(i+1)+'.** '+choice+' — '+counts[i]+' ('+pct+'%)';
  });
  const active=poll.status==='active'&&enabled&&poll.endsMs>Date.now();
  const embed:any={title:poll.question,description:
    (poll.description?poll.description+'\n\n':'')+lines.join('\n')+
    '\n\n'+(poll.anonymous?'Anonymous ballot · ':'')+
    (poll.mode==='multiple'?'Select one or more options.':'Choose one option.')+
    '\n'+(active?'Closes <t:'+Math.floor(poll.endsMs/1000)+':R>':poll.status==='closed'?'Poll closed':'Poll unavailable')+
    '\n'+total+' recorded ballot'+(total===1?'':'s')+
    (!counts?' · Results visible at close':''),color:poll.color,
    footer:{text:'PhoenixCore · Convergence polls · '+poll.id.slice(0,8)}};
  if(poll.imageUrl)embed.image={url:poll.imageUrl};
  const components=active?[{type:1,components:[{type:3,custom_id:'pcpoll:'+poll.id,
    placeholder:'Choose your ballot',min_values:1,max_values:poll.mode==='multiple'?Math.min(10,poll.choices.length):1,
    options:poll.choices.map((option:string,i:number)=>({label:option,value:String(i)}))}]}]:[];
  return {embeds:[embed],components,allowed_mentions:{parse:[]}};
}
export async function deliverPoll(db:Store,discord:Pick<Discord,'call'>,now=Date.now()){
  const token=randomUUID();
  const entry=await db.transaction(async q=>{
    const [row]=await q(`SELECT p.*,o.message_id,o.delivered_revision,o.retry_ms,o.lease_until
      FROM pc_polls p JOIN pc_poll_posts o ON o.poll_id=p.id
      WHERE p.status!='draft' AND p.revision>o.delivered_revision AND o.retry_ms<=$1 AND o.lease_until<=$1
      ORDER BY o.retry_ms,p.created_ms LIMIT 1`+(db.dialect==='postgres'?' FOR UPDATE OF o SKIP LOCKED':''),[now]);
    if(!row)return null;
    await q('UPDATE pc_poll_posts SET lease=$1,lease_until=$2 WHERE poll_id=$3',[token,now+45000,row.id]);
    return row;
  });
  if(!entry)return false;
  try{
    const status=String(entry.status),id=String(entry.id);
    const poll=await getPoll(db,id,{id:entry.creator_id,isOwner:true,isJudge:false,isPlayer:false});
    const enabled=await communityEnabled(db,'polls');
    const {embeds,components,allowed_mentions}=pollMessage(poll,enabled);
    const nonce=createHash('sha256').update('phoenixcore-poll:'+id).digest('base64url').slice(0,24);
    const endpoint='/channels/'+entry.channel_id+'/messages'+(entry.message_id?'/'+entry.message_id:'');
    const message=await discord.call(endpoint,{method:entry.message_id?'PATCH':'POST',
      body:JSON.stringify({embeds,components,allowed_mentions,
        ...(!entry.message_id?{nonce,enforce_nonce:true}:{})})});
    await db.query('UPDATE pc_poll_posts SET message_id=$1,delivered_revision=$2,retry_ms=0,lease=NULL,lease_until=0,last_error=NULL WHERE poll_id=$3 AND lease=$4',
      [String(message?.id||entry.message_id||''),Number(entry.revision),id,token]);
  }catch(error:any){
    const retry=error instanceof DiscordFailure?Math.max(error.retryMs||0,10000):10000;
    await db.query('UPDATE pc_poll_posts SET retry_ms=$1,lease=NULL,lease_until=0,last_error=$2 WHERE poll_id=$3 AND lease=$4',
      [now+Math.min(3600000,retry),error instanceof DiscordFailure?'Discord HTTP '+error.status:'Poll message delivery could not be confirmed.',entry.id,token]);
  }
  return true;
}
