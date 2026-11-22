import {randomUUID} from 'node:crypto';
import {requireThat,textValue} from './domain.ts';
import type {Store,Query} from './db.ts';

export const communityModules=['tags','suggestions','moderation','reminders','support','giveaways','roles','polls','schedules'] as const;
export const suggestionChannelId='1573908218260885614';
export type CommunityModule=typeof communityModules[number];
export type CommunityActor={id:string;isOwner:boolean;isStaff:boolean};
export const suggestionStatuses=['Pending','Under Review','Approved','Denied','Implemented'] as const;
export type SuggestionStatus=typeof suggestionStatuses[number];
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanName=(raw:unknown)=>{
  const name=String(raw??'').trim().toLowerCase();
  requireThat(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name),400,'Use a name of 1–40 lowercase letters, digits or hyphens.');
  return name;
};
const ensureStaff=(actor:CommunityActor)=>requireThat(actor.isStaff,403,'Only Owner, Admin or Helper may manage this content.');
export function communityActor(id:string,roles:string[],permissions:string|undefined,ownerId:string,helperRole:string):CommunityActor {
  const bits=String(permissions??'0');
  const admin=/^\d+$/.test(bits)&&(BigInt(bits)&8n)!==0n;
  const isOwner=id===ownerId;
  return {id,isOwner,isStaff:isOwner||admin||!!helperRole&&roles.includes(helperRole)};
}
export async function communityEnabled(db:Store,module:CommunityModule) {
  const [row]=await db.query('SELECT enabled FROM pc_community_modules WHERE module=$1',[module]);
  return row?Number(row.enabled)===1:true;
}
export async function communitySetModule(db:Store,actor:CommunityActor,module:CommunityModule,enabled:boolean){
  requireThat(actor.isOwner,403,'Only the owner can change community module switches.');
  requireThat(communityModules.includes(module),400,'Unknown module.');
  await db.transaction(async q=>{
    const [old]=await q('SELECT revision,enabled FROM pc_community_modules WHERE module=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[module]);
    await q('INSERT INTO pc_community_modules(module,enabled,revision,actor_id,updated_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT(module) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,actor_id=excluded.actor_id,updated_ms=excluded.updated_ms',
      [module,enabled?1:0,Number(old?.revision||0)+1,actor.id,Date.now()]);
    await q('INSERT INTO pc_community_module_history(module,revision,previous_enabled,enabled,actor_id,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [module,Number(old?.revision||0)+1,old?Number(old.enabled):null,enabled?1:0,actor.id,Date.now()]);
    if(module==='roles')await q('UPDATE pc_role_panels SET revision=revision+1,retry_ms=0');
    if(module==='polls'){
      await q("UPDATE pc_polls SET revision=revision+1 WHERE status='active'");
      await q("UPDATE pc_poll_posts SET retry_ms=0 WHERE poll_id IN (SELECT id FROM pc_polls WHERE status='active')");
    }
  });
  return enabled;
}
async function tagRecord(q:Query,raw:string){
  const name=cleanName(raw);
  const [row]=await q('SELECT t.* FROM pc_info_tags t LEFT JOIN pc_info_tag_aliases a ON a.tag_id=t.id WHERE (t.name=$1 OR a.alias=$1) AND t.active=1 LIMIT 1',[name]);
  return row;
}
async function storeTag(q:Query,db:Store,actor:CommunityActor,name:string,body:string){
  const [alias]=await q('SELECT tag_id FROM pc_info_tag_aliases WHERE alias=$1',[name]);
  requireThat(!alias,409,'That name is already in use by an alias.');
  const [old]=await q('SELECT * FROM pc_info_tags WHERE name=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[name]);
  const id=old?.id||randomUUID(),revision=Number(old?.revision||0)+1,now=Date.now();
  await q('INSERT INTO pc_info_tags(id,name,body,author_id,revision,active,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,1,$6,$6) ON CONFLICT(name) DO UPDATE SET body=excluded.body,author_id=excluded.author_id,revision=excluded.revision,active=1,updated_ms=excluded.updated_ms',
    [id,name,body,actor.id,revision,now]);
  await q('INSERT INTO pc_info_tag_history(tag_id,revision,body,actor_id,changed_ms) VALUES($1,$2,$3,$4,$5)',[id,revision,body,actor.id,now]);
  return {id,name,revision};
}
export async function saveTag(db:Store,actor:CommunityActor,name:string,body:string){
  ensureStaff(actor);return db.transaction(q=>storeTag(q,db,actor,cleanName(name),textValue(body,1600,'Tag content',true)));
}
export async function getTag(db:Store,name:string,context:{userId:string;channelId:string}){
  const row=await tagRecord(db.query,name);
  requireThat(row,404,'No published informational tag has that name.');
  const tokens:Record<string,string>={user:'<@'+context.userId+'>',channel:'<#'+context.channelId+'>',server:'Convergence: Phoenix Rising',date:new Date().toISOString().slice(0,10)};
  return {name:row.name,revision:Number(row.revision),text:String(row.body).replace(/\{(user|channel|server|date)\}/gi,(_,key)=>tokens[key.toLowerCase()])};
}
export async function listTags(db:Store,query=''){
  const q=String(query).trim().toLowerCase().slice(0,40);
  const rows=await db.query('SELECT name,body,revision FROM pc_info_tags WHERE active=1 ORDER BY name LIMIT 200');
  return rows.filter(r=>r.name.includes(q)||String(r.body).toLowerCase().includes(q)).slice(0,25).map(r=>({name:r.name,revision:Number(r.revision)}));
}
export async function tagAlias(db:Store,actor:CommunityActor,name:string,rawAlias:string){
  ensureStaff(actor);const alias=cleanName(rawAlias);
  return db.transaction(async q=>{
    const tag=await tagRecord(q,name);requireThat(tag,404,'Tag unavailable.');
    requireThat(tag.name!==alias,400,'Choose a different alias.');
    requireThat(!(await q('SELECT id FROM pc_info_tags WHERE name=$1',[alias])).length,409,'A tag already uses that name.');
    const [existing]=await q('SELECT tag_id FROM pc_info_tag_aliases WHERE alias=$1',[alias]);
    requireThat(!existing||existing.tag_id===tag.id,409,'Alias belongs to a different tag.');
    const inserted=await q('INSERT INTO pc_info_tag_aliases(alias,tag_id) VALUES($1,$2) ON CONFLICT(alias) DO NOTHING RETURNING alias',[alias,tag.id]);
    if(!inserted.length){const [winner]=await q('SELECT tag_id FROM pc_info_tag_aliases WHERE alias=$1',[alias]);requireThat(winner?.tag_id===tag.id,409,'Alias belongs to another tag.');}
    return tag.name;
  });
}
export async function tagHistory(db:Store,actor:CommunityActor,name:string){
  ensureStaff(actor);const tag=await tagRecord(db.query,name);requireThat(tag,404,'Tag unavailable.');
  return db.query('SELECT revision,actor_id,changed_ms FROM pc_info_tag_history WHERE tag_id=$1 ORDER BY revision DESC LIMIT 15',[tag.id]);
}
export async function tagRollback(db:Store,actor:CommunityActor,name:string,revision:number){
  ensureStaff(actor);const key=cleanName(name);
  requireThat(Number.isInteger(revision)&&revision>0,400,'Select a revision number.');
  return db.transaction(async q=>{
    const [tag]=await q('SELECT * FROM pc_info_tags WHERE name=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[key]);
    requireThat(tag,404,'Tag unavailable.');
    const [snapshot]=await q('SELECT body FROM pc_info_tag_history WHERE tag_id=$1 AND revision=$2',[tag.id,revision]);
    requireThat(snapshot,404,'Revision unavailable.');
    const next=Number(tag.revision)+1,now=Date.now();
    await q('UPDATE pc_info_tags SET body=$1,revision=$2,author_id=$3,active=1,updated_ms=$4 WHERE id=$5',[snapshot.body,next,actor.id,now,tag.id]);
    await q('INSERT INTO pc_info_tag_history(tag_id,revision,body,actor_id,changed_ms) VALUES($1,$2,$3,$4,$5)',[tag.id,next,snapshot.body,actor.id,now]);
    return {name:key,revision:next};
  });
}
export async function proposeTag(db:Store,actor:CommunityActor,name:string,body:string){
  const id=randomUUID();
  await db.query('INSERT INTO pc_info_tag_proposals(id,author_id,name,body,status,created_ms) VALUES($1,$2,$3,$4,$5,$6)',
    [id,actor.id,cleanName(name),textValue(body,1600,'Proposal',true),'pending',Date.now()]);
  return id;
}
export async function pendingTagProposals(db:Store,actor:CommunityActor){
  ensureStaff(actor);
  return db.query("SELECT id,name,body,author_id FROM pc_info_tag_proposals WHERE status='pending' ORDER BY created_ms DESC LIMIT 15");
}
export async function reviewTag(db:Store,actor:CommunityActor,id:string,decision:'approve'|'decline',note=''){
  ensureStaff(actor);
  requireThat(idPattern.test(id),400,'Invalid proposal ID.');
  requireThat(['approve','decline'].includes(decision),400,'Choose approve or decline.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_info_tag_proposals WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Proposal unavailable.');
    requireThat(row.status==='pending',409,'Already reviewed.');
    const published=decision==='approve'?await storeTag(q,db,actor,row.name,row.body):null;
    await q('UPDATE pc_info_tag_proposals SET status=$1,decided_by=$2,decided_ms=$3,note=$4 WHERE id=$5',
      [decision==='approve'?'approved':'declined',actor.id,Date.now(),textValue(note,500,'Note'),id]);
    return {decision,published};
  });
}
export async function createSuggestion(db:Store,actor:CommunityActor,heading:string,body:string,anonymous:boolean){
  const id=randomUUID(),now=Date.now();
  await db.transaction(async q=>{
    await q('INSERT INTO pc_suggestions(id,author_id,title,body,anonymous,status,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',
      [id,actor.id,textValue(heading,120,'Title',true),textValue(body,1800,'Suggestion',true),anonymous?1:0,'Pending',now]);
    await q('INSERT INTO pc_suggestion_history(suggestion_id,revision,event,actor_id,detail,occurred_ms) VALUES($1,1,$2,$3,$4,$5)',
      [id,'created',actor.id,'',now]);
    await q('INSERT INTO pc_suggestion_posts(suggestion_id,channel_id) VALUES($1,$2)',[id,suggestionChannelId]);
  });
  return id;
}
export async function getSuggestion(db:Store,id:string,includeRemoved=false){
  requireThat(idPattern.test(id),400,'Invalid suggestion ID.');
  const [row]=await db.query('SELECT s.*,COALESCE(SUM(CASE WHEN v.choice=1 THEN 1 ELSE 0 END),0) AS upvotes,COALESCE(SUM(CASE WHEN v.choice=-1 THEN 1 ELSE 0 END),0) AS downvotes FROM pc_suggestions s LEFT JOIN pc_suggestion_votes v ON v.suggestion_id=s.id WHERE s.id=$1 GROUP BY s.id',[id]);
  requireThat(row,404,'Suggestion unavailable.');
  if(!includeRemoved){const [removed]=await db.query('SELECT suggestion_id FROM pc_suggestion_removals WHERE suggestion_id=$1',[id]);requireThat(!removed,404,'This suggestion has been removed.');}
  return row;
}
export async function listSuggestions(db:Store,includeRemoved=false){
  return db.query("SELECT s.id,s.title,s.body,s.staff_response,s.anonymous,s.status,s.created_ms, r.removed_ms, COALESCE(SUM(CASE WHEN v.choice=1 THEN 1 ELSE 0 END),0) AS upvotes,COALESCE(SUM(CASE WHEN v.choice=-1 THEN 1 ELSE 0 END),0) AS downvotes FROM pc_suggestions s LEFT JOIN pc_suggestion_votes v ON v.suggestion_id=s.id LEFT JOIN pc_suggestion_removals r ON r.suggestion_id=s.id "+(includeRemoved?'':"WHERE r.suggestion_id IS NULL ")+"GROUP BY s.id,r.removed_ms ORDER BY s.created_ms DESC LIMIT 40");
}
export async function voteSuggestion(db:Store,actor:CommunityActor,id:string,choice:number){
  requireThat(idPattern.test(id),400,'Invalid suggestion ID.');
  requireThat([-1,0,1].includes(choice),400,'Choose upvote, downvote or remove.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT status FROM pc_suggestions WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Suggestion unavailable.');
    requireThat(!(await q('SELECT suggestion_id FROM pc_suggestion_removals WHERE suggestion_id=$1',[id])).length,404,'This suggestion has been removed.');
    requireThat(!['Denied','Implemented'].includes(row.status),409,'Voting is closed.');
    if(choice===0)await q('DELETE FROM pc_suggestion_votes WHERE suggestion_id=$1 AND voter_id=$2',[id,actor.id]);
    else await q('INSERT INTO pc_suggestion_votes(suggestion_id,voter_id,choice,updated_ms) VALUES($1,$2,$3,$4) ON CONFLICT(suggestion_id,voter_id) DO UPDATE SET choice=excluded.choice,updated_ms=excluded.updated_ms',[id,actor.id,choice,Date.now()]);
    await q('UPDATE pc_suggestion_posts SET revision=revision+1,retry_at=0 WHERE suggestion_id=$1',[id]);
    return true;
  });
}
export async function reviewSuggestion(db:Store,actor:CommunityActor,id:string,status:SuggestionStatus,response=''){
  ensureStaff(actor);
  requireThat(idPattern.test(id),400,'Invalid suggestion ID.');
  requireThat((suggestionStatuses as readonly string[]).includes(status),400,'Unknown suggestion status.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_suggestions WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Suggestion unavailable.');
    requireThat(!(await q('SELECT suggestion_id FROM pc_suggestion_removals WHERE suggestion_id=$1',[id])).length,404,'This suggestion has been removed.');
    const answer=textValue(response,950,'Staff response'),now=Date.now();
    if(row.status===status&&row.staff_response===answer)return {status,anonymous:Number(row.anonymous)===1,authorId:row.author_id};
    await q('UPDATE pc_suggestions SET status=$1,staff_response=$2,reviewed_by=$3,updated_ms=$4 WHERE id=$5',[status,answer,actor.id,now,id]);
    const [last]=await q('SELECT COALESCE(MAX(revision),0)+1 AS next FROM pc_suggestion_history WHERE suggestion_id=$1',[id]);
    await q('INSERT INTO pc_suggestion_history(suggestion_id,revision,event,actor_id,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [id,Number(last.next),'status:'+status,actor.id,answer,now]);
    await q('INSERT INTO pc_community_notifications(id,suggestion_id,user_id,payload,status,not_before) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
      ['suggestion:'+id+':'+Number(last.next),id,row.author_id,JSON.stringify({title:row.title,status,response:answer}), 'pending', now]);
    await q('UPDATE pc_suggestion_posts SET revision=revision+1,retry_at=0 WHERE suggestion_id=$1',[id]);
    return {status,anonymous:Number(row.anonymous)===1,authorId:row.author_id};
  });
}

