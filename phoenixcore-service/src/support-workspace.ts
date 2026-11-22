import {randomUUID} from 'node:crypto';
import {requireThat,textValue,discordId} from './domain.ts';
import type {Store,Query} from './db.ts';
import type {StaffIdentity} from './staff.ts';
import {getSupportCase,publicCase,assertCaseAccess,supportKinds,supportStates} from './support.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tag=/^[a-z][a-z0-9-]{1,39}$/;
const staffOnly=(actor:StaffIdentity)=>requireThat(actor.isHelper,403,'Only authorized Convergence support staff may use this workspace.');
const templateVersion=(r:any)=>({
  id:r.id,name:r.name,body:r.body,revision:Number(r.revision),
  active:Number(r.active)===1,creatorId:r.creator_id,updatedMs:Number(r.updated_ms)
});

export type SupportFilters={query?:string;kind?:string;status?:string;assignedId?:string;page?:number;pageSize?:number};
export async function searchSupportCases(db:Store,actor:StaffIdentity,input:SupportFilters={}){
  requireThat(input&&typeof input==='object',400,'Invalid search filters.');
  const query=textValue(input.query||'',120,'Search text').toLowerCase();
  const kind=String(input.kind||''),status=String(input.status||''),assigned=String(input.assignedId||'');
  requireThat(!kind||supportKinds.includes(kind as any),400,'Unknown support case type.');
  requireThat(!status||supportStates.includes(status as any),400,'Unknown support case status.');
  requireThat(!assigned||actor.isHelper&&discordId.test(assigned),403,'Only staff may filter by assigned staff member.');
  const page=input.page===undefined?1:Number(input.page),
    pageSize=input.pageSize===undefined?25:Number(input.pageSize);
  requireThat(Number.isSafeInteger(page)&&page>=1&&page<=100000,400,'Choose a valid result page.');
  requireThat(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50,400,'Choose 1–50 cases per page.');
  const args:Array<string|number|null>=[];
  const bind=(value:string|number)=>{args.push(value);return '$'+args.length;};
  const clauses:string[]=[];
  if(!actor.isOwner)clauses.push(actor.isHelper?
    '(c.sensitive=0 OR c.requester_id='+bind(actor.id)+')':
    'c.requester_id='+bind(actor.id));
  if(kind)clauses.push('c.kind='+bind(kind));
  if(status)clauses.push('c.status='+bind(status));
  if(assigned)clauses.push('c.assigned_id='+bind(assigned));
  if(query){
    const literal='%'+query.replace(/[\\%_]/g,c=>'\\'+c)+'%';
    const term=bind(literal);
    const ownerEvent=bind(actor.id);
    const visibleEvent=actor.isHelper?
      "(e.visibility='member' OR (c.requester_id<>"+ownerEvent+
        (actor.isOwner?" AND e.visibility IN ('staff','owner')":" AND c.sensitive=0 AND e.visibility IN ('staff','owner')")+"))":
      "e.visibility='member'";
    clauses.push('(LOWER(c.summary) LIKE '+term+" ESCAPE '\\' OR EXISTS ("+
      'SELECT 1 FROM pc_support_events e WHERE e.case_id=c.id AND '+
      visibleEvent+' AND LOWER(e.body) LIKE '+term+" ESCAPE '\\'))");
  }
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const [totalRow]=await db.query('SELECT COUNT(*) AS total FROM pc_support_cases c'+where,args);
  const total=Number(totalRow.total),offset=(page-1)*pageSize;
  const rows=await db.query('SELECT c.* FROM pc_support_cases c'+where+
    ' ORDER BY c.updated_ms DESC,c.id DESC LIMIT '+bind(pageSize)+' OFFSET '+bind(offset),args);
  return {page,pageSize,total,pages:Math.max(1,Math.ceil(total/pageSize)),
    filters:{query,kind,status,assignedId:assigned},
    cases:rows.map(row=>publicCase(row,actor))};
}
export async function listSupportTemplates(db:Store,actor:StaffIdentity){
  staffOnly(actor);
  const rows=await db.query('SELECT * FROM pc_support_templates ORDER BY active DESC,name ASC,id LIMIT 500');
  return rows.map(templateVersion);
}
export async function saveSupportTemplate(db:Store,actor:StaffIdentity,input:any){
  staffOnly(actor);
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),400,'Provide saved reply details.');
  const name=textValue(input.name,40,'Saved reply name',true).toLowerCase(),
    body=textValue(input.body,1800,'Saved reply body',true);
  requireThat(tag.test(name),400,'Use 2–40 lowercase letters, numbers or hyphens for a saved reply name.');
  const now=Date.now(),id=input.id?String(input.id):randomUUID();
  requireThat(uuid.test(id),400,'Invalid saved reply ID.');
  return db.transaction(async q=>{
    const [existing]=await q('SELECT * FROM pc_support_templates WHERE id=$1'+
      (db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    const [collision]=await q('SELECT id FROM pc_support_templates WHERE name=$1',[name]);
    requireThat(!collision||collision.id===id,409,'Another saved reply already uses that name.');
    if(!existing){
      requireThat(!input.id,404,'Saved reply not found.');
      const rows=await q('INSERT INTO pc_support_templates(id,name,body,creator_id,revision,updated_ms,active) VALUES($1,$2,$3,$4,1,$5,1) ON CONFLICT(name) DO NOTHING RETURNING id',
        [id,name,body,actor.id,now]);
      requireThat(rows.length===1,409,'Another saved reply already uses that name.');
    }else{
      requireThat(Number.isSafeInteger(input.revision)&&Number(input.revision)===Number(existing.revision),409,
        'Saved reply changed. Refresh before editing.');
      await q('UPDATE pc_support_templates SET name=$1,body=$2,revision=revision+1,active=1,updated_ms=$3 WHERE id=$4',
        [name,body,now,id]);
    }
    const revision=existing?Number(existing.revision)+1:1;
    await q('INSERT INTO pc_support_template_history(template_id,revision,name,body,active,actor_id,changed_ms) VALUES($1,$2,$3,$4,1,$5,$6)',
      [id,revision,name,body,actor.id,now]);
    return {id,name,revision,active:true};
  });
}
export async function archiveSupportTemplate(db:Store,actor:StaffIdentity,id:string,expected:number){
  staffOnly(actor);requireThat(uuid.test(id),400,'Invalid saved reply ID.');
  return db.transaction(async q=>{
    const [record]=await q('SELECT * FROM pc_support_templates WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(record,404,'Saved reply not found.');
    requireThat(Number.isSafeInteger(expected)&&Number(record.revision)===expected,409,'Refresh before archiving this saved reply.');
    requireThat(Number(record.active)===1,409,'Saved reply is already archived.');
    const now=Date.now(),revision=expected+1;
    await q('UPDATE pc_support_templates SET active=0,revision=$1,updated_ms=$2 WHERE id=$3',[revision,now,id]);
    await q('INSERT INTO pc_support_template_history(template_id,revision,name,body,active,actor_id,changed_ms) VALUES($1,$2,$3,$4,0,$5,$6)',
      [id,revision,record.name,record.body,actor.id,now]);
    return {id,revision,active:false};
  });
}
export async function supportTemplateHistory(db:Store,actor:StaffIdentity,id:string){
  staffOnly(actor);requireThat(uuid.test(id),400,'Invalid saved reply ID.');
  const [record]=await db.query('SELECT id FROM pc_support_templates WHERE id=$1',[id]);
  requireThat(record,404,'Saved reply not found.');
  const rows=await db.query('SELECT revision,name,body,active,actor_id,changed_ms FROM pc_support_template_history WHERE template_id=$1 ORDER BY revision DESC LIMIT 50',[id]);
  return rows.map(r=>({revision:Number(r.revision),name:r.name,body:r.body,active:Number(r.active)===1,
    actorId:r.actor_id,changedMs:Number(r.changed_ms)}));
}
export async function previewSupportTemplate(db:Store,actor:StaffIdentity,id:string,caseId:string){
  staffOnly(actor);requireThat(uuid.test(id),400,'Invalid saved reply ID.');
  const record=await getSupportCase(db,caseId);
  requireThat(assertCaseAccess(actor,record)==='staff',403,'Only case staff can prepare an outward reply.');
  const [template]=await db.query('SELECT body,active FROM pc_support_templates WHERE id=$1',[id]);
  requireThat(template&&Number(template.active)===1,404,'Saved reply is no longer available.');
  return String(template.body).replace(/\{\{(case|member|staff)\}\}/g,(_,key)=>
    ({case:record.id,member:'<@'+record.requester_id+'>',staff:'Convergence Staff'} as Record<string,string>)[key]);
}
export async function supportCaseFeedback(db:Store,actor:StaffIdentity,caseId:string){
  const c=await getSupportCase(db,caseId),viewer=assertCaseAccess(actor,c);
  const [entry]=await db.query('SELECT rating,comment,created_ms FROM pc_support_feedback WHERE case_id=$1',[caseId]);
  return {caseId,closed:['Resolved','Closed'].includes(c.status),
    maySubmit:viewer==='member'&&['Resolved','Closed'].includes(c.status)&&!entry,
    feedback:entry?{rating:Number(entry.rating),comment:entry.comment,createdMs:Number(entry.created_ms)}:null};
}
export async function submitSupportFeedback(db:Store,actor:StaffIdentity,caseId:string,input:any,now=Date.now()){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),400,'Provide optional case feedback.');
  requireThat(Number.isSafeInteger(input.rating)&&input.rating>=1&&input.rating<=5,400,'Choose a rating from 1–5.');
  const comment=textValue(input.comment||'',500,'Feedback comment');
  return db.transaction(async q=>{
    const [record]=await q('SELECT * FROM pc_support_cases WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[caseId]);
    requireThat(record,404,'SupportCase not found.');
    requireThat(record.requester_id===actor.id,403,'Only the member who opened the case can submit feedback.');
    requireThat(['Closed','Resolved'].includes(record.status),409,'Feedback is available once the case is resolved or closed.');
    const [previous]=await q('SELECT case_id FROM pc_support_feedback WHERE case_id=$1',[caseId]);
    requireThat(!previous,409,'Feedback was already submitted for this SupportCase.');
    await q('INSERT INTO pc_support_feedback(case_id,requester_id,rating,comment,created_ms) VALUES($1,$2,$3,$4,$5)',
      [caseId,actor.id,input.rating,comment,now]);
    return {caseId,recorded:true};
  });
}
export async function supportInsights(db:Store,actor:StaffIdentity,now=Date.now()){
  staffOnly(actor);
  const cases=(await db.query('SELECT * FROM pc_support_cases')).filter(c=>
    actor.isOwner||!Number(c.sensitive));
  const ids=new Set(cases.map(c=>c.id)),resolved=cases.filter(c=>['Closed','Resolved'].includes(c.status)),
    active=cases.filter(c=>!['Closed','Resolved'].includes(c.status)),
    day=86400000;
  const events=await db.query("SELECT case_id,event_type,occurred_ms FROM pc_support_events WHERE event_type IN ('staff-reply','staff-signed-reply') ORDER BY occurred_ms,id");
  const first=new Map<string,number>();
  for(const e of events)if(ids.has(e.case_id)&&!first.has(e.case_id))first.set(e.case_id,Number(e.occurred_ms));
  const waiting=active.filter(c=>c.status==='Waiting for Staff');
  const avg=(values:number[])=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null;
  const firstReplyHundredths=avg(cases.filter(c=>first.has(c.id))
    .map(c=>Math.max(0,(first.get(c.id)!-Number(c.created_ms))/3600000)*100));
  const resolveHundredths=avg(resolved.filter(c=>c.closed_ms!==null)
    .map(c=>Math.max(0,(Number(c.closed_ms)-Number(c.created_ms))/3600000)*100));
  const firstReplyHours=firstReplyHundredths===null?null:firstReplyHundredths/100;
  const resolveHours=resolveHundredths===null?null:resolveHundredths/100;
  const feedback=await db.query('SELECT case_id,rating FROM pc_support_feedback');
  const ratings=feedback.filter(f=>ids.has(f.case_id)).map(f=>Number(f.rating));
  const grouped=new Map<string,{total:number;active:number;resolved:number}>();
  for(const c of cases)if(c.assigned_id){
    const data=grouped.get(c.assigned_id)||{total:0,active:0,resolved:0};
    data.total++;if(['Closed','Resolved'].includes(c.status))data.resolved++;else data.active++;
    grouped.set(c.assigned_id,data);
  }
  return {total:cases.length,active:active.length,resolved:resolved.length,
    awaitingStaff:waiting.length,openedLast7Days:cases.filter(c=>Number(c.created_ms)>=now-7*day).length,
    byKind:Object.fromEntries(supportKinds.map(kind=>[kind,cases.filter(c=>c.kind===kind).length])),
    averageFirstStaffReplyHours:Number.isFinite(firstReplyHours)?firstReplyHours:null,
    averageResolutionHours:Number.isFinite(resolveHours)?resolveHours:null,
    feedback:{responses:ratings.length,average:ratings.length?
      Math.round((ratings.reduce((a,b)=>a+b,0)/ratings.length)*10)/10:null},
    workload:[...grouped].map(([staffId,values])=>({staffId,...values}))
      .sort((a,b)=>b.active-a.active||a.staffId.localeCompare(b.staffId))};
}
