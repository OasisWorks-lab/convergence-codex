import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {Problem,requireThat,readSettings} from './domain.ts';
import {communityEnabled} from './community.ts';
import {liveSupportActor} from './support-auth.ts';
import {staffIdentity} from './staff.ts';
import {createGiveaway,giveawayChannels,setGiveawayChannels,giveawayPublic,listGiveaways,giveawayEntry,
  concludeGiveaway,rerollGiveawaySlot,claimGiveaway,confirmManualPrize,manualGiveawayWinner,updateGiveawayStatus} from './giveaway.ts';

const text=(name:string,description:string,required=true,max_length?:number)=>({type:3,name,description,required,...(max_length?{max_length}:{})});
const integer=(name:string,description:string,min:number,max:number,required=true)=>({type:4,name,description,min_value:min,max_value:max,required});
const option=(name:string,description:string,options:any[]=[])=>({type:1,name,description,options});
const id=text('id','Giveaway ID');
const channel={name:'channel',type:7,description:'Designated giveaway channel',required:true};
export const giveawayCommands=()=>[
  {type:1,name:'giveaway',description:'Convergence giveaways with member-level entries and claim-time character rewards.',options:[
    option('channel-add','Owner: designate an allowed giveaway destination.',[channel]),
    option('channel-remove','Owner: remove an allowed destination.',[channel]),
    option('channels','Show configured giveaway destinations.'),
    option('create','Staff: create a giveaway in an allowed channel.',[
      text('title','Short giveaway title',true,120),
      {type:3,name:'prize',description:'Reward type',required:true,choices:[{name:'Zeni bank prize',value:'zeni'},{name:'Manual staff-delivered prize',value:'manual'}]},
      integer('duration-minutes','Entry time from start (minutes)',1,10080),
      integer('claim-minutes','Winner claim deadline in minutes (required)',1,43200),
      integer('winners','Number of unique winning members',1,25),
      text('amount-or-prize','Zeni amount or a description of the manual prize',true,240),
      text('description','Optional public details',false,1100),
      integer('start-in-minutes','Optional delayed start, 0 = now',0,10080,false)]),
    option('list','Show current and recent giveaways.'),
    option('view','Show a giveaway and its winners.',[id]),
    option('join','Enter one currently active giveaway.',[id]),
    option('withdraw','Withdraw your entry before a giveaway ends.',[id]),
    option('claim','Claim a Zeni prize for an approved character bank.',[id,text('character','Approved character UUID (not needed for manual prizes)',false,36)]),
    option('pause','Staff: suspend a giveaway entry window.',[id]),
    option('resume','Staff: resume a paused entry window.',[id]),
    option('end','Staff: end and draw eligible entrants now.',[id]),
    option('cancel','Staff: cancel before drawing.',[id]),
    option('reroll','Staff: replace an unclaimed winner, excluding previous winners.',[id,integer('slot','Winner position to reroll',1,25)]),
    option('manual-winner','Owner: explicitly select a nonrandom winner.',[id,{type:6,name:'member',description:'Eligible participating member',required:true}]),
    option('confirm','Staff: confirm an awarded manual prize was delivered.',[id,{type:6,name:'member',description:'Winner who requested the manual prize',required:true}])
  ]}
];
export const giveawayCommand=(name:string)=>name==='giveaway';
const out=(content:string)=>({type:4,data:{flags:64,content:content.slice(0,1950),allowed_mentions:{parse:[]}}});
const opt=(options:any[],key:string)=>options.find((o:any)=>o.name===key)?.value;
export async function giveawayInteraction(db:Store,config:Config,body:any,discord:Discord){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return out('Giveaways are available only in Convergence.');
  const me=String(body.member.user.id),action=String(body.data?.options?.[0]?.name||'');
  const options=body.data?.options?.[0]?.options||[],value=(key:string)=>opt(options,key),id=String(value('id')||'');
  try{
    if(!await communityEnabled(db,'giveaways'))return out('Giveaways are disabled by the Owner.');
    const management=['channel-add','channel-remove','create','pause','resume','end','cancel','reroll','manual-winner','confirm'];
    const staff=management.includes(action)?await liveSupportActor(db,discord,config,me):null;
    if(staff)requireThat(staff.isHelper,403,'Only Owner, Admin and Helper may manage giveaways.');
    if(action==='channel-add'||action==='channel-remove'){
      requireThat(staff?.isOwner,403,'Only the Owner may set giveaway channels.');
      const selected=String(value('channel')||''),c=await discord.guildChannel(selected);
      requireThat(c.guild_id===config.guild&&[0,5,15].includes(Number(c.type)),400,'Use a Convergence text or announcement channel.');
      const previous=await giveawayChannels(db),set=new Set(previous.channels);
      if(action==='channel-add')set.add(selected);else set.delete(selected);
      const updated=await setGiveawayChannels(db,staff,[...set],previous.revision);
      return out('Allowed giveaway destinations updated. '+updated.channels.length+' channel(s) configured.');
    }
    if(action==='channels'){
      const channels=await giveawayChannels(db);
      return out(channels.channels.length?'Allowed channels:\n'+channels.channels.map(x=>'<#'+x+'>').join('\n'):
        'No giveaway channels designated yet. The Owner must use /giveaway channel-add before creation.');
    }
    if(action==='create'){
      const now=Date.now(),start=now+Number(value('start-in-minutes')||0)*60000,
        prize=String(value('prize')||'');
      const amountOrPrize=String(value('amount-or-prize')||'');
      const response=await createGiveaway(db,staff!,{
        receipt:String(body.id||randomUUID()),channelId:String(body.channel_id),title:String(value('title')||''),
        description:String(value('description')||''),startsMs:start,
        endsMs:start+Number(value('duration-minutes'))*60000,
        claimDurationMs:Number(value('claim-minutes'))*60000,winnerCount:Number(value('winners')),
        prizeKind:prize as any,zeniAmount:prize==='zeni'?amountOrPrize:undefined,prizeText:prize==='manual'?amountOrPrize:''
      },now);
      return out('Giveaway '+(response.created?'created':'already registered')+' in <#'+body.channel_id+'>.\nID: '+response.id+
        '\nPhoenixCore will post one public entry embed. Use /giveaway view to check its status.');
    }
    if(action==='list'){
      const all=await listGiveaways(db,15);
      return out(all.length?all.map(g=>g.id+' · '+g.title+' · '+g.status+' · '+g.entries+' entrant(s)').join('\n'):'No giveaways yet.');
    }
    if(action==='view'){
      const g=await giveawayPublic(db,id);
      const current=g.winners.filter(w=>w.status!=='expired');
      return out('**'+g.title+'** · '+g.status+'\nGiveaway: '+g.id+'\nPrize: '+(g.prizeKind==='zeni'?g.zeniAmount+' Zeni (character bank)':g.prizeText)+
        '\nEntries: '+g.entries+' · Unique winners: '+g.winnerCount+
        '\nEnds: <t:'+Math.floor(g.endsMs/1000)+':F>\nCurrent winners:\n'+
        (current.length?current.map(w=>'<@'+w.user_id+'> · '+w.status).join('\n'):'Awaiting drawing.'));
    }
    if(action==='join'||action==='withdraw'){
      const g=await giveawayPublic(db,id);
      requireThat(body.channel_id===g.channelId,403,'Enter or withdraw in the giveaway’s designated channel.');
      const member=await discord.call('/guilds/'+config.guild+'/members/'+me);
      const result=await giveawayEntry(db,id,me,member,action==='join');
      return out(action==='join'?(result.changed?'Entry confirmed.':'You are already entered.'):'Entry withdrawn.');
    }
    if(action==='claim'){
      const member=await discord.call('/guilds/'+config.guild+'/members/'+me);
      requireThat(member?.user?.id===me,403,'Confirm your current Convergence membership before claiming.');
      const result=await claimGiveaway(db,id,me,value('character')?String(value('character')):undefined);
      return out(result.replayed?'Claim already recorded.':
        result.pending?'Manual prize requested. Staff must confirm delivery.':'Zeni prize deposited into your chosen approved character bank.');
    }
    if(['pause','resume','cancel'].includes(action)){
      const result=await updateGiveawayStatus(db,id,staff!,action as 'pause'|'resume'|'cancel');
      return out('Giveaway '+result.id+' is now '+result.status+'.');
    }
    if(action==='end'){
      const result=await concludeGiveaway(db,id,me,userId=>discord.call('/guilds/'+config.guild+'/members/'+userId));
      return out(result.drawn?'Draw completed. '+result.winners.length+' unique winners. Member claims are now open.':
        'This giveaway had already been drawn.');
    }
    if(action==='reroll'){
      const r=await rerollGiveawaySlot(db,id,Number(value('slot')),me,userId=>discord.call('/guilds/'+config.guild+'/members/'+userId));
      return out(r.exhausted?'No additional eligible entrants. The slot is exhausted.':'Reroll selected a new, previously unselected member for slot '+r.slot+'.');
    }
    if(action==='manual-winner'){
      const r=await manualGiveawayWinner(db,id,staff!,String(value('member')||''));
      return out('**MANUAL (NOT RANDOM)** winner <@'+r.winner+'> was added to this giveaway.');
    }
    if(action==='confirm'){
      const r=await confirmManualPrize(db,id,staff!,String(value('member')||''));
      return out(r.replayed?'Manual prize was already confirmed.':'Manual prize delivery confirmed and audited.');
    }
    return out('Unknown giveaway action.');
  }catch(error){
    if(error instanceof Problem)return out(error.message);
    return out('Giveaway action could not be completed. Check Discord permissions and the bot logs.');
  }
}
export async function giveawayButton(db:Store,config:Config,body:any,discord:Discord){
  const action=/^pcg:(enter|leave):([0-9a-f-]{36})$/.exec(String(body.data?.custom_id||''));
  if(!action)return out('Unknown giveaway button.');
  if(body.guild_id!==config.guild||!body.member?.user?.id)return out('Use this in Convergence.');
  if(!await communityEnabled(db,'giveaways'))return out('Giveaways are disabled.');
  try{
    const id=action[2],g=await giveawayPublic(db,id);
    requireThat(body.channel_id===g.channelId,403,'This giveaway is not active in this channel.');
    const member=await discord.call('/guilds/'+config.guild+'/members/'+body.member.user.id);
    const result=await giveawayEntry(db,id,body.member.user.id,member,action[1]==='enter');
    return out(action[1]==='enter'?(result.changed?'Your entry was recorded.':'Already entered.'):
      (result.changed?'You have withdrawn your entry.':'Not currently entered.'));
  }catch(error){return out(error instanceof Problem?error.message:'Unable to verify giveaway eligibility.');}
}
