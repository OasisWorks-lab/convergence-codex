import {Problem,readSettings,requireThat} from './domain.ts';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {communityEnabled} from './community.ts';
import {staffIdentity,requireModerator,verifyModerationTarget} from './staff.ts';
import {recordCase,removeWarning,proxyEvidence,moderationHistory,caseEvents,activeWarnings} from './moderation.ts';
import {createReminder,listReminders,cancelReminder,maxReminderMinutes} from './jobs.ts';
import {queueSanction,executeQueuedSanction,type SanctionAction} from './moderation-actions.ts';
import {automodPolicy,automodIncidents,previewAutomod} from './automod.ts';

const input=(name:string,description:string,required=true,max_length?:number)=>({type:3,name,description,required,...(max_length?{max_length}:{})});
const member={type:6,name:'member',description:'Discord member (not an NPC or webhook)',required:true};
const caseId=input('case','PhoenixCore moderation case ID');
const sub=(name:string,description:string,options:any[]=[])=>({type:1,name,description,options});
export const operationCommands=()=>[
  {type:1,name:'mod',description:'Private Owner/Admin moderation records and history.',default_member_permissions:'8',options:[
    sub('warn','Record a staff warning; never automatically bans.',[member,input('reason','Optional warning reason',false,900),input('proxy-post','Optional PhoenixCore in-character post ID as evidence',false,24)]),
    sub('note','Add a private staff note to the member history.',[member,input('note','Private staff note',true,1800)]),
    sub('warnings','Count active warnings for a member.',[member]),
    sub('history','View private moderation history for a member.',[member]),
    sub('case','Inspect the audit record for a moderation case.',[caseId]),
    sub('remove-warning','Remove an active warning, retaining the audit record.',[caseId]),
    sub('timeout','Manually time out a member, for up to 28 days.',[
      member,{type:4,name:'minutes',description:'Duration 1–40,320 minutes',required:true,min_value:1,max_value:40320},
      input('reason','Optional reason',false,850),input('proxy-post','Optional attributable RP post ID',false,24)]),
    sub('untimeout','Manually clear an active timeout.',[
      member,input('reason','Optional reason',false,850)]),
    sub('kick','Manually remove a member from Convergence.',[
      member,input('reason','Optional reason',false,850),input('proxy-post','Optional attributable RP post ID',false,24)]),
    sub('ban','Manually ban a member; optional expiry is restart-safe.',[
      member,{type:4,name:'minutes',description:'0 for permanent; otherwise 1–525,600 minutes',required:false,min_value:0,max_value:525600},
      input('reason','Optional reason',false,850),input('proxy-post','Optional attributable RP post ID',false,24)]),
    sub('unban','Manually revoke a ban; enter the banned user ID.',[
      input('user-id','Banned Discord user ID',true,24),input('reason','Optional reason',false,850)]),
    sub('apply','Explicitly apply an unfinished queued sanction (same moderator).',[caseId]),
    sub('automod-status','See private audit-only automod rule state and incident total.'),
    sub('automod-test','Owner: preview rule matches without saving, deleting or warning.',[
      input('sample','Sample message text, never posted or recorded',true,1500),
      {type:7,name:'channel',description:'Simulated Convergence text channel',required:true}])
  ]},
  {type:1,name:'remind',description:'Schedule a private reminder for yourself.',options:[
    sub('me','Send me a reminder after a number of minutes.',[
      {type:4,name:'minutes',description:'Delay (1 minute–7 days)',required:true,min_value:1,max_value:maxReminderMinutes},
      input('message','Reminder text',true,500)]),
    sub('list','List my pending reminders.'),
    sub('cancel','Cancel a pending reminder.',[input('id','Reminder ID returned when scheduled')])
  ]}
];
export const operationCommand=(name:string)=>name==='mod'||name==='remind';
const respond=(content:string)=>({type:4,data:{content:content.slice(0,1960),flags:64,allowed_mentions:{parse:[]}}});
const pick=(opts:any[],name:string)=>opts.find((o:any)=>o.name===name)?.value;
export async function operationInteraction(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return respond('Use this inside the Convergence server.');
  const id=String(body.member.user.id);
  const {value:settings}=await readSettings(db);
  const who=staffIdentity(id,body.member.roles||[],body.member.permissions,config,settings.judgeRole);
  const group=body.data?.name,operation=body.data?.options?.[0]?.name,opts=body.data?.options?.[0]?.options||[];
  const value=(name:string)=>pick(opts,name);
  try{
    if(group==='remind'){
      requireThat(await communityEnabled(db,'reminders'),403,'Reminders are disabled by the Owner.');
      if(operation==='me'){
        const scheduled=await createReminder(db,id,String(body.id||''),Number(value('minutes')),String(value('message')||''));
        return respond((scheduled.created?'Reminder scheduled':'Already scheduled')+' for <t:'+Math.floor(scheduled.dueAt/1000)+':F>.\nID: '+scheduled.id);
      }
      if(operation==='list'){
        const rows=await listReminders(db,id);
        return respond(rows.length?rows.map(r=>r.id+' · <t:'+Math.floor(Number(r.due_ms)/1000)+':R> · '+String(JSON.parse(r.payload).message||'').slice(0,70)).join('\n'):'You have no pending reminders.');
      }
      if(operation==='cancel')return respond(await cancelReminder(db,id,String(value('id')||''))?'Reminder cancelled.':'No active reminder with that ID belongs to you.');
    }
    if(group==='mod'){
      requireModerator(who);
      requireThat(await communityEnabled(db,'moderation'),403,'Moderation records are disabled by the Owner.');
      if(operation==='automod-status'){
        const [state,incidents]=await Promise.all([automodPolicy(db),automodIncidents(db,who)]);
        return respond('**Automod audit-only settings**\n'+
          'Enabled: '+(state.policy.enabled?'yes':'no')+
          ' · Owner alerts: '+(state.policy.ownerAlerts?'on':'off')+
          '\nInvite filter: '+(state.policy.invites?'on':'off')+
          ' · Blocklisted hosts: '+state.policy.blockedHosts.length+
          ' · Repeated-post threshold: '+state.policy.duplicateThreshold+
          ' · Mention threshold: '+state.policy.mentionThreshold+
          '\nRecorded incident matches: '+incidents.total+
          '\nNo automated deletions or punitive actions are available in this milestone.');
      }
      if(operation==='automod-test'){
        requireThat(who.isOwner,403,'Only the Owner may test private automod settings.');
        const result=await previewAutomod(db,who,{
          id:'000000000000000001',guildId:config.guild,
          userId:who.id,channelId:String(value('channel')||''),
          roles:[],content:String(value('sample')||'')});
        return respond('**Automod preview — no action taken**\n'+
          (result.rules.length?'Would match: '+result.rules.join(', '):'No configured rules matched.')+
          '\nNo log, warning, deletion or DM was created.');
      }
      if(operation==='warn'||operation==='note'){
        const target=String(value('member')||'');
        await verifyModerationTarget(discord,config,who,target);
        const evidence=operation==='warn'&&value('proxy-post')?await proxyEvidence(db,String(value('proxy-post')),target):null;
        const result=await recordCase(db,who,operation==='warn'?'warn':'note',target,String(body.id||''),String(value(operation==='warn'?'reason':'note')||''),evidence);
        if(operation==='note')return respond('Private note recorded for <@'+target+'>. Case: '+result.caseId+'.');
        return respond('Warning '+(result.created?'recorded':'already recorded')+' for <@'+target+'>.\nCase: '+result.caseId+
          '\nActive warnings: '+result.activeWarnings+(result.needsReview?'\n**Staff review required:** 5 or more active warnings. No automatic punishment was applied.':'')+
          '\nPhoenixCore will attempt a private DM notification.');
      }
      if(['timeout','untimeout','kick','ban','unban'].includes(operation)){
        const action=operation as SanctionAction,target=String(value(action==='unban'?'user-id':'member')||'');
        const queued=await queueSanction(db,discord,config,who,{
          action,targetId:target,receipt:String(body.id||''),reason:String(value('reason')||''),
          minutes:Number(value('minutes')||0),proxyPost:value('proxy-post')?String(value('proxy-post')):undefined
        });
        const result=queued.created?await executeQueuedSanction(db,discord,config,who,queued.caseId):queued;
        return respond('Manual '+action+' · '+result.status+'\\nCase: '+queued.caseId+
          (result.status==='applied'?'\\nDiscord confirmed the action. An audit event was recorded.':
          result.status==='needs-review'?'\\nDiscord delivery was uncertain. Do not repeat blindly; verify the member or ban state.':
          '\\nNo additional Discord operation was performed for this receipt.')+
          (action==='ban'&&Number(value('minutes')||0)>0?'\\nA persistent expiry check is scheduled.':''));
      }
      if(operation==='apply'){
        const result=await executeQueuedSanction(db,discord,config,who,String(value('case')||''));
        return respond('Sanction '+result.status+' · '+result.caseId+
          (result.applied?'\\nDiscord confirmed the operation.':'\\nNo additional Discord operation was performed.'));
      }
      if(operation==='warnings'||operation==='history'){
        const target=String(value('member')||'');
        if(operation==='warnings')return respond('Active warnings for <@'+target+'>: **'+await activeWarnings(db,target)+'**. No automatic escalation configured.');
        const report=await moderationHistory(db,who,target,15);
        return respond('**Private moderation history for <@'+target+'>** · '+report.activeWarnings+' active warnings\n'+
          (report.cases.map(c=>'**'+c.kind+(c.kind==='warn'?(Number(c.active)?' · active':' · removed'):'')+'** · '+c.id+'\n'+
            String(c.reason||'Unspecified').slice(0,160)).join('\n')||'No recorded cases.'));
      }
      if(operation==='case'||operation==='remove-warning'){
        const record=await caseEvents(db,who,String(value('case')||''));
        if(operation==='case')return respond('**Private case '+record.record.id+'** · '+record.record.kind+
          '\nTarget: <@'+record.record.target_id+'>\nReason: '+String(record.record.reason).slice(0,800)+
          (record.record.source_message_id?'\nOriginal RP source message: '+record.record.source_message_id+'\nProxied message: '+record.record.posted_message_id+
          '\nAssociated character ID: '+record.record.character_id:'')+'\nHistory:\n'+record.events.map(e=>e.event+' · '+new Date(Number(e.occurred_ms)).toISOString().slice(0,16)+' UTC').join('\n'));
        await verifyModerationTarget(discord,config,who,record.record.target_id);
        const result=await removeWarning(db,who,String(value('case')));
        return respond(result.changed?'Warning deactivated. Its original case and audit trail are preserved.':'Warning already inactive.');
      }
    }
    return respond('Unknown PhoenixCore staff or reminder command.');
  }catch(e){
    if(e instanceof Problem)return respond(e.message);
    return respond('Discord could not verify the member or complete this action. No unverified moderation change was applied.');
  }
}
