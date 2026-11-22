import {Problem,requireThat} from './domain.ts';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {createPoll,transitionPoll,getPoll,listPolls,votePoll,pollIdPattern} from './polls.ts';
import {communityEnabled} from './community.ts';

const str=(name:string,description:string,required=true,max_length?:number)=>({
  type:3,name,description,required,...(max_length?{max_length}:{})
});
const int=(name:string,description:string,required=true,min_value=1,max_value=43200)=>({
  type:4,name,description,required,min_value,max_value
});
const bool=(name:string,description:string)=>({type:5,name,description,required:false});
const sub=(name:string,description:string,options:any[]=[])=>({type:1,name,description,options});
export const pollCommands=()=>[{
  name:'poll',type:1,description:'Persistent Convergence polls, voting and Owner controls.',
  options:[
    sub('list','List currently active Convergence polls.'),
    sub('results','Inspect public results for a poll.',[str('id','Saved poll ID')]),
    sub('admin-create','Owner: create a safe draft poll; publish it when ready.',[
      str('question','Poll question',true,200),
      str('options','Two to ten distinct answers, separated with a | character',true,1000),
      {type:7,name:'channel',description:'Convergence text channel for the public poll',required:true},
      int('minutes','Poll duration (1–43,200 minutes)',true,1,43200),
      {type:3,name:'mode',description:'Single or multiple answers',required:false,
        choices:[{name:'One answer',value:'single'},{name:'Multiple answers',value:'multiple'}]},
      bool('anonymous','Keep voter identity private in all public results'),
      bool('allow-change','Allow a member to revise their ballot'),
      bool('results-early','Publish answer totals while voting is open')
    ]),
    sub('admin-publish','Owner: publish an existing draft poll.',[
      str('id','Poll ID'),int('revision','Current poll revision',true,1,1000000)
    ]),
    sub('admin-close','Owner: close an open poll early.',[
      str('id','Poll ID'),int('revision','Current poll revision',true,1,1000000)
    ]),
    sub('admin-cancel','Owner: cancel a draft or live poll.',[
      str('id','Poll ID'),int('revision','Current poll revision',true,1,1000000)
    ])
  ]
}];
export const pollCommand=(name:string)=>name==='poll';
const reply=(content:string)=>({type:4,data:{content:content.slice(0,1950),flags:64,allowed_mentions:{parse:[]}}});
const option=(opts:any[],name:string)=>opts.find((o:any)=>o.name===name)?.value;
export async function pollInteraction(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return reply('Polls are only available in Convergence.');
  const userId=String(body.member.user.id),isOwner=userId===config.owner,
    action=body.data?.options?.[0]?.name,opts=body.data?.options?.[0]?.options||[],
    v=(name:string)=>option(opts,name);
  try{
    requireThat(await communityEnabled(db,'polls'),403,'Polls are disabled by the Convergence Owner.');
    const actor={id:userId,isOwner,isJudge:false,isPlayer:true};
    if(action==='list'){
      const all=(await listPolls(db,actor,50)).filter(x=>x.status==='active');
      return reply(all.length?all.slice(0,20).map(p=>
        '**'+p.question+'** · <#'+p.channelId+'> · <t:'+Math.floor(p.endsMs/1000)+':R>\n'+p.id).join('\n\n'):
        'No open polls currently exist.');
    }
    if(action==='results'){
      const p=await getPoll(db,String(v('id')||''),actor);
      return reply('**'+p.question+'** ('+p.status+')\n'+
        p.choices.map((text:string,i:number)=>(i+1)+'. '+text+
        (p.counts?' — '+p.counts[i]+' vote(s)':'')).join('\n')+
        '\n'+p.voters+' recorded voter(s)'+(!p.counts?' · Totals are hidden until close.':''));
    }
    requireThat(isOwner,403,'Only the configured Convergence Owner can create or manage polls.');
    if(action==='admin-create'){
      const channelId=String(v('channel')||''),channel=await discord.call('/channels/'+channelId);
      requireThat(channel?.guild_id===config.guild&&[0,5].includes(Number(channel.type)),400,
        'Select a Convergence text or announcement channel.');
      const choices=String(v('options')||'').split('|').map(x=>x.trim());
      const result=await createPoll(db,actor,{
        receipt:String(body.id||''),question:String(v('question')||''),description:'',choices,
        channelId,endsMs:Date.now()+Number(v('minutes')||0)*60000,
        mode:v('mode')==='multiple'?'multiple':'single',
        anonymous:v('anonymous')===true,allowChange:v('allow-change')!==false,
        resultsEarly:v('results-early')!==false,requiredRoles:[],excludedRoles:[]
      });
      return reply('Draft poll '+(result.created?'created':'already created')+
        '.\nPoll ID: '+result.id+'\nRevision: 1\nReview the draft in the PhoenixCore site or publish using /poll admin-publish. No message was sent yet.');
    }
    const id=String(v('id')||''),revision=Number(v('revision'));
    requireThat(pollIdPattern.test(id),400,'Choose a poll ID.');
    const transition=action==='admin-publish'?'publish':
      action==='admin-close'?'close':action==='admin-cancel'?'cancel':null;
    requireThat(transition,400,'Unknown poll action.');
    const result=await transitionPoll(db,actor,id,revision,transition);
    return reply('Poll is '+result.status+' (revision '+result.revision+
      '). PhoenixCore will update its public message through the persistent delivery worker.');
  }catch(error){
    return reply(error instanceof Problem?error.message:'The poll operation could not be confirmed. Review the current poll state before retrying.');
  }
}
export async function pollComponent(db:Store,config:Config,body:any){
  if(body.guild_id!==config.guild||!body.member?.user?.id||body.member.user.bot)
    return reply('Use this poll as a real Convergence member.');
  try{
    const custom=String(body.data?.custom_id||''),id=custom.slice('pcpoll:'.length);
    requireThat(custom.startsWith('pcpoll:')&&pollIdPattern.test(id),400,'Unknown poll ballot.');
    const p=await getPoll(db,id);
    requireThat(p.status==='active'&&p.channelId===String(body.channel_id||'')&&
      p.messageId===String(body.message?.id||''),409,'This voting panel is no longer active. Open the latest poll message.');
    const changed=await votePoll(db,id,String(body.member.user.id),body.member.roles||[],
      body.data?.values,String(body.id||''));
    return reply(changed.replayed?'Your earlier ballot was already saved.':
      changed.changed?'Your ballot has been recorded.' : 'Your selections were already recorded.');
  }catch(error){
    return reply(error instanceof Problem?error.message:
      'PhoenixCore could not confirm this ballot; retry only after verifying the public poll.');
  }
}
