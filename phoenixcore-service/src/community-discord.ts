import {Problem} from './domain.ts';
import {readSettings} from './domain.ts';
import type {Store} from './db.ts';
import type {Config} from './discord.ts';
import {communityActor,communityEnabled,communityModules,communitySetModule,
  saveTag,getTag,listTags,tagAlias,tagHistory,tagRollback,proposeTag,pendingTagProposals,reviewTag,
  createSuggestion,getSuggestion,listSuggestions,voteSuggestion,reviewSuggestion,suggestionDisplay,suggestionPost,suggestionChannelId,
  type CommunityModule,type SuggestionStatus} from './community.ts';

const text=(name:string,description:string,required=true,max_length?:number)=>({type:3,name,description,required,...(max_length?{max_length}:{})});
const sub=(name:string,description:string,options:any[]=[])=>({type:1,name,description,options});
const nameOption=text('name','Informational tag name');
const idOption=text('id','PhoenixCore proposal or suggestion ID');
export const communityCommands=()=>[
  {type:1,name:'tag',description:'Informational tags separate from roleplay character tags.',options:[
    sub('show','Post a published informational tag.',[nameOption]),
    sub('search','Find published informational tags.',[text('query','Optional search terms',false)]),
    sub('propose','Suggest a new informational tag for staff.',[nameOption,text('content','Proposed content',true,1600)]),
    sub('save','Staff: publish a new tag or a revised version.',[nameOption,text('content','Published content',true,1600)]),
    sub('alias','Staff: add a new name for an existing tag.',[nameOption,text('alias','New unique alias')]),
    sub('history','Staff: see earlier versions.',[nameOption]),
    sub('rollback','Staff: restore an earlier version.',[nameOption,{type:4,name:'revision',description:'Version to restore',required:true,min_value:1}]),
    sub('proposals','Staff: list pending informational tag proposals.'),
    sub('review','Staff: approve or decline a tag proposal.',[idOption,{type:3,name:'decision',description:'Choose review outcome',required:true,choices:[{name:'Approve',value:'approve'},{name:'Decline',value:'decline'}]},text('note','Optional staff note',false,500)])
  ]},
  {type:1,name:'suggest',description:'Convergence member suggestions and voting.',options:[
    sub('create','Post a server suggestion with voting buttons.',[text('title','Suggestion title',true,120),text('content','Details and reasoning',true,1800),{type:5,name:'anonymous',description:'Hide your name from members',required:false}]),
    sub('list','List recent suggestions.'),
    sub('view','View a suggestion and its current votes.',[idOption]),
    sub('vote','Cast, change or remove your vote.',[idOption,{type:3,name:'choice',description:'Your ballot',required:true,choices:[{name:'Upvote',value:'up'},{name:'Downvote',value:'down'},{name:'Remove vote',value:'remove'}]}]),
    sub('manage','Staff: open private decision buttons for a suggestion.',[idOption]),
    sub('review','Staff: open private buttons or set status with an explanation.',[idOption,{type:3,name:'status',description:'Optional decision; omit for private buttons',required:false,choices:['Pending','Under Review','Approved','Denied','Implemented'].map(s=>({name:s,value:s}))},text('response','Optional public staff explanation',false,950)])
  ]},
  {type:1,name:'pc-tag-show',description:'PhoenixCore: display a public informational tag.',options:[nameOption]},
  {type:1,name:'pc-tag-save',description:'PhoenixCore staff: publish or update an informational tag.',options:[nameOption,text('content','Published text',true,1600)]},
  {type:1,name:'community-module',description:'Owner-only community module switches.',options:[
    sub('status','Show enabled or disabled modules.'),
    sub('set','Enable or disable a community module.',[{type:3,name:'module',description:'Module',required:true,choices:communityModules.map(m=>({name:m,value:m}))},{type:5,name:'enabled',description:'Desired status',required:true}])
  ]}
];
export const communityCommand=(name:string)=>['tag','pc-tag-show','pc-tag-save','suggest','community-module'].includes(name);
const response=(content:string,privateMessage=true)=>({type:4,data:{content:content.slice(0,1930),...(privateMessage?{flags:64}:{}),allowed_mentions:{parse:[]}}});
const pick=(options:any[],name:string)=>options.find((o:any)=>o.name===name)?.value;