export async function removeSuggestion(db:Store,actor:CommunityActor,id:string,reason=''){
  requireThat(actor.isOwner,403,'Only the server owner may remove suggestions.');
  requireThat(idPattern.test(id),400,'Invalid suggestion ID.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT id FROM pc_suggestions WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Suggestion unavailable.');
    const inserted=await q('INSERT INTO pc_suggestion_removals(suggestion_id,removed_by,removed_ms,reason) VALUES($1,$2,$3,$4) ON CONFLICT(suggestion_id) DO NOTHING RETURNING suggestion_id',
      [id,actor.id,Date.now(),textValue(reason,300,'Removal reason')]);
    if(!inserted.length)return false;
    const [last]=await q('SELECT COALESCE(MAX(revision),0)+1 AS next FROM pc_suggestion_history WHERE suggestion_id=$1',[id]);
    await q('INSERT INTO pc_suggestion_history(suggestion_id,revision,event,actor_id,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [id,Number(last.next),'removed',actor.id,textValue(reason,300,'Removal reason'),Date.now()]);
    await q('UPDATE pc_suggestion_posts SET revision=revision+1,retry_at=0 WHERE suggestion_id=$1',[id]);
    await q("UPDATE pc_community_notifications SET status='suppressed' WHERE suggestion_id=$1 AND status='pending'",[id]);
    return true;
  });
}
export async function restoreSuggestion(db:Store,actor:CommunityActor,id:string){
  requireThat(actor.isOwner,403,'Only the server owner may restore suggestions.');
  requireThat(idPattern.test(id),400,'Invalid suggestion ID.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT id FROM pc_suggestions WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Suggestion unavailable.');
    const restored=await q('DELETE FROM pc_suggestion_removals WHERE suggestion_id=$1 RETURNING suggestion_id',[id]);
    if(!restored.length)return false;
    const [last]=await q('SELECT COALESCE(MAX(revision),0)+1 AS next FROM pc_suggestion_history WHERE suggestion_id=$1',[id]);
    await q('INSERT INTO pc_suggestion_history(suggestion_id,revision,event,actor_id,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [id,Number(last.next),'restored',actor.id,'',Date.now()]);
    await q('UPDATE pc_suggestion_posts SET revision=revision+1,retry_at=0 WHERE suggestion_id=$1',[id]);
    return true;
  });
}
export async function suggestionPost(db:Store,id:string){
  const [row]=await db.query('SELECT channel_id,message_id,revision,delivered_revision FROM pc_suggestion_posts WHERE suggestion_id=$1',[id]);
  return row||null;
}

export function suggestionDisplay(row:any){
  const author=Number(row.anonymous)===1?'Anonymous':'<@'+row.author_id+'>';
  return {embeds:[{title:'Suggestion · '+row.title,description:row.body,color:0x7566c9,
    fields:[{name:'Status',value:row.status,inline:true},{name:'Votes',value:'👍 '+Number(row.upvotes)+' · 👎 '+Number(row.downvotes),inline:true},
      {name:'Submitted by',value:author},...(row.staff_response?[{name:'Staff response',value:String(row.staff_response).slice(0,950)}]:[])],
    footer:{text:'PhoenixCore suggestion '+row.id}}],
    components:[{type:1,components:[
      {type:2,style:3,label:'Upvote',custom_id:'pcs:vote:'+row.id+':up',disabled:['Denied','Implemented'].includes(row.status)},
      {type:2,style:4,label:'Downvote',custom_id:'pcs:vote:'+row.id+':down',disabled:['Denied','Implemented'].includes(row.status)},
      {type:2,style:2,label:'Remove vote',custom_id:'pcs:vote:'+row.id+':remove',disabled:['Denied','Implemented'].includes(row.status)}]}],
    allowed_mentions:{parse:[]}};
}
