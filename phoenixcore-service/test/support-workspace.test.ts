import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize,defaultSettings} from '../src/db.ts';
import {staffIdentity} from '../src/staff.ts';
import {createSupportCase,addSupportMessage,transitionSupport,supportHistory} from '../src/support.ts';
import {searchSupportCases,listSupportTemplates,saveSupportTemplate,archiveSupportTemplate,
  supportTemplateHistory,previewSupportTemplate,supportCaseFeedback,submitSupportFeedback,supportInsights} from '../src/support-workspace.ts';
import {supportInteraction,supportCommands} from '../src/support-discord.ts';
const guild='960000000000000001',ownerId='960000000000000002',helperId='960000000000000003',
  userId='960000000000000004',otherId='960000000000000005',helperRole='960000000000000006';
const config:any={guild,owner:ownerId,clientId:'960000000000000007'};
const owner=staffIdentity(ownerId,[],'0',config,helperRole),
  helper=staffIdentity(helperId,[helperRole],'0',config,helperRole),
  member=staffIdentity(userId,[],'0',config,helperRole),
  other=staffIdentity(otherId,[],'0',config,helperRole);
async function dbFor(t:any){
  const db=openSqlite(':memory:');await initialize(db,guild);
  t.after(async()=>db.close());
  return db;
}
async function create(db:any,words='Test case content',options:any={}){
  return createSupportCase(db,{
    receipt:randomUUID(),actorId:userId,requesterId:userId,
    kind:'ticket',message:words,assigneeId:helperId,...options
  });
}
test('search matches authorized cases, searches visible text and safely filters status/type',async t=>{
  const db=await dbFor(t),first=await create(db,'My question about a planet market');
  const second=await createSupportCase(db,{receipt:randomUUID(),actorId:otherId,requesterId:otherId,
    kind:'appeal',message:'The staff response was unfair.',assigneeId:helperId});
  await addSupportMessage(db,helper,first.id,randomUUID(),'private-alpha-one','staff-note');
  await addSupportMessage(db,member,first.id,randomUUID(),'My additional public-details','member');
  const found=await searchSupportCases(db,member,{query:'public-details'});
  assert.deepEqual(found.cases.map(c=>c.id),[first.id]);
  assert.equal((await searchSupportCases(db,member,{query:'private-alpha-one'})).total,0);
  assert.equal((await searchSupportCases(db,helper,{query:'private-alpha-one'})).total,1);
  assert.equal((await searchSupportCases(db,other,{query:'planet market'})).total,0);
  assert.equal((await searchSupportCases(db,owner,{kind:'appeal'})).cases[0].id,second.id);
  assert.equal((await searchSupportCases(db,helper,{status:'Waiting for Staff'})).total,1);
  await assert.rejects(searchSupportCases(db,member,{assignedId:helperId}),{status:403});
  await assert.rejects(searchSupportCases(db,helper,{pageSize:51}),{status:400});
  assert.equal((await searchSupportCases(db,member,{query:'%'})).total,0);
  assert.equal((await searchSupportCases(db,member,{query:'_'})).total,0);
  const ownerCase=await createSupportCase(db,{receipt:randomUUID(),actorId:ownerId,requesterId:otherId,
    kind:'report',message:'Restricted complaint',sensitive:true,ownerAuthorized:true,staffOpened:true,assigneeId:ownerId});
  await addSupportMessage(db,owner,ownerCase.id,randomUUID(),'restricted-owner-note','staff-note');
  assert.equal((await searchSupportCases(db,helper,{query:'restricted-owner-note'})).total,0);
  assert.equal((await searchSupportCases(db,owner,{query:'restricted-owner-note'})).total,1);
  assert.equal((await searchSupportCases(db,other,{query:'restricted-owner-note'})).total,0);
  assert.equal((await searchSupportCases(db,other,{query:'Restricted complaint'})).total,1);
});
test('saved replies remain drafts with revision history, safe placeholder preview and no DM',async t=>{
  const db=await dbFor(t),caseId=(await create(db)).id;
  await assert.rejects(listSupportTemplates(db,member),{status:403});
  await assert.rejects(saveSupportTemplate(db,member,{name:'answer',body:'No'}),{status:403});
  const template=await saveSupportTemplate(db,helper,{name:'account-help',body:'Hello {{member}}, your case is {{case}}. – {{staff}}'});
  assert.equal(template.revision,1);
  const preview=await previewSupportTemplate(db,helper,template.id,caseId);
  assert.match(preview,/Convergence Staff/);
  assert.match(preview,/\<@960000000000000004>/);
  assert.match(preview,new RegExp(caseId));
  assert.equal((await db.query('SELECT id FROM pc_support_events WHERE case_id=$1',[caseId])).length,2);
  assert.equal((await db.query('SELECT event_id FROM pc_support_outbox')).length,0);
  await assert.rejects(previewSupportTemplate(db,member,template.id,caseId),{status:403});
  await assert.rejects(saveSupportTemplate(db,helper,{id:template.id,revision:3,name:'account-help',body:'Updated'}),{status:409});
  const updated=await saveSupportTemplate(db,owner,{id:template.id,revision:1,name:'account-help',body:'Updated {{case}}'});
  assert.equal(updated.revision,2);
  await assert.rejects(saveSupportTemplate(db,helper,{name:'account-help',body:'duplicate'}),{status:409});
  assert.deepEqual((await supportTemplateHistory(db,helper,template.id)).map(x=>x.revision),[2,1]);
  const archived=await archiveSupportTemplate(db,helper,template.id,2);
  assert.equal(archived.active,false);
  await assert.rejects(previewSupportTemplate(db,helper,template.id,caseId),{status:404});
  const restored=await saveSupportTemplate(db,helper,{id:template.id,revision:3,name:'account-help',body:'Restored {{case}}'});
  assert.equal(restored.revision,4);
  assert.equal((await listSupportTemplates(db,helper))[0].active,true);
  assert.equal((await db.query('SELECT event_id FROM pc_support_outbox')).length,0);
});
test('feedback is one-time, member-owned and allowed only on resolved/closed cases',async t=>{
  const db=await dbFor(t),caseId=(await create(db)).id;
  await assert.rejects(submitSupportFeedback(db,member,caseId,{rating:5}),{status:409});
  await transitionSupport(db,helper,caseId,'resolve');
  assert.equal((await supportCaseFeedback(db,member,caseId)).maySubmit,true);
  await assert.rejects(submitSupportFeedback(db,other,caseId,{rating:5}),{status:403});
  await assert.rejects(submitSupportFeedback(db,member,caseId,{rating:6}),{status:400});
  await submitSupportFeedback(db,member,caseId,{rating:5,comment:'My issue was resolved.'});
  assert.equal((await supportCaseFeedback(db,member,caseId)).feedback?.rating,5);
  assert.equal((await supportCaseFeedback(db,member,caseId)).maySubmit,false);
  await assert.rejects(submitSupportFeedback(db,member,caseId,{rating:1}),{status:409});
  await assert.rejects(supportCaseFeedback(db,other,caseId),{status:403});
});
test('staff insights separate sensitive Owner cases and preserve null when no response exists',async t=>{
  const db=await dbFor(t),base=Date.now()-7200000;
  const first=await createSupportCase(db,{receipt:randomUUID(),actorId:userId,requesterId:userId,
    kind:'ticket',message:'Open problem',assigneeId:helperId},base);
  const secret=await createSupportCase(db,{receipt:randomUUID(),actorId:ownerId,requesterId:otherId,
    kind:'report',message:'Owner only',ownerAuthorized:true,sensitive:true,staffOpened:true,assigneeId:ownerId},base+40000);
  await transitionSupport(db,owner,secret.id,'close',undefined,'Done',base+3600000);
  const visible=await supportInsights(db,helper,base+7000000);
  assert.equal(visible.total,1);
  assert.equal(visible.active,1);
  assert.equal(visible.averageFirstStaffReplyHours,null);
  assert.equal(visible.averageResolutionHours,null);
  const privateInsights=await supportInsights(db,owner,base+7000000);
  assert.equal(privateInsights.total,2);
  assert.equal(privateInsights.resolved,1);
  assert.equal(privateInsights.workload.find(x=>x.staffId===helperId)?.active,1);
  await addSupportMessage(db,helper,first.id,randomUUID(),'We can help','staff-reply',base+3600000);
  const next=await supportInsights(db,helper,base+7000000);
  assert.equal(next.averageFirstStaffReplyHours,1);
});
test('Discord support workspace commands enforce staff access without sending saved drafts',async t=>{
  const db=await dbFor(t),caseId=(await create(db)).id;
  await db.query('UPDATE pc_config SET value=$1 WHERE slot=1',[JSON.stringify({...defaultSettings,judgeRole:helperRole})]);
  const interaction=(user:string,roleIds:string[],action:string,options:any[]=[])=>({
    guild_id:guild,id:'960000000000000050',member:{user:{id:user},roles:roleIds,permissions:'0'},
    data:{name:'support',options:[{name:action,options}]}
  });
  const result:any=await supportInteraction(db,config,interaction(helperId,[helperRole],'template-save',[
    {name:'name',value:'greeting'},{name:'body',value:'Welcome to {{case}}'}]),{} as any);
  assert.match(result.data.content,/Saved reply/);
  assert.equal(result.data.flags,64);
  const template=(await listSupportTemplates(db,helper))[0];
  const preview:any=await supportInteraction(db,config,interaction(helperId,[helperRole],'template-preview',[
    {name:'case',value:caseId},{name:'id',value:template.id}]),{} as any);
  assert.match(preview.data.content,/nothing sent/i);
  assert.equal((await db.query('SELECT * FROM pc_support_outbox')).length,0);
  const denial:any=await supportInteraction(db,config,interaction(userId,[],'template-list'),{} as any);
  assert.match(denial.data.content,/authorized Convergence support staff/);
  await transitionSupport(db,helper,caseId,'close');
  const feedback:any=await supportInteraction(db,config,interaction(userId,[],'feedback',[
    {name:'case',value:caseId},{name:'rating',value:4}]),{} as any);
  assert.match(feedback.data.content,/feedback was recorded/);
  const fields=supportCommands()[0].options.map((x:any)=>x.name);
  for(const name of ['search','template-list','template-save','template-archive','template-preview','feedback','stats'])
    assert.ok(fields.includes(name));
});
test('PostgreSQL saved replies, feedback and searches survive concurrent updates',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='support_workspace_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const c=await create(db,'Please help with my market access');
  const reply=await saveSupportTemplate(db,helper,{name:'market-assist',body:'Hello {{member}}'});
  const concurrent=await Promise.allSettled([
    saveSupportTemplate(db,helper,{id:reply.id,revision:1,name:'market-assist',body:'A'}),
    saveSupportTemplate(db,helper,{id:reply.id,revision:1,name:'market-assist',body:'B'})
  ]);
  assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(concurrent.filter(x=>x.status==='rejected').length,1);
  assert.equal((await searchSupportCases(db,member,{query:'market'})).total,1);
  await transitionSupport(db,helper,c.id,'close');
  const results=await Promise.allSettled([
    submitSupportFeedback(db,member,c.id,{rating:4,comment:'Thanks'}),
    submitSupportFeedback(db,member,c.id,{rating:5,comment:'Other'})
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await supportInsights(db,helper)).feedback.responses,1);
});
