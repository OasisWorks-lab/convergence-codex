import {requireThat,discordId} from './domain.ts';
import type {Discord,Config} from './discord.ts';

export type StaffRank='owner'|'admin'|'helper'|'member';
export type StaffIdentity={id:string;rank:StaffRank;isOwner:boolean;isAdmin:boolean;isHelper:boolean;canModerate:boolean};
const adminBit=8n;
export const hasNativeAdmin=(permissions:unknown)=>/^\d+$/.test(String(permissions||'0'))&&(BigInt(String(permissions))&adminBit)!==0n;
export function staffIdentity(userId:string,roles:string[],permissions:string|undefined,config:Config,helperRole:string):StaffIdentity{
  const isOwner=userId===config.owner,isAdmin=isOwner||hasNativeAdmin(permissions),isHelper=isAdmin||!!helperRole&&roles.includes(helperRole);
  return {id:userId,rank:isOwner?'owner':isAdmin?'admin':isHelper?'helper':'member',isOwner,isAdmin,isHelper,canModerate:isAdmin};
}
export function requireModerator(identity:StaffIdentity){
  requireThat(identity.canModerate,403,'Only the Convergence Owner or a Discord Administrator can manage moderation cases.');
}
type Role={id:string;position:number;permissions:string};
const position=(memberships:string[],roles:Role[])=>roles.filter(x=>memberships.includes(x.id)).reduce((highest,role)=>Math.max(highest,Number(role.position)||0),0);
export async function verifyModerationTarget(discord:Pick<Discord,'call'>,config:Config,actor:StaffIdentity,targetId:string){
  requireModerator(actor);
  requireThat(discordId.test(targetId),400,'Choose a valid Discord member.');
  requireThat(targetId!==actor.id,403,'You cannot moderate yourself.');
  requireThat(targetId!==config.owner&&targetId!==config.clientId,403,'The server owner and PhoenixCore cannot be moderation targets.');
  const [guild,roles,target,staff,bot]=await Promise.all([
    discord.call('/guilds/'+config.guild),
    discord.call('/guilds/'+config.guild+'/roles'),
    discord.call('/guilds/'+config.guild+'/members/'+targetId),
    discord.call('/guilds/'+config.guild+'/members/'+actor.id),
    discord.call('/guilds/'+config.guild+'/members/'+config.clientId)]);
  requireThat(guild?.id===config.guild&&Array.isArray(roles)&&target?.user?.id===targetId&&staff?.user?.id===actor.id,
    403,'Unable to verify current guild roles and membership.');
  requireThat(!target.user?.bot,403,'Bots cannot be moderated using member case commands.');
  requireThat(targetId!==guild.owner_id,403,'The Discord server owner is protected.');
  const highest=position(target.roles||[],roles),staffTop=position(staff.roles||[],roles),botTop=position(bot?.roles||[],roles);
  const stillAdmin=actor.isOwner|| (staff.roles||[]).some((id:string)=>roles.some((r:Role)=>r.id===id&&hasNativeAdmin(r.permissions)));
  requireThat(stillAdmin,403,'You no longer have an active Discord Administrator role.');
  requireThat(actor.isOwner||staffTop>highest,403,'Target must be below your highest Discord role.');
  requireThat(bot?.user?.id===config.clientId&&botTop>highest,403,'Move the PhoenixCore bot role above the target member before recording staff actions.');
  return {staffRank:actor.rank,actorTop:staffTop,targetTop:highest,botTop};
}
