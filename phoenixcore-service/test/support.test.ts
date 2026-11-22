import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {staffIdentity} from '../src/staff.ts';
import {createSupportCase,addSupportMessage,transitionSupport,supportHistory,listSupportCases,blockSupportMember,supportAnalytics,eligibleAssignee,supportIdleMs} from '../src/support.ts';
import {closeInactiveSupport,deliverSupportOutbox} from '../src/support-delivery.ts';
import {receiveSupportDm} from '../src/support-dm.ts';
import {supportCommands,supportInteraction} from '../src/support-discord.ts';
import {DiscordFailure} from '../src/discord.ts';

const guild='950522987646418964',ownerId='110000000000000001',adminId='110000000000000002',memberId='110000000000000003',
 helperId='110000000000000004',helperRole='1100315893864603649',botId='110000000000000020';
const config:any={guild,owner:ownerId,clientId:botId};
const owner=staffIdentity(ownerId,[],'0',config,helperRole);
const admin=staffIdentity(adminId,[],'8',config,helperRole);
const helper=staffIdentity(helperId,[helperRole],'0',config,helperRole);
const member=staffIdentity(memberId,[],'0',config,helperRole);
async function dbFor(t:any){
 const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;
}
const input=(kind:'ticket'|'modmail'|'report'|'appeal'='ticket',text='I have a question about my character.',overrides:any={})=>({
 receipt:randomUUID(),actorId:memberId,requesterId:memberId,kind,message:text,assigneeId:helperId,...overrides
});
function fakeDiscord(){
 const calls:any[]=[];
 const call=async(path:string,args:any={})=>{
   calls.push({path,args});
   if(path==='/guilds/'+guild+'/roles')return [{id:helperRole,permissions:'0'},{id:'120000000000000009',permissions:'8'}];
   if(path==='/guilds/'+guild+'/members/'+ownerId)return {user:{id:ownerId},roles:[]};
   if(path==='/guilds/'+guild+'/members/'+helperId)return {user:{id:helperId},roles:[helperRole]};
   if(path==='/guilds/'+guild+'/members/'+adminId)return {user:{id:adminId},roles:['120000000000000009']};
   if(path==='/guilds/'+guild+'/members/'+memberId)return {user:{id:memberId},roles:[]};
   if(path==='/users/@me/channels')return {id:'140000000000000001'};
   if(path==='/channels/140000000000000001/messages')return {id:'140000000000000002'};
   throw Error('Unexpected Discord API path '+path);
 };
 return {calls,call,members:async()=>[
  {user:{id:ownerId},roles:[]},{user:{id:helperId},roles:[helperRole]},{user:{id:adminId},roles:['120000000000000009']} ]};
}
test('one generic SupportCase accepts tickets, duplicate receipts are idempotent, and there are no priority tiers',async t=>{
 const db=await dbFor(t),request=input(),created=await createSupportCase(db,request);
 assert.equal(created.created,true);
 assert.equal((await createSupportCase(db,request)).id,created.id);
 const [c]=await db.query('SELECT * FROM pc_support_cases WHERE id=$1',[created.id]);
 assert.equal(c.status,'Claimed');assert.equal(c.kind,'ticket');
 assert.ok(!Object.keys(c).includes('priority'));
 assert.equal((await supportHistory(db,member,created.id)).events.length,1);
 assert.equal((await supportHistory(db,helper,created.id)).events.length,2);
 assert.equal((await listSupportCases(db,member)).length,1);
 assert.equal((await listSupportCases(db,helper)).length,1);
 assert.equal((await listSupportCases(db,admin)).length,1);
});
test('staff notes stay private; outward replies require an explicit action; member cannot close or reopen',async t=>{
 const db=await dbFor(t),caseId=(await createSupportCase(db,input())).id;
 await addSupportMessage(db,helper,caseId,randomUUID(),'This is an internal staff note.','staff-note');
 assert.equal((await supportHistory(db,member,caseId)).events.some(e=>e.text.includes('internal staff note')),false);
 assert.equal((await supportHistory(db,helper,caseId)).events.some(e=>e.text.includes('internal staff note')),true);
 assert.equal((await db.query('SELECT * FROM pc_support_outbox')).length,0);
 const sent=await addSupportMessage(db,admin,caseId,'send:'+randomUUID(),'We can help you.','staff-reply');
 assert.equal(sent.created,true);
 assert.equal((await db.query('SELECT * FROM pc_support_outbox')).length,1);
 assert.equal((await addSupportMessage(db,admin,caseId,'send:'+randomUUID(),'Signed reply.','staff-signed-reply')).created,true);
 const memberHistory=await supportHistory(db,member,caseId);
 assert.equal(memberHistory.events.find(e=>e.type==='staff-reply')?.authorId,null);
 assert.equal(memberHistory.events.find(e=>e.type==='staff-signed-reply')?.authorId,adminId);
 await assert.rejects(transitionSupport(db,member,caseId,'close'),/authorized Convergence support staff/);
 await assert.rejects(transitionSupport(db,member,caseId,'reopen'),/authorized Convergence support staff/);
 const closed=await transitionSupport(db,helper,caseId,'close');
 assert.equal(closed.status,'Closed');
 await assert.rejects(addSupportMessage(db,member,caseId,randomUUID(),'Still here.','member'),/reopen/);
 assert.equal((await transitionSupport(db,helper,caseId,'reopen')).status,'Open');
 assert.equal((await addSupportMessage(db,member,caseId,randomUUID(),'Still here.','member')).created,true);
});
test('sensitive owner-only cases are excluded from helper and admin queues; anonymous reporters hidden from Helpers',async t=>{
 const db=await dbFor(t);
 await assert.rejects(createSupportCase(db,input('ticket','Secret',{sensitive:true})),/Only the server Owner/);
 const sensitive=await createSupportCase(db,input('ticket','Sensitive staff complaint',{actorId:ownerId,requesterId:memberId,staffOpened:true,ownerAuthorized:true,sensitive:true,assigneeId:ownerId}));
 assert.equal((await listSupportCases(db,helper)).length,0);
 assert.equal((await listSupportCases(db,admin)).length,0);
 assert.equal((await listSupportCases(db,owner)).length,1);
 await assert.rejects(supportHistory(db,helper,sensitive.id),/restricted to the server Owner/);
 await assert.rejects(transitionSupport(db,owner,sensitive.id,'transfer',helperId),/cannot be transferred/);
 const report=await createSupportCase(db,input('report','Anonymous report.',{anonymous:true}));
 assert.equal((await listSupportCases(db,helper))[0].requesterId,null);
 assert.equal((await listSupportCases(db,admin))[0].requesterId,memberId);
 const helperHistory=await supportHistory(db,helper,report.id);
 assert.equal(helperHistory.events.find(e=>e.type==='opened')?.authorId,null);
});
test('four-hour timer closes genuinely inactive cases but not while a staff reply is awaiting delivery',async t=>{
 const db=await dbFor(t),now=Date.now()-5*3600000;
 const one=await createSupportCase(db,input(),now);
 assert.equal(await closeInactiveSupport(db,now+supportIdleMs+1000),true);
 assert.equal((await supportHistory(db,member,one.id)).case.status,'Closed');
 assert.equal(await closeInactiveSupport(db,now+supportIdleMs+1000),false);
 const two=await createSupportCase(db,input(),now+1000);
 await addSupportMessage(db,helper,two.id,'send:'+randomUUID(),'Pending reply.','staff-reply',now+2000);
 assert.equal(await closeInactiveSupport(db,now+supportIdleMs+3000),true);
 assert.equal((await supportHistory(db,member,two.id)).case.status,'Waiting for Member');
 const [timer]=await db.query('SELECT due_ms FROM pc_support_idle WHERE case_id=$1',[two.id]);
 assert.ok(Number(timer.due_ms)>now+supportIdleMs+3000);
 const [outbox]=await db.query('SELECT event_id FROM pc_support_outbox');
 await db.query("UPDATE pc_support_outbox SET status='delivered' WHERE event_id=$1",[outbox.event_id]);
 assert.equal(await closeInactiveSupport(db,Number(timer.due_ms)+1),true);
 assert.equal((await supportHistory(db,member,two.id)).case.status,'Closed');
});
test('staff DM queue is restart-safe and honors generic vs signed staff identity',async t=>{
 const db=await dbFor(t),id=(await createSupportCase(db,input())).id;
 await addSupportMessage(db,helper,id,randomUUID(),'We will review that.', 'staff-reply');
 await initialize(db,guild);
 const discord=fakeDiscord();
 assert.equal(await deliverSupportOutbox(db,discord as any),true);
 assert.equal(await deliverSupportOutbox(db,discord as any),false);
 const sent=JSON.parse(discord.calls.find(c=>c.path.endsWith('/messages')).args.body);
 assert.match(sent.content,/Convergence Staff/);
 assert.doesNotMatch(sent.content,new RegExp(helperId));
 assert.deepEqual(sent.allowed_mentions,{parse:[]});
 assert.equal(sent.enforce_nonce,true);
 const [delivered]=await db.query('SELECT status FROM pc_support_outbox');
 assert.equal(delivered.status,'delivered');
 const id2=(await createSupportCase(db,input('ticket','Different problem.'))).id;
 await addSupportMessage(db,helper,id2,randomUUID(),'Another reply.','staff-reply');
 const blocked:any={call:async()=>{throw new DiscordFailure(403,0,50007);}};
 assert.equal(await deliverSupportOutbox(db,blocked),true);
 const latest=await db.query("SELECT status FROM pc_support_outbox WHERE status='undeliverable'");
 assert.equal(latest.length,1);
});
test('Modmail DMs auto-create a case, route subsequent messages, preserve multi-case ambiguity and allow appeal intake',async t=>{
 const db=await dbFor(t),discord=fakeDiscord();
 const first=await receiveSupportDm(db,discord as any,config,{messageId:'1511111111111111111',userId:memberId,text:'Hello, I need assistance.'});
 assert.equal(first.created,true);assert.ok(first.caseId);
 const second=await receiveSupportDm(db,discord as any,config,{messageId:'1511111111111111112',userId:memberId,text:'Here are more details.'});
 assert.equal(second.caseId,first.caseId);
 const another=await createSupportCase(db,input('modmail','Other conversation.',{receipt:randomUUID()}));
 const ambiguity=await receiveSupportDm(db,discord as any,config,{messageId:'1511111111111111113',userId:memberId,text:'Which case?'});
 assert.equal(ambiguity.accepted,false);
 const specific=await receiveSupportDm(db,discord as any,config,{messageId:'1511111111111111114',userId:memberId,text:'#'+another.id+' This belongs here.'});
 assert.equal(specific.caseId,another.id);
 const stranger='110000000000000009';
 const appealed=await receiveSupportDm(db,discord as any,config,{messageId:'1511111111111111115',userId:stranger,text:'Appeal: May I discuss a previous ban?'});
 assert.equal(appealed.created,true);
 const [caseRow]=await db.query('SELECT kind FROM pc_support_cases WHERE id=$1',[appealed.caseId]);
 assert.equal(caseRow.kind,'appeal');
});
test('blocked members cannot open ordinary tickets but can still initiate appeals',async t=>{
 const db=await dbFor(t);
 await blockSupportMember(db,helper,memberId,true,'Spam and repeat abuse');
 await assert.rejects(createSupportCase(db,input()),/restricted/);
 const appeal=await createSupportCase(db,input('appeal','I request a review.'));
 assert.equal(appeal.created,true);
 await blockSupportMember(db,helper,memberId,false);
 assert.equal((await createSupportCase(db,input())).created,true);
});
test('source moderation case appeal is checked against requester, unrelated cases are rejected',async t=>{
 const db=await dbFor(t),modId=randomUUID();
 await db.query('INSERT INTO pc_mod_cases(id,receipt_id,target_id,actor_id,kind,reason,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [modId,randomUUID(),helperId,ownerId,'warn','Test',Date.now()]);
 await assert.rejects(createSupportCase(db,input('appeal','My appeal',{linkedModCaseId:modId})),/must reference your own moderation case/);
 const okay=await createSupportCase(db,input('appeal','My appeal',{requesterId:helperId,actorId:helperId,linkedModCaseId:modId}));
 assert.equal(okay.created,true);
});
test('staff command declarations and case detail surface are private; ordinary members cannot send staff notes',async t=>{
 const db=await dbFor(t),discord=fakeDiscord(),id=(await createSupportCase(db,input())).id;
 assert.ok(supportCommands().some(c=>c.name==='support'));
 const body=(author:string,operation:string,options:any[]=[],roles:string[]=[])=>({
  guild_id:guild,member:{user:{id:author},roles,permissions:'0'},id:randomUUID(),data:{name:'support',options:[{name:operation,options}]}
 });
 const denied=await supportInteraction(db,config,body(memberId,'note',[{name:'case',value:id},{name:'message',value:'Unauthorized note.'}]),discord as any);
 assert.match(denied.data.content,/authorized support staff/);
 const staff=await supportInteraction(db,config,body(helperId,'note',[{name:'case',value:id},{name:'message',value:'Internal.'}],[helperRole]),discord as any);
 assert.match(staff.data.content,/Internal note saved/);
 assert.equal(staff.data.flags,64);
});
test('PostgreSQL concurrent case receipts and private message delivery cannot duplicate',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
 const u=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),adminDb=await openPostgres(u.href);
 const schema='support_test_'+randomUUID().replaceAll('-','');
 await adminDb.query('CREATE SCHEMA '+schema);u.searchParams.set('options','-c search_path='+schema);
 const db=await openPostgres(u.href);
 t.after(async()=>{await db.close();await adminDb.query('DROP SCHEMA '+schema+' CASCADE');await adminDb.close();});
 await initialize(db,guild);
 const request=input();
 const results=await Promise.all(Array.from({length:12},()=>createSupportCase(db,request)));
 assert.equal(new Set(results.map(x=>x.id)).size,1);
 assert.equal(results.filter(x=>x.created).length,1);
 const caseId=results[0].id;
 const receipt=randomUUID();
 await Promise.all(Array.from({length:8},()=>addSupportMessage(db,helper,caseId,receipt,'Sent once.','staff-reply')));
 assert.equal((await db.query('SELECT event_id FROM pc_support_outbox')).length,1);
 const discord=fakeDiscord();
 await Promise.all(Array.from({length:15},()=>deliverSupportOutbox(db,discord as any)));
 assert.equal(discord.calls.filter(x=>x.path.endsWith('/messages')).length,1);
});
