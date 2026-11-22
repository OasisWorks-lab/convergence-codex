import {randomUUID} from 'node:crypto';
import {requireThat,textValue,discordId} from './domain.ts';
import type {Store,Query} from './db.ts';
import type {StaffIdentity} from './staff.ts';

export const supportKinds=['ticket','modmail','report','appeal'] as const;
export const supportStates=['Open','Claimed','Waiting for Member','Waiting for Staff','Resolved','Closed'] as const;
export type SupportKind=typeof supportKinds[number];
export type SupportState=typeof supportStates[number];
export const supportIdleMs=4*60*60*1000;
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const receipt=/^[\w:-]{8,130}$/;
export type SupportInput={receipt:string;actorId:string;requesterId:string;kind:SupportKind;message:string;sensitive?:boolean;anonymous?:boolean;linkedModCaseId?:string;assigneeId?:string;staffOpened?:boolean};
const allowStaff=(actor:StaffIdentity,record:any)=>{
  requireThat(actor.isHelper,403,'Only authorized Convergence support staff may perform this action.');
  requireThat(!Number(record.sensitive)||actor.isOwner,403,'This case is restricted to the server Owner.');
};
export function assertCaseAccess(actor:StaffIdentity,record:any){
  if(actor.id===record.requester_id)return 'member' as const;
  allowStaff(actor,record);
  return 'staff' as const;
}
const validCase=(id:string)=>requireThat(uuid.test(id),400,'Invalid SupportCase ID.');
async function addEvent(q:Query,caseId:string,receiptId:string,actorId:string,eventType:string,visibility:'member'|'staff'|'owner',body:string,now:number){
  const id=randomUUID();
  const inserted=await q('INSERT INTO pc_support_events(id,receipt_id,case_id,actor_id,event_type,visibility,body,occurred_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(receipt_id) DO NOTHING RETURNING id',
    [id,receiptId,caseId,actorId,eventType,visibility,body,now]);
  return inserted[0]?.id||null;
}
export async function eligibleAssignee(db:Store,ids:string[],sensitive=false){
  const candidates=[...new Set(ids)].filter(id=>discordId.test(id));
  if(!candidates.length)return null;
  const load=await db.query("SELECT assigned_id,COUNT(*) AS total FROM pc_support_cases WHERE assigned_id IS NOT NULL AND status NOT IN ('Resolved','Closed') GROUP BY assigned_id");
  const counts=new Map(load.map(r=>[r.assigned_id,Number(r.total)]));
  return candidates.sort((a,b)=>(counts.get(a)||0)-(counts.get(b)||0)||a.localeCompare(b))[0]||null;
}
export async function createSupportCase(db:Store,input:SupportInput,now=Date.now()){
  requireThat(receipt.test(input.receipt),400,'Each case requires a unique request receipt.');
  requireThat(discordId.test(input.actorId)&&discordId.test(input.requesterId),400,'Discord account IDs are required.');
  requireThat(supportKinds.includes(input.kind),400,'Invalid SupportCase kind.');
  requireThat(input.actorId===input.requesterId||input.staffOpened,403,'Staff approval is required to open a case for another member.');
  const content=textValue(input.message,2200,'Support question',true);
  requireThat(!input.sensitive||input.staffOpened,403,'Only the server Owner may initiate a sensitive case.');
  if(input.linkedModCaseId)requireThat(uuid.test(input.linkedModCaseId),400,'Invalid linked moderation case.');
  return db.transaction(async q=>{
    const [existing]=await q('SELECT id,requester_id,kind FROM pc_support_cases WHERE receipt_id=$1',[input.receipt]);
    if(existing){
      requireThat(existing.requester_id===input.requesterId&&existing.kind===input.kind,409,'Receipt belongs to a different SupportCase.');
      return {id:existing.id,created:false};
    }
    if(!input.staffOpened&&input.kind!=='appeal'){
      const [block]=await q('SELECT active FROM pc_support_blocks WHERE user_id=$1',[input.requesterId]);
      requireThat(!block||Number(block.active)!==1,403,'Support intake is currently restricted for this account; contact the Owner about an appeal.');
    }
    if(input.kind==='appeal'&&input.linkedModCaseId){
      const [record]=await q('SELECT target_id FROM pc_mod_cases WHERE id=$1',[input.linkedModCaseId]);
      requireThat(record&&record.target_id===input.requesterId,403,'Appeal must reference your own moderation case.');
    }
    const [recent]=await q('SELECT COUNT(*) AS count FROM pc_support_cases WHERE requester_id=$1 AND created_ms>$2',
      [input.requesterId,now-15000]);
    requireThat(Number(recent.count)<3||input.staffOpened,429,'Please avoid submitting several cases at once.');
    const id=randomUUID(),assigned=input.assigneeId||null,state=assigned?'Claimed':'Open';
    await q('INSERT INTO pc_support_cases(id,receipt_id,kind,requester_id,status,sensitive,anonymous,summary,assigned_id,linked_mod_case_id,created_ms,updated_ms,activity_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11)',
      [id,input.receipt,input.kind,input.requesterId,state,input.sensitive?1:0,input.anonymous?1:0,content.slice(0,130),assigned,input.linkedModCaseId||null,now]);
    await addEvent(q,id,'initial:'+input.receipt,input.actorId,'opened','member',content,now);
    if(assigned)await addEvent(q,id,'assigned:'+input.receipt,assigned,'assigned','staff','Auto-assigned to an eligible support member.',now);
    await q('INSERT INTO pc_support_idle(case_id,due_ms) VALUES($1,$2)',[id,now+supportIdleMs]);
    return {id,created:true};
  });
}
export async function getSupportCase(db:Store,id:string){
  validCase(id);
  const [record]=await db.query('SELECT * FROM pc_support_cases WHERE id=$1',[id]);
  requireThat(record,404,'SupportCase not found.');
  return record;
}
export async function listSupportCases(db:Store,actor:StaffIdentity,limit=75){
  const rows=await db.query('SELECT * FROM pc_support_cases ORDER BY updated_ms DESC,id DESC LIMIT 500');
  return rows.filter(r=>r.requester_id===actor.id||actor.isOwner||actor.isHelper&&!Number(r.sensitive)).slice(0,Math.min(100,Math.max(1,limit)))
    .map(r=>publicCase(r,actor));
}
export function publicCase(r:any,actor:StaffIdentity){
  const viewer=assertCaseAccess(actor,r);
  return {id:r.id,kind:r.kind,status:r.status,summary:r.summary,requesterId:
    viewer==='staff'&&Number(r.anonymous)&&!actor.isAdmin?null:r.requester_id,
    sensitive:Number(r.sensitive)===1,anonymous:Number(r.anonymous)===1,
    assignedId:r.assigned_id,createdMs:Number(r.created_ms),updatedMs:Number(r.updated_ms),
    closedMs:r.closed_ms?Number(r.closed_ms):null,revision:Number(r.revision),isStaff:viewer==='staff'};
}
export async function supportHistory(db:Store,actor:StaffIdentity,id:string){
  const c=await getSupportCase(db,id),viewer=assertCaseAccess(actor,c);
  const events=await db.query('SELECT * FROM pc_support_events WHERE case_id=$1 ORDER BY occurred_ms,id',[id]);
  return {case:publicCase(c,actor),events:events.filter(e=>viewer==='staff'||e.visibility==='member')
    .map(e=>({id:e.id,type:e.event_type,text:e.body,createdMs:Number(e.occurred_ms),
      authorId:viewer==='member'&&e.event_type.startsWith('staff')?
        (e.event_type==='staff-signed-reply'?e.actor_id:null):e.actor_id,
      visibility:e.visibility}))};
}
export async function addSupportMessage(db:Store,actor:StaffIdentity,caseId:string,receiptId:string,text:string,mode:'member'|'staff-reply'|'staff-signed-reply'|'staff-note',now=Date.now()){
  validCase(caseId);requireThat(receipt.test(receiptId),400,'Missing unique message receipt.');
  const body=textValue(text,1900,'Support message',true);
  return db.transaction(async q=>{
    const [record]=await q('SELECT * FROM pc_support_cases WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[caseId]);
    requireThat(record,404,'SupportCase not found.');
    const viewer=assertCaseAccess(actor,record);
    if(mode==='member')requireThat(actor.id===record.requester_id,403,'Only the requester can send a member message.');
    else requireThat(viewer==='staff',403,'Only authorized support staff can issue staff replies or private notes.');
    requireThat(!['Resolved','Closed'].includes(record.status),409,'Staff must reopen this case before further messages.');
    const visibility=mode==='staff-note'?'staff':'member';
    const eventId=await addEvent(q,caseId,receiptId,actor.id,mode,visibility,body,now);
    if(!eventId)return {created:false,caseId};
    if(mode==='staff-reply'||mode==='staff-signed-reply')
      await q('INSERT INTO pc_support_outbox(event_id,recipient_id) VALUES($1,$2)',[eventId,record.requester_id]);
    if(mode!=='staff-note'){
      const state=mode==='member'?'Waiting for Staff':'Waiting for Member';
      await q('UPDATE pc_support_cases SET status=$1,updated_ms=$2,activity_ms=$2,revision=revision+1 WHERE id=$3',[state,now,caseId]);
      await q('INSERT INTO pc_support_idle(case_id,due_ms,lease_until) VALUES($1,$2,0) ON CONFLICT(case_id) DO UPDATE SET due_ms=excluded.due_ms,lease=NULL,lease_until=0',[caseId,now+supportIdleMs]);
    }else await q('UPDATE pc_support_cases SET updated_ms=$1,revision=revision+1 WHERE id=$2',[now,caseId]);
    return {created:true,caseId,eventId};
  });
}
export async function transitionSupport(db:Store,actor:StaffIdentity,caseId:string,action:'claim'|'transfer'|'resolve'|'close'|'reopen'|'sensitive',newAssignee?:string,reason='',now=Date.now()){
  validCase(caseId);
  return db.transaction(async q=>{
    const [c]=await q('SELECT * FROM pc_support_cases WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[caseId]);
    requireThat(c,404,'SupportCase not found.');
    allowStaff(actor,c);
    let status=c.status,assigned=c.assigned_id,sensitive=Number(c.sensitive),closed=c.closed_ms,closeReason=c.close_reason;
    let activity=Number(c.activity_ms);
    const explanation=textValue(reason,500,'Transition reason');
    if(action==='claim'){
      requireThat(!['Closed','Resolved'].includes(status),409,'Reopen the case before claiming it.');
      assigned=actor.id;status='Claimed';
    }else if(action==='transfer'){
      requireThat(!['Closed','Resolved'].includes(status),409,'Reopen the case before transferring.');
      requireThat(discordId.test(newAssignee||''),400,'Select an eligible verified staff member.');
      assigned=newAssignee;status='Claimed';
    }else if(action==='sensitive'){
      requireThat(actor.isOwner,403,'Only the Owner can restrict case visibility.');
      sensitive=1;assigned=actor.id;
    }else if(action==='resolve'||action==='close'){
      status=action==='resolve'?'Resolved':'Closed';closed=now;closeReason=explanation;
    }else if(action==='reopen'){
      requireThat(['Resolved','Closed'].includes(status),409,'This case is already active.');
      status='Open';closed=null;closeReason='';activity=now;
    }else requireThat(false,400,'Unsupported case transition.');
    await q('UPDATE pc_support_cases SET status=$1,assigned_id=$2,sensitive=$3,closed_ms=$4,close_reason=$5,updated_ms=$6,activity_ms=$7,revision=revision+1 WHERE id=$8',
      [status,assigned,sensitive,closed,closeReason,now,activity,caseId]);
    await addEvent(q,caseId,'transition:'+randomUUID(),actor.id,'staff-'+action,'staff',
      action==='transfer'?'Transferred to '+newAssignee:explanation||action,now);
    if(['Closed','Resolved'].includes(status))await q('DELETE FROM pc_support_idle WHERE case_id=$1',[caseId]);
    else await q('INSERT INTO pc_support_idle(case_id,due_ms,lease_until) VALUES($1,$2,0) ON CONFLICT(case_id) DO UPDATE SET due_ms=excluded.due_ms,lease=NULL,lease_until=0',
      [caseId,activity+supportIdleMs]);
    return {caseId,status};
  });
}
export async function blockSupportMember(db:Store,actor:StaffIdentity,userId:string,blocked:boolean,reason=''){
  requireThat(actor.isHelper,403,'Only support staff can manage support intake blocks.');
  requireThat(discordId.test(userId),400,'Select a Discord member.');
  const content=textValue(reason,350,'Block reason');
  await db.query('INSERT INTO pc_support_blocks(user_id,actor_id,reason,created_ms,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET actor_id=excluded.actor_id,reason=excluded.reason,created_ms=excluded.created_ms,active=excluded.active',
    [userId,actor.id,content,Date.now(),blocked?1:0]);
}
export async function supportAnalytics(db:Store,actor:StaffIdentity){
  requireThat(actor.isHelper,403,'Only support staff may view internal caseload analytics.');
  const data=await db.query('SELECT status,sensitive,assigned_id,created_ms,closed_ms FROM pc_support_cases');
  const eligible=data.filter(c=>actor.isOwner||!Number(c.sensitive));
  return {total:eligible.length,open:eligible.filter(c=>!['Closed','Resolved'].includes(c.status)).length,
    resolved:eligible.filter(c=>['Closed','Resolved'].includes(c.status)).length,
    byStatus:Object.fromEntries(supportStates.map(status=>[status,eligible.filter(c=>c.status===status).length])),
    assignees:Object.entries(eligible.reduce((acc:Record<string,number>,c)=>{if(c.assigned_id)acc[c.assigned_id]=(acc[c.assigned_id]||0)+1;return acc;},{}))};
}
