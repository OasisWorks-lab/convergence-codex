import {randomUUID} from 'node:crypto';
import {Problem,requireThat,readSettings} from './domain.ts';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {communityEnabled} from './community.ts';
import {staffIdentity} from './staff.ts';
import {chooseSupportStaff,liveSupportActor} from './support-auth.ts';
import {createSupportCase,addSupportMessage,transitionSupport,supportHistory,listSupportCases,blockSupportMember,supportAnalytics,type SupportKind} from './support.ts';
import {searchSupportCases,listSupportTemplates,saveSupportTemplate,archiveSupportTemplate,previewSupportTemplate,submitSupportFeedback,supportInsights} from './support-workspace.ts';

const str=(name:string,description:string,required=true,max_length?:number)=>({type:3,name,description,required,...(max_length?{max_length}:{})});
const member={type:6,name:'member',description:'Convergence Discord member',required:true};
const caseOption=str('case','SupportCase UUID');
const sub=(name:string,description:string,options:any[]=[])=>({type:1,name,description,options});
export const supportCommands=()=>[
  {type:1,name:'support',description:'Convergence private tickets, Modmail, reports and appeals.',options:[
    sub('open','Open a generic private support case.',[str('message','Describe your question or concern',true,1800)]),
    sub('report','Submit a private report to support staff.',[str('details','Explain the issue and include any evidence references',true,1800),{type:5,name:'anonymous',description:'Hide my identity from ordinary members and Helpers',required:false}]),
    sub('appeal','Request staff reconsideration of a moderation decision.',[str('message','Explain your appeal',true,1800),str('moderation-case','Relevant warning ID (if known)',false,36)]),
    sub('open-for','Staff: open a support case for another member.',[member,str('message','Describe their support question',true,1800)]),
    sub('list','List cases you may access.'),
    sub('view','View one case and its permitted conversation history.',[caseOption]),
    sub('reply','Send a member message to your own open case.',[caseOption,str('message','Your response',true,1800)]),
    sub('send','Staff: explicitly send a reply to the member through DM.',[caseOption,str('message','Outbound Convergence Staff reply',true,1800),{type:5,name:'signed',description:'Identify me by my Discord name',required:false}]),
    sub('note','Staff: record a private internal note; never sends to the member.',[caseOption,str('message','Private staff note',true,1800)]),
    sub('claim','Staff: claim a case.',[caseOption]),
    sub('transfer','Staff: assign another verified support staff member.',[caseOption,member]),
    sub('resolve','Staff: mark a case resolved.',[caseOption,str('reason','Optional closure reason',false,400)]),
    sub('close','Staff: close a case.',[caseOption,str('reason','Optional closure reason',false,400)]),
    sub('reopen','Staff: reopen a closed/resolved case.',[caseOption]),
    sub('restrict','Owner: mark a case sensitive (Owner-only staff access).',[caseOption]),
    sub('block','Staff: restrict or restore a member’s general support intake.',[member,{type:5,name:'blocked',description:'Block new cases? Appeals still allowed',required:true},str('reason','Optional reason',false,300)]),
    sub('stats','Staff: view general support caseload counts.'),
    sub('search','Search accessible support cases by subject and conversation.',[
      str('query','Find text in accessible cases',false,120),
      {type:3,name:'kind',description:'Case type',required:false,
        choices:['ticket','modmail','report','appeal'].map(x=>({name:x,value:x}))},
      {type:3,name:'status',description:'Case status',required:false,
        choices:['Open','Claimed','Waiting for Member','Waiting for Staff','Resolved','Closed'].map(x=>({name:x,value:x}))}]),
    sub('template-list','Staff: list active and archived saved reply templates.'),
    sub('template-save','Staff: create or edit a saved reply (not sent to a member).',[
      str('name','Saved reply identifier, e.g. account-help',true,40),
      str('body','Template content. {{case}}, {{member}}, {{staff}} supported.',true,1800),
      str('id','Existing template UUID when editing',false,36),
      {type:4,name:'revision',description:'Existing template revision if editing',required:false,min_value:1}]),
    sub('template-archive','Staff: archive a saved reply.',[
      str('id','Saved reply UUID'),{type:4,name:'revision',description:'Current template revision',required:true,min_value:1}]),
    sub('template-preview','Staff: privately preview a saved reply for one case.',[
      caseOption,str('id','Saved reply UUID')]),
    sub('feedback','Rate your own resolved SupportCase once.',[
      caseOption,{type:4,name:'rating',description:'Rating from 1 to 5',required:true,min_value:1,max_value:5},
      str('comment','Optional feedback comment',false,500)])
  ]}
];
export const isSupportCommand=(name:string)=>name==='support';
const respond=(message:string)=>({type:4,data:{content:message.slice(0,1970),flags:64,allowed_mentions:{parse:[]}}});
const option=(options:any[],name:string)=>options.find(o=>o.name===name)?.value;
const renderCase=(details:any)=>'**Case '+details.case.id+' · '+details.case.kind+' · '+details.case.status+'**\n'+
  'Subject: '+String(details.case.summary).slice(0,130)+'\nAssigned: '+(details.case.assignedId||'Unassigned')+
  '\nRecent conversation:\n'+details.events.slice(-12).map((e:any)=>'**'+e.type+'** · '+String(e.text).slice(0,300)).join('\n').slice(0,1370);