function staffReviewPanel(row:any){
  const base=suggestionDisplay(row),status=String(row.status);
  return {type:4,data:{flags:64,embeds:base.embeds,allowed_mentions:{parse:[]},
    content:'**Private staff review** · Only you can see these controls. The public suggestion stays in the designated channel.',
    components:[{type:1,components:[
      {type:2,style:3,label:'Approved',custom_id:'pcs:staff:'+row.id+':approved',disabled:status==='Approved'},
      {type:2,style:4,label:'Denied',custom_id:'pcs:staff:'+row.id+':denied',disabled:status==='Denied'},
      {type:2,style:1,label:'Implemented',custom_id:'pcs:staff:'+row.id+':implemented',disabled:status==='Implemented'}
    ]}]}};
}

export async function communityInteraction(db:Store,config:Config,body:any){
  const group=String(body.data?.name||''),actorId=String(body.member?.user?.id||'');
  if(body.guild_id!==config.guild||!actorId)return response('This feature is only available to Convergence members.');
  const settings=(await readSettings(db)).value;
  const actor=communityActor(actorId,body.member?.roles||[],body.member?.permissions,config.owner,settings.judgeRole);
  try {
    const vote=/^pcs:vote:([0-9a-f-]{36}):(up|down|remove)$/.exec(String(body.data?.custom_id||''));
    if(vote) {
      if(!await communityEnabled(db,'suggestions'))return response('Suggestions are currently disabled.');
      const value=vote[2]==='up'?1:vote[2]==='down'?-1:0;
      await voteSuggestion(db,actor,vote[1],value);
      const canonical=await suggestionPost(db,vote[1]);
      if(canonical?.message_id===body.message?.id&&canonical?.channel_id===body.channel_id)
        return {type:7,data:suggestionDisplay(await getSuggestion(db,vote[1]))};
      return response('Vote saved. The voting embed in <#'+suggestionChannelId+'> will update shortly.');
    }
    const staffClick=/^pcs:staff:([0-9a-f-]{36}):(approved|denied|implemented)$/.exec(String(body.data?.custom_id||''));
    if(staffClick){
      if(!await communityEnabled(db,'suggestions'))return response('Suggestions are disabled.');
      if(!actor.isStaff)return response('Only Owner, Admin or Helper may manage suggestions.');
      const status=staffClick[2]==='approved'?'Approved':staffClick[2]==='denied'?'Denied':'Implemented';
      await reviewSuggestion(db,actor,staffClick[1],status);
      const updated=staffReviewPanel(await getSuggestion(db,staffClick[1]));
      return {type:7,data:{...updated.data,flags:undefined,content:'**Staff decision recorded:** '+status+'. The public suggestion will update shortly.'}};
    }
    const direct=group==='pc-tag-show'||group==='pc-tag-save';
    const operation=direct?(group==='pc-tag-show'?'show':'save'):String(body.data?.options?.[0]?.name||'');
    const options=direct?(body.data?.options||[]):(body.data?.options?.[0]?.options||[]);
    const value=(name:string)=>pick(options,name);
    if(group==='community-module'){
      if(operation==='set'){
        const module=String(value('module'));
        if(!communityModules.includes(module as CommunityModule))return response('Choose a valid module.');
        const enabled=await communitySetModule(db,actor,module as CommunityModule,value('enabled')===true);
        return response('Module '+module+' is now '+(enabled?'enabled':'disabled')+'.');
      }
      if(!actor.isOwner)return response('Only the owner can view module switches.');
      const states=await Promise.all(communityModules.map(async m=>m+': '+(await communityEnabled(db,m)?'enabled':'disabled')));
      return response(states.join('\n'));
    }
    if(['pc-tag-show','pc-tag-save','tag'].includes(group)){
      if(!await communityEnabled(db,'tags'))return response('Informational tags are disabled.');
      if(operation==='show'||group==='pc-tag-show'){
        const r=await getTag(db,String(value('name')||''),{userId:actor.id,channelId:body.channel_id});
        return response('**'+r.name+'**\n'+r.text,false);
      }
      if(operation==='search'){
        const r=await listTags(db,String(value('query')||''));
        return response(r.length?'Informational tags: '+r.map(x=>x.name).join(' · '):'No matching published tags.');
      }
      if(operation==='propose'){
        const id=await proposeTag(db,actor,String(value('name')||''),String(value('content')||''));
        return response('Proposal submitted to staff. ID: '+id);
      }
      if(operation==='save'||group==='pc-tag-save'){
        const r=await saveTag(db,actor,String(value('name')||''),String(value('content')||''));
        return response('Published '+r.name+' revision '+r.revision+'.');
      }
      if(operation==='alias'){
        const tag=await tagAlias(db,actor,String(value('name')||''),String(value('alias')||''));
        return response('Alias added to '+tag+'.');
      }
      if(operation==='history'){
        const rows=await tagHistory(db,actor,String(value('name')||''));
        return response(rows.map(r=>'v'+r.revision+' · changed '+new Date(Number(r.changed_ms)).toISOString().slice(0,10)+' by '+r.actor_id).join('\n')||'No history.');
      }
      if(operation==='rollback'){
        const r=await tagRollback(db,actor,String(value('name')||''),Number(value('revision')));
        return response('Restored '+r.name+' as revision '+r.revision+'.');
      }
      if(operation==='proposals'){
        const rows=await pendingTagProposals(db,actor);
        return response(rows.map(r=>r.id+' · '+r.name+' · proposed by '+r.author_id).join('\n')||'No pending proposals.');
      }
      if(operation==='review'){
        const r=await reviewTag(db,actor,String(value('id')||''),String(value('decision')) as 'approve'|'decline',String(value('note')||''));
        return response(r.decision==='approve'?'Approved and published '+r.published?.name+'.':'Declined proposal.');
      }
    }
    if(group==='suggest'){
      if(!await communityEnabled(db,'suggestions'))return response('Suggestions are disabled.');
      if(operation==='create'){
        const id=await createSuggestion(db,actor,String(value('title')||''),String(value('content')||''),value('anonymous')===true);
        return response('Suggestion received and queued for <#'+suggestionChannelId+'>. Its voting embed will appear there shortly.\nReference: `'+id+'`.');
      }
      if(operation==='list'){
        const rows=await listSuggestions(db);
        return response(rows.map(s=>s.id+' · '+s.title+' · '+s.status+' · +'+Number(s.upvotes)+' / -'+Number(s.downvotes)).join('\n')||'No suggestions yet.');
      }
      if(operation==='view'){
        const id=String(value('id')||''),item=await getSuggestion(db,id),post=await suggestionPost(db,id);
        const preview=suggestionDisplay(item),url=post?.message_id?'https://discord.com/channels/'+config.guild+'/'+post.channel_id+'/'+post.message_id:'';
        return {type:4,data:{flags:64,embeds:preview.embeds,content:url?'Original public suggestion: '+url:'The suggestion is awaiting posting to <#'+suggestionChannelId+'>.',allowed_mentions:{parse:[]}}};
      }
      if(operation==='vote'){
        const choice=value('choice')==='up'?1:value('choice')==='down'?-1:0;
        await voteSuggestion(db,actor,String(value('id')||''),choice);
        const s=await getSuggestion(db,String(value('id')||''));
        return response('Vote saved. 👍 '+Number(s.upvotes)+' · 👎 '+Number(s.downvotes)+'.');
      }
      if(operation==='manage'||(operation==='review'&&!value('status'))){
        if(!actor.isStaff)return response('Only Owner, Admin or Helper may manage suggestions.');
        return staffReviewPanel(await getSuggestion(db,String(value('id')||'')));
      }
      if(operation==='review'){
        const r=await reviewSuggestion(db,actor,String(value('id')||''),String(value('status')) as SuggestionStatus,String(value('response')||''));
        return response('Suggestion status updated to '+r.status+'. Members can view the updated decision using /suggest view.');
      }
    }
    return response('Unknown community action.');
  } catch (e) {
    if(e instanceof Problem)return response(e.message);
    throw e;
  }
}
