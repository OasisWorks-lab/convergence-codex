import type {Store} from './db.ts';
import {staffIdentity} from './staff.ts';
import type {Discord,Config} from './discord.ts';
import {eligibleAssignee} from './support.ts';
import {readSettings,requireThat,discordId} from './domain.ts';

export async function liveSupportActor(db:Store,discord:Pick<Discord,'call'>,config:Config,id:string){
  requireThat(discordId.test(id),400,'Discord member ID is required.');
  const [member,roles,{value:settings}]=await Promise.all([
    discord.call('/guilds/'+config.guild+'/members/'+id),
    discord.call('/guilds/'+config.guild+'/roles'),
    readSettings(db)]);
  requireThat(member?.user?.id===id&&!member.user.bot&&Array.isArray(roles),403,'The current Convergence member and roles could not be verified.');
  const permissions=(member.roles||[]).reduce((bits:bigint,roleId:string)=>{
    const role=roles.find((r:any)=>r.id===roleId);
    return bits|BigInt(String(role?.permissions||'0'));
  },0n).toString();
  return staffIdentity(id,member.roles||[],permissions,config,settings.judgeRole);
}
export async function chooseSupportStaff(db:Store,discord:Discord,config:Config,helperRole:string,sensitive=false){
  if(sensitive)return config.owner;
  try{
    const [members,roles]=await Promise.all([discord.members(),discord.call('/guilds/'+config.guild+'/roles')]);
    const eligible=members.filter((member:any)=>member?.user&&!member.user.bot&&
      staffIdentity(member.user.id,member.roles||[],(member.roles||[]).reduce((bits:bigint,id:string)=>{
        const role=roles.find((r:any)=>r.id===id);return bits|BigInt(String(role?.permissions||'0'));
      },0n).toString(),config,helperRole).isHelper).map((m:any)=>m.user.id);
    return await eligibleAssignee(db,[config.owner,...eligible]);
  }catch{return config.owner;}
}