export async function supportInteraction(db:Store,config:Config,body:any,discord:Discord){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return respond('Use /support from your Convergence Discord server.');
  if(!await communityEnabled(db,'support'))return respond('The Support Center is currently disabled.');
  const userId=String(body.member.user.id),{value:settings}=await readSettings(db);
  const who=staffIdentity(userId,body.member.roles||[],body.member.permissions,config,settings.judgeRole);
  const action=body.data?.options?.[0]?.name,options=body.data?.options?.[0]?.options||[];
  const value=(name:string)=>option(options,name);
  const caseId=String(value('case')||'');
  const id=String(body.id||randomUUID());
  try{
    if(['open','report','appeal','open-for'].includes(action)){
      const onBehalf=action==='open-for';
      requireThat(!onBehalf||who.isHelper,403,'Only support staff can open cases on someone’s behalf.');
      const requesterId=onBehalf?String(value('member')||''):userId;
      const kind:SupportKind=action==='report'?'report':action==='appeal'?'appeal':'ticket';
      const staffAssigned=await chooseSupportStaff(db,discord,config,settings.judgeRole);
      const result=await createSupportCase(db,{receipt:id,actorId:userId,requesterId,kind,
        message:String(value(action==='report'?'details':'message')||''),
        linkedModCaseId:value('moderation-case')?String(value('moderation-case')):undefined,
        anonymous:action==='report'&&value('anonymous')===true,
        assigneeId:staffAssigned||undefined,staffOpened:onBehalf,ownerAuthorized:who.isOwner});
      return respond('**'+kind+' SupportCase '+(result.created?'created':'already received')+'.**\nCase ID: '+result.id+
        '\nThis case is private. Reply through /support reply or the PhoenixCore website. Staff may contact you through Discord DMs.');
    }
    if(action==='list'){
      const cases=await listSupportCases(db,who,20);
      return respond(cases.length?cases.map(c=>c.id+' · '+c.kind+' · '+c.status+' · '+c.summary.slice(0,60)).join('\n'):'No accessible SupportCases.');
    }
    if(action==='view')return respond(renderCase(await supportHistory(db,who,caseId)));
    if(['reply','send','note'].includes(action)){
      const mode=action==='reply'?'member':action==='note'?'staff-note':value('signed')?'staff-signed-reply':'staff-reply';
      const result=await addSupportMessage(db,who,caseId,id,String(value('message')||''),mode);
      return respond(!result.created?'This message has already been recorded.':
        mode==='staff-note'?'Internal note saved. It was **not sent** to the member.':
        mode==='member'?'Response added to your case. Staff will see it.':
        'Reply recorded and queued for delivery to the member by DM.');
    }
    if(['claim','transfer','resolve','close','reopen','restrict'].includes(action)){
      if(action==='transfer'){
        const target=String(value('member')||'');
        const verified=await liveSupportActor(db,discord,config,target);
        requireThat(verified.isHelper,403,'Choose a verified eligible support staff member.');
      }
      const result=await transitionSupport(db,who,caseId,action==='restrict'?'sensitive':action as any,
        action==='transfer'?String(value('member')):undefined,String(value('reason')||''));
      return respond('SupportCase '+result.caseId+' updated to '+result.status+'.');
    }
    if(action==='block'){
      await blockSupportMember(db,who,String(value('member')),value('blocked')===true,String(value('reason')||''));
      return respond('Support intake restriction updated. Moderation appeals remain accessible.');
    }
    if(action==='search'){
      const results=await searchSupportCases(db,who,{query:String(value('query')||''),
        kind:String(value('kind')||''),status:String(value('status')||''),pageSize:12});
      return respond('**Accessible SupportCases · '+results.total+' match(es)**\n'+
        (results.cases.length?results.cases.map(c=>c.id+' · '+c.kind+' · '+c.status+' · '+c.summary.slice(0,70))
          .join('\n'):'No matching cases.'));
    }
    if(action==='template-list'){
      const templates=await listSupportTemplates(db,who);
      return respond('**Saved replies (staff only)**\n'+(templates.length?
        templates.slice(0,20).map(t=>t.name+' · r'+t.revision+(t.active?'':' · archived')+
          ' · '+t.id).join('\n'):'No saved replies yet.'));
    }
    if(action==='template-save'){
      const data={name:value('name'),body:value('body'),...(value('id')?{id:value('id')}:{}),
        ...(value('revision')?{revision:value('revision')}:{} )};
      const result=await saveSupportTemplate(db,who,data);
      return respond('Saved reply **'+result.name+'** · revision '+result.revision+'. This did not send a DM.');
    }
    if(action==='template-archive'){
      const result=await archiveSupportTemplate(db,who,String(value('id')||''),Number(value('revision')));
      return respond('Saved reply archived at revision '+result.revision+'.');
    }
    if(action==='template-preview'){
      const body=await previewSupportTemplate(db,who,String(value('id')||''),caseId);
      return respond('**Private saved reply preview — nothing sent**\n'+body);
    }
    if(action==='feedback'){
      const result=await submitSupportFeedback(db,who,caseId,
        {rating:Number(value('rating')),comment:String(value('comment')||'')});
      return respond('Your optional case feedback was recorded. Thank you.');
    }
    if(action==='stats'){
      const [stats,insights]=await Promise.all([supportAnalytics(db,who),supportInsights(db,who)]);
      return respond('Support Center · '+stats.total+' cases · '+stats.open+' active · '+stats.resolved+' resolved/closed.\n'+
        Object.entries(stats.byStatus).map(([key,n])=>key+': '+n).join(' · ')+
        '\nWaiting for staff: '+insights.awaitingStaff+' · Opened in last 7 days: '+insights.openedLast7Days+
        ' · Average resolution: '+(insights.averageResolutionHours??'N/A')+' hours'+
        ' · Satisfaction: '+(insights.feedback.average??'N/A')+'/5 ('+insights.feedback.responses+' responses)');
    }
    return respond('Unknown Support Center action.');
  }catch(error){
    if(error instanceof Problem)return respond(error.message);
    return respond('Support action could not be completed. Please retry or check Discord role and bot permissions.');
  }
}
