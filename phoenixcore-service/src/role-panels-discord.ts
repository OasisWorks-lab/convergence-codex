import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {Problem,readSettings,actorFor,requireThat,discordId} from './domain.ts';
import {communityEnabled} from './community.ts';
import {createRolePanel,addRoleOption,removeRoleOption,publishRolePanel,listRolePanels,
  verifyAssignableRole,togglePanelRole} from './role-panels.ts';

const text=(name:string,description:string,required=true,max_length?:number)=>({name,type:3,description,required,...(max_length?{max_length}:{})});
const num=(name:string,description:string)=>({name,type:4,description,required:true,min_value:1,max_value:100000000});
const sub=(name:string,description:string,options:any[]=[])=>({name,type:1,description,options});
const panel=text('panel','Role panel UUID');
const revision=num('revision','Current role panel revision');
const role={name:'role',type:8,description:'Safe, ordinary Discord role',required:true};
export const roleCommands=()=>[{name:'roles',type:1,description:'Safe Convergence self-service roles and Owner panels.',options:[
  sub('list','See available role panels.'),
  sub('admin-create','Owner: create an unpublished role panel.',[
    {name:'channel',type:7,description:'Destination text or announcement channel',required:true},
    text('title','Panel title',true,120),
    {name:'style',type:3,description:'Role component style',required:true,choices:[{name:'Buttons (up to 5)',value:'buttons'},{name:'Select menu (up to 25)',value:'select'}]},
    text('description','Panel description',false,1500)]),
  sub('admin-add','Owner: add an eligible self-assignable role.',[panel,revision,role,text('label','Visible role label',true,80)]),
  sub('admin-remove','Owner: remove a role option.',[panel,revision,role]),
  sub('admin-publish','Owner: show or hide a role panel.',[panel,revision,{name:'enabled',type:5,description:'Publish role options',required:true}])
]}];
export const roleCommand=(name:string)=>name==='roles';
const reply=(content:string)=>({type:4,data:{flags:64,content:content.slice(0,1950),allowed_mentions:{parse:[]}}});
const pick=(xs:any[],name:string)=>xs.find(x=>x.name===name)?.value;
export async function roleInteraction(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return reply('Role panels work only in Convergence.');
  try{
    requireThat(await communityEnabled(db,'roles'),403,'Role panels are disabled by the Owner.');
    const {value:settings}=await readSettings(db),id=String(body.member.user.id),
      who=actorFor(id,body.member.roles||[],config.owner,settings),
      action=String(body.data?.options?.[0]?.name||''),opts=body.data?.options?.[0]?.options||[],
      value=(key:string)=>pick(opts,key);
    if(action==='list'){
      const list=await listRolePanels(db,who);
      return reply(list.length?list.slice(0,15).map(p=>'**'+p.title+'** · '+p.options.length+
        ' roles · '+(p.active?'Published':'Draft')+(p.messageId?' · <#'+p.channelId+'>':'')+
        '\n'+p.id).join('\n\n'):'No public role panels yet.');
    }
    requireThat(who.isOwner,403,'Only the configured Owner can manage role panel definitions.');
    if(action==='admin-create'){
      const channel=String(value('channel')||''),c=await discord.call('/channels/'+channel);
      requireThat(c?.id===channel&&c.guild_id===config.guild&&[0,5].includes(Number(c.type)),403,
        'Choose a Convergence text or announcement channel.');
      const result=await createRolePanel(db,who,{channelId:channel,title:value('title'),
        style:value('style'),description:value('description')||''});
      return reply('Draft role panel created. Add safe roles before publishing.\nPanel ID: '+result.id+'\nRevision: '+result.revision);
    }
    const panelId=String(value('panel')||''),v=Number(value('revision'));
    if(action==='admin-add'){
      const roleId=String(value('role')||'');
      const [roles,bot]=await Promise.all([
        discord.call('/guilds/'+config.guild+'/roles'),
        discord.call('/guilds/'+config.guild+'/members/'+config.clientId)
      ]);
      requireThat(Array.isArray(roles),503,'Unable to verify the current guild roles.');
      verifyAssignableRole(roleId,roles,bot,config,settings.judgeRole);
      const result=await addRoleOption(db,who,panelId,v,roleId,value('label'));
      return reply('Role option added. Panel revision '+result.revision+'.');
    }
    if(action==='admin-remove'){
      const result=await removeRoleOption(db,who,panelId,v,String(value('role')||''));
      return reply('Role option removed. Existing member roles were not stripped. Revision '+result.revision+'.');
    }
    if(action==='admin-publish'){
      const result=await publishRolePanel(db,who,panelId,v,value('enabled')===true);
      return reply('Panel is now '+(result.active?'published':'hidden')+'. Revision '+result.revision+
        '. PhoenixCore will update the original Discord panel message.');
    }
    return reply('Unknown role panel action.');
  }catch(error){return reply(error instanceof Problem?error.message:'Role panel action could not be completed. Check bot role permissions.');}
}
export async function roleComponent(db:Store,config:Config,body:any,discord:Pick<Discord,'call'>){
  if(body.guild_id!==config.guild||!body.member?.user?.id)return reply('Use this panel inside Convergence.');
  try{
    const match=/^pcr:([0-9a-f-]{36})(?::(\d{17,20}))?$/.exec(String(body.data?.custom_id||''));
    requireThat(match,400,'Unknown role panel control.');
    const roleId=String(match[2]||body.data?.values?.[0]||''),
      {value:settings}=await readSettings(db);
    requireThat(discordId.test(roleId),400,'Choose a role from the panel.');
    const result=await togglePanelRole(db,discord,config,body.member.user.id,match[1],roleId,
      String(body.id||''),String(body.message?.id||''),String(body.channel_id||''),settings.judgeRole);
    return reply('Role <@&'+roleId+'> '+(result.added?'assigned':'removed')+
      (result.replayed?' (previous interaction already applied).':'.'));
  }catch(error){return reply(error instanceof Problem?error.message:'Unable to update the selected role. Verify PhoenixCore role hierarchy and Manage Roles permission.');}
}
