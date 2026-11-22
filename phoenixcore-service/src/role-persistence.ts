import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {requireThat,discordId,readSettings} from './domain.ts';
import {communityEnabled} from './community.ts';
import {verifyAssignableRole} from './role-panels.ts';

export type RoleEvent={guildId:string;userId:string;channelId:string;messageId:string;emoji:string;added:boolean};

export async function applyRoleReaction(db:Store,discord:Pick<Discord,'call'>,config:Config,event:RoleEvent){
  requireThat(event.guildId===config.guild,403,'Reaction belongs to another server.');
  requireThat([event.userId,event.channelId,event.messageId].every(x=>discordId.test(x)),400,'Invalid Discord reaction.');
  requireThat(await communityEnabled(db,'roles'),403,'Role selection is disabled.');
  const [mapping]=await db.query(`SELECT p.id AS panel_id,p.active,p.channel_id,p.message_id,p.style,r.role_id
    FROM pc_role_panels p JOIN pc_role_reactions r ON r.panel_id=p.id
    JOIN pc_role_panel_options o ON o.panel_id=p.id AND o.role_id=r.role_id
    WHERE p.channel_id=$1 AND p.message_id=$2 AND r.emoji=$3`,
    [event.channelId,event.messageId,event.emoji]);
  requireThat(mapping&&Number(mapping.active)===1&&mapping.style==='reactions',403,'This is not an active reaction role.');
  const [{value:settings},roles,member,bot]=await Promise.all([
    readSettings(db),discord.call('/guilds/'+config.guild+'/roles'),
    discord.call('/guilds/'+config.guild+'/members/'+event.userId),
    discord.call('/guilds/'+config.guild+'/members/'+config.clientId)
  ]);
  requireThat(member?.user?.id===event.userId&&!member.user.bot&&Array.isArray(roles),403,'Invalid reaction member.');
  verifyAssignableRole(mapping.role_id,roles,bot,config,settings.judgeRole);
  const current=(member.roles||[]).includes(mapping.role_id);
  if(current!==event.added){
    await discord.call('/guilds/'+config.guild+'/members/'+event.userId+'/roles/'+mapping.role_id,
      {method:event.added?'PUT':'DELETE'});
  }
  await db.transaction(async q=>{
    const [fresh]=await q('SELECT active,message_id FROM pc_role_panels WHERE id=$1',[mapping.panel_id]);
    requireThat(fresh&&Number(fresh.active)===1&&fresh.message_id===event.messageId,409,'Panel changed while processing the reaction.');
    await q('INSERT INTO pc_role_assignments(panel_id,role_id,user_id,active,updated_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT(panel_id,role_id,user_id) DO UPDATE SET active=excluded.active,updated_ms=excluded.updated_ms',
      [mapping.panel_id,mapping.role_id,event.userId,event.added?1:0,Date.now()]);
    if(current!==event.added)await q('INSERT INTO pc_role_audit(id,actor_id,action,panel_id,role_id,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(),event.userId,event.added?'reaction-selected':'reaction-removed',mapping.panel_id,
        mapping.role_id,'Explicit Unicode emoji role selection',Date.now()]);
    if(!event.added)await q('DELETE FROM pc_role_sticky_snapshots WHERE user_id=$1 AND panel_id=$2 AND role_id=$3',
      [event.userId,mapping.panel_id,mapping.role_id]);
  });
  return {roleId:mapping.role_id,added:event.added,changed:current!==event.added};
}

export async function captureStickyRoles(db:Store,guildId:string,userId:string,roleIds:string[],config:Config){
  if(guildId!==config.guild||!discordId.test(userId)||!await communityEnabled(db,'roles'))return 0;
  const actual=new Set(roleIds);
  return db.transaction(async q=>{
    await q('DELETE FROM pc_role_sticky_snapshots WHERE user_id=$1',[userId]);
    const rows=await q(`SELECT a.panel_id,a.role_id FROM pc_role_assignments a
      JOIN pc_role_panels p ON p.id=a.panel_id JOIN pc_role_panel_options o ON o.panel_id=p.id AND o.role_id=a.role_id
      WHERE a.user_id=$1 AND a.active=1 AND p.active=1`,[userId]);
    const found=rows.filter(r=>actual.has(r.role_id));
    for(const row of found)await q('INSERT INTO pc_role_sticky_snapshots(user_id,panel_id,role_id,captured_ms) VALUES($1,$2,$3,$4)',
      [userId,row.panel_id,row.role_id,Date.now()]);
    return found.length;
  });
}

export async function restoreStickyRoles(db:Store,discord:Pick<Discord,'call'>,config:Config,guildId:string,userId:string){
  if(guildId!==config.guild||!discordId.test(userId)||!await communityEnabled(db,'roles'))return {restored:0,skipped:0};
  const rows=await db.query(`SELECT s.panel_id,s.role_id,p.active,a.active AS selected,o.role_id AS listed
    FROM pc_role_sticky_snapshots s LEFT JOIN pc_role_panels p ON s.panel_id=p.id
    LEFT JOIN pc_role_assignments a ON a.panel_id=s.panel_id AND a.role_id=s.role_id AND a.user_id=s.user_id
    LEFT JOIN pc_role_panel_options o ON o.panel_id=s.panel_id AND o.role_id=s.role_id WHERE s.user_id=$1`,[userId]);
  if(!rows.length)return {restored:0,skipped:0};
  const [{value:settings},roles,member,bot]=await Promise.all([
    readSettings(db),discord.call('/guilds/'+config.guild+'/roles'),
    discord.call('/guilds/'+config.guild+'/members/'+userId),
    discord.call('/guilds/'+config.guild+'/members/'+config.clientId)
  ]);
  requireThat(member?.user?.id===userId&&!member.user.bot&&Array.isArray(roles),403,'Member is not eligible for sticky roles.');
  let restored=0,skipped=0;
  for(const row of rows){
    let eligible=Number(row.active)===1&&Number(row.selected)===1&&row.listed===row.role_id;
    try{if(eligible)verifyAssignableRole(row.role_id,roles,bot,config,settings.judgeRole);}
    catch{eligible=false;}
    if(eligible){
      if(!(member.roles||[]).includes(row.role_id))
        await discord.call('/guilds/'+config.guild+'/members/'+userId+'/roles/'+row.role_id,{method:'PUT'});
      restored++;
    }else skipped++;
    await db.query('DELETE FROM pc_role_sticky_snapshots WHERE user_id=$1 AND panel_id=$2 AND role_id=$3',
      [userId,row.panel_id,row.role_id]);
  }
  return {restored,skipped};
}
