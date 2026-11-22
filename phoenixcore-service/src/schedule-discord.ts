import {Problem,requireThat,discordId} from './domain.ts';
import type {Store} from './db.ts';
import type {Config,Discord} from './discord.ts';
import {createSchedule,transitionSchedule,listSchedules,recoverSchedule} from './schedules.ts';
const str=(name:string,description:string,required=true,max_length?:number)=>({
  type:3,name,description,required,...(max_length?{max_length}:{})
});
const integer=(name:string,description:string,required:boolean,min_value:number,max_value:number)=>({
  type:4,name,description,required,min_value,max_value
});
const sub=(name:string,description:string,options:any[]=[])=>({type:1,name,description,options});
export const scheduleCommands=()=>[{
  type:1,name:'schedule',description:'Convergence Owner schedules and manual DISBOARD bump reminders.',
  options:[
    sub('admin-create','Owner: save a new announcement or human bump reminder draft.',[
      str('name','Schedule name',true,100),
      str('message','Message; optional for DISBOARD bump reminders',false,1800),
      {type:7,name:'channel',description:'Where the reminder or announcement will be posted',required:true},
      integer('delay','Minutes before the first delivery',true,1,525600),
      integer('interval','Minutes between deliveries; 0 for once',true,0,43200),
      integer('runs','Max deliveries; 0 for recurring indefinitely, 1 for once',true,0,365),
      {type:3,name:'kind',description:'Which type of scheduled message?',required:false,
        choices:[{name:'Regular announcement',value:'announcement'},
          {name:'DISBOARD human bump reminder',value:'bump-reminder'}]},
      {type:8,name:'mention-role',description:'Optional role to notify explicitly',required:false}
    ]),
    sub('admin-list','Owner: view saved schedules and the next delivery.'),
    sub('admin-publish','Owner: activate a draft schedule.',[
      str('id','Schedule ID'),integer('revision','Current revision',true,1,10000000)]),
    sub('admin-pause','Owner: pause future sends for a schedule.',[
      str('id','Schedule ID'),integer('revision','Current revision',true,1,10000000)]),
    sub('admin-resume','Owner: resume a paused schedule.',[
      str('id','Schedule ID'),integer('revision','Current revision',true,1,10000000)]),
    sub('admin-cancel','Owner: permanently cancel a saved schedule.',[
      str('id','Schedule ID'),integer('revision','Current revision',true,1,10000000)]),
    sub('admin-recover','Owner: manually retry or skip uncertain delivery.',[
      str('id','Schedule ID'),integer('revision','Current revision',true,1,10000000),
      {type:3,name:'choice',description:'Retry may duplicate a post. Or deliberately skip this occurrence.',
        required:true,choices:[{name:'Retry after checking Discord',value:'retry'},
          {name:'Skip this occurrence',value:'skip'}]}
    ])
  ]
}];
export const isScheduleCommand=(name:string)=>name==='schedule';
const reply=(content:string)=>({type:4,data:{content:content.slice(0,1950),flags:64,allowed_mentions:{parse:[]}}});
const pick=(opts:any[],name:string)=>opts.find((x:any)=>x.name===name)?.value;
export async function scheduleInteraction(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)
    return reply('Schedules can be configured only in Convergence.');
  const actor={id:String(body.member.user.id),isOwner:body.member.user.id===config.owner,
    isJudge:false,isPlayer:true};
  const group=body.data?.options?.[0],action=String(group?.name||''),
    options=group?.options||[],v=(key:string)=>pick(options,key);
  try{
    requireThat(actor.isOwner,403,'Only the configured Convergence Owner can manage server schedules.');
    if(action==='admin-list'){
      const all=await listSchedules(db,actor);
      return reply(all.length?all.slice(0,15).map(x=>'**'+x.name+'** · '+x.status+' · '+
        x.sentCount+' sent · <t:'+Math.floor(x.nextDueMs/1000)+':F>\n'+x.id+
        ' · revision '+x.revision).join('\n\n'):'No schedules have been created.');
    }
    if(action==='admin-create'){
      const channelId=String(v('channel')||''),channel=await discord.call('/channels/'+channelId),
        mentionRole=String(v('mention-role')||''),kind=v('kind')==='bump-reminder'?'bump-reminder':'announcement';
      requireThat(channel?.guild_id===config.guild&&[0,5].includes(Number(channel.type)),403,
        'Choose a Convergence text or announcement channel.');
      if(mentionRole){
        const roles=await discord.call('/guilds/'+config.guild+'/roles');
        requireThat(Array.isArray(roles)&&roles.some((x:any)=>x.id===mentionRole),403,
          'Choose a valid Convergence role to notify.');
      }
      const interval=Number(v('interval')),runs=Number(v('runs'));
      const result=await createSchedule(db,actor,{
        receipt:String(body.id||''),name:String(v('name')||''),body:String(v('message')||''),
        channelId,mentionRole,kind,firstDueMs:Date.now()+Number(v('delay'))*60000,
        intervalMinutes:interval,maxRuns:runs,style:'text'
      });
      return reply('Schedule '+(result.created?'draft created':'already exists')+
        '.\nID: '+result.id+'\nRevision: 1\nNo message was posted. Review and publish it through the website or /schedule admin-publish.');
    }
    const id=String(v('id')||''),revision=Number(v('revision'));
    if(action==='admin-recover'){
      const result=await recoverSchedule(db,actor,id,revision,String(v('choice')) as 'retry'|'skip');
      return reply('Owner recovery confirmed: '+result.recovery+
        '. If you selected retry, verify the original Discord channel for duplicates.');
    }
    const choice=action==='admin-publish'?'publish':action==='admin-pause'?'pause':
      action==='admin-resume'?'resume':action==='admin-cancel'?'cancel':null;
    requireThat(choice,400,'Unknown schedule action.');
    const result=await transitionSchedule(db,actor,id,revision,choice);
    return reply('Schedule '+result.status+' · revision '+result.revision+
      '. Bump reminders never perform a DISBOARD bump automatically.');
  }catch(error){return reply(error instanceof Problem?error.message:
    'Schedule operation could not be confirmed; inspect the current status before repeating it.');}
}
