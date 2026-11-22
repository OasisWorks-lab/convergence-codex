import {createHash,randomUUID} from 'node:crypto';
import type {Store,Query} from './db.ts';
import {requireThat,textValue,discordId,type Actor} from './domain.ts';
import type {Discord,Config} from './discord.ts';
import {DiscordFailure} from './discord.ts';
import {communityEnabled} from './community.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeImage=(value:unknown)=>{
  const url=String(value||'').trim();
  requireThat(!url||url.length<=600&&/^https:\/\/[^\\s@/]+(?:\/[^\\s]*)?$/i.test(url),400,'Use an HTTPS image URL without embedded credentials.');
  return url;
};
const emojiPattern=/^(?!\s)[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Component}\u200d\ufe0f]{1,16}$/u;

const id=(value:unknown,label:string)=>{
  requireThat(typeof value==='string'&&uuid.test(value),400,'Choose a valid '+label+' ID.');
  return value;
};
const ownerOnly=(actor:Actor)=>requireThat(actor.isOwner,403,'Only the configured Convergence Owner may configure role panels.');
const audit=async(q:Query,actor:string,action:string,panel:string,role:string|null,detail:string)=>
  q('INSERT INTO pc_role_audit(id,actor_id,action,panel_id,role_id,detail,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(),actor,action,panel,role,detail.slice(0,350),Date.now()]);
const privileged=[1n,2n,3n,4n,5n,7n,13n,17n,27n,28n,29n,30n,33n,34n,40n];
const restricted=privileged.reduce((mask,bit)=>mask|(1n<<bit),0n);
const rank=(member:any,roles:any[])=>roles.filter(r=>(member?.roles||[]).includes(r.id)).reduce((a,r)=>Math.max(a,Number(r.position)||0),0);
export function verifyAssignableRole(roleId:string,roles:any[],bot:any,config:Config,protectedRole=''){
  requireThat(discordId.test(roleId),400,'Choose a valid Discord role.');
  const role=roles.find(r=>r.id===roleId);
  requireThat(role&&role.id!==config.guild&&role.id!==protectedRole&&!role.managed,403,
    'This role cannot be offered for self-service selection.');
  requireThat(/^\d+$/.test(String(role.permissions||'0'))&&
    (BigInt(String(role.permissions))&restricted)===0n,403,'Roles with staff or security privileges cannot be self-assigned.');
  requireThat(bot?.user?.id===config.clientId&&Number(role.position)<rank(bot,roles),403,
    'PhoenixCore’s role must be above every selectable role.');
  return role;
}
const dirty=async(q:Query,panel:string)=>q('UPDATE pc_role_panels SET revision=revision+1,retry_ms=0 WHERE id=$1',[panel]);
export async function createRolePanel(db:Store,actor:Actor,data:any){
  ownerOnly(actor);
  requireThat(data&&typeof data==='object'&&!Array.isArray(data),400,'Provide role panel details.');
  const title=textValue(data.title,120,'Panel title',true),
    description=textValue(data.description||'',1500,'Panel description');
  requireThat(typeof data.channelId==='string'&&discordId.test(data.channelId),400,'Choose a Convergence text channel.');
  requireThat(['buttons','select','reactions'].includes(data.style),400,'Choose buttons or select menu.');
  const color=data.color===undefined?0xA86BD2:Number(data.color);
  requireThat(Number.isInteger(color)&&color>=0&&color<=0xFFFFFF,400,'Color must be a Discord embed color number.');
  const panelId=randomUUID();
  await db.transaction(async q=>{
    await q('INSERT INTO pc_role_panels(id,channel_id,title,description,style,color,creator_id,created_ms,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [panelId,data.channelId,title,description,data.style,color,actor.id,Date.now(),safeImage(data.imageUrl)]);
    await audit(q,actor.id,'create',panelId,null,title);
  });
  return {id:panelId,revision:1,active:false};
}
async function lockedPanel(q:Query,db:Store,panelId:string){
  const [panel]=await q('SELECT * FROM pc_role_panels WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[panelId]);
  requireThat(panel,404,'Role panel not found.');
  return panel;
}
const checkVersion=(panel:any,expected:number)=>{
  requireThat(Number.isSafeInteger(expected)&&expected>=1,400,'Choose a valid current panel revision.');
  requireThat(Number(panel.revision)===expected,409,'This panel has changed. Refresh before editing.');
};
export async function addRoleOption(db:Store,actor:Actor,panelId:string,expected:number,roleId:string,label:unknown){
  ownerOnly(actor);id(panelId,'panel');requireThat(discordId.test(roleId),400,'Choose a Discord role.');
  const display=textValue(label,80,'Role label',true);
  return db.transaction(async q=>{
    const panel=await lockedPanel(q,db,panelId);checkVersion(panel,expected);
    const options=await q('SELECT role_id,position FROM pc_role_panel_options WHERE panel_id=$1 ORDER BY position',[panelId]);
    requireThat(options.length<(panel.style==='buttons'?5:panel.style==='reactions'?20:25),409,'This panel has reached its Discord component limit.');
    requireThat(!options.some(x=>x.role_id===roleId),409,'This role already appears on the panel.');
    await q('INSERT INTO pc_role_panel_options(panel_id,role_id,label,position) VALUES($1,$2,$3,$4)',
      [panelId,roleId,display,options.length]);
    await dirty(q,panelId);
    await audit(q,actor.id,'role-added',panelId,roleId,display);
    return {id:panelId,revision:expected+1};
  });
}
export async function removeRoleOption(db:Store,actor:Actor,panelId:string,expected:number,roleId:string){
  ownerOnly(actor);id(panelId,'panel');requireThat(discordId.test(roleId),400,'Choose a Discord role.');
  return db.transaction(async q=>{
    const panel=await lockedPanel(q,db,panelId);checkVersion(panel,expected);
    const removed=await q('DELETE FROM pc_role_panel_options WHERE panel_id=$1 AND role_id=$2 RETURNING role_id',[panelId,roleId]);
    requireThat(removed.length,404,'Role option not found.');
    await dirty(q,panelId);
    await audit(q,actor.id,'role-removed',panelId,roleId,'Option removed; existing roles are not stripped.');
    return {id:panelId,revision:expected+1};
  });
}
export async function publishRolePanel(db:Store,actor:Actor,panelId:string,expected:number,active:boolean){
  ownerOnly(actor);id(panelId,'panel');requireThat(typeof active==='boolean',400,'Choose published or hidden.');
  return db.transaction(async q=>{
    const panel=await lockedPanel(q,db,panelId);checkVersion(panel,expected);
    if(active){
      const [count]=await q('SELECT COUNT(*) AS count FROM pc_role_panel_options WHERE panel_id=$1',[panelId]);
      requireThat(Number(count.count)>0,409,'Add a safe role before publishing this panel.');
      if(panel.style==='reactions'){
        const [mapped]=await q('SELECT COUNT(*) AS count FROM pc_role_reactions WHERE panel_id=$1',[panelId]);
        requireThat(Number(mapped.count)===Number(count.count),409,'Map a unique emoji to every role before publishing a reaction panel.');
      }
    }
    await q('UPDATE pc_role_panels SET active=$1 WHERE id=$2',[active?1:0,panelId]);
    await dirty(q,panelId);
    await audit(q,actor.id,active?'publish':'hide',panelId,null,active?'Published':'Disabled');
    return {id:panelId,revision:expected+1,active};
  });
}
export async function listRolePanels(db:Store,actor:Actor){
  const panels=await db.query('SELECT * FROM pc_role_panels ORDER BY created_ms DESC,id');
  const [options,counts,reactions]=await Promise.all([
    db.query('SELECT panel_id,role_id,label,position FROM pc_role_panel_options ORDER BY panel_id,position'),
    db.query('SELECT panel_id,role_id,COUNT(*) AS total FROM pc_role_assignments WHERE active=1 GROUP BY panel_id,role_id'),
    db.query('SELECT panel_id,role_id,emoji FROM pc_role_reactions ORDER BY panel_id,role_id')
  ]);
  return panels.filter(panel=>actor.isOwner||Number(panel.active)===1).map(panel=>({
    id:panel.id,channelId:panel.channel_id,title:panel.title,description:panel.description,
    style:panel.style,color:Number(panel.color),imageUrl:panel.image_url||'',active:Number(panel.active)===1,
    revision:Number(panel.revision),messageId:panel.message_id||null,
    options:options.filter(option=>option.panel_id===panel.id).map(option=>({
      roleId:option.role_id,label:option.label,emoji:reactions.find(x=>x.panel_id===panel.id&&x.role_id===option.role_id)?.emoji||'',position:Number(option.position),
      recordedSelections:Number(counts.find(c=>c.panel_id===panel.id&&c.role_id===option.role_id)?.total||0)
    }))
  }));
}
export function rolePanelMessage(panel:any,enabled=true){
  const components=panel.active&&enabled&&panel.options.length&&panel.style!=='reactions'?
    panel.style==='buttons'?[{type:1,components:panel.options.map((o:any)=>({
      type:2,style:2,label:String(o.label).slice(0,80),custom_id:'pcr:'+panel.id+':'+o.roleId
    }))}]:
      [{type:1,components:[{type:3,custom_id:'pcr:'+panel.id,min_values:1,max_values:1,
        placeholder:'Choose a role to toggle',
        options:panel.options.map((o:any)=>({label:String(o.label).slice(0,100),value:o.roleId}))}]}]:[];
  return {content:'',allowed_mentions:{parse:[]},
    embeds:[{title:panel.title,description:(panel.description||'Choose a role to assign or remove.')+(panel.style==='reactions'?'\n\n'+panel.options.map((o:any)=>o.emoji?o.emoji+' · '+o.label:'[No emoji] · '+o.label).join('\n'):''),
      color:panel.color,...(panel.imageUrl?{image:{url:panel.imageUrl}}:{}),
      footer:{text:panel.active&&enabled?'PhoenixCore · Choose again to remove a role':'Role selections are currently disabled'}}],
    components};
}

export async function styleRolePanel(db:Store,actor:Actor,panelId:string,revision:number,input:any){
  ownerOnly(actor);id(panelId,'panel');
  requireThat(input&&typeof input==='object',400,'Provide a role panel appearance.');
  const title=textValue(input.title,120,'Panel title',true),
    description=textValue(input.description||'',1500,'Panel description');
  const color=Number(input.color);
  requireThat(Number.isInteger(color)&&color>=0&&color<=0xffffff,400,'Invalid panel color.');
  const imageUrl=safeImage(input.imageUrl);
  return db.transaction(async q=>{
    const panel=await lockedPanel(q,db,panelId);checkVersion(panel,revision);
    await q('UPDATE pc_role_panels SET title=$1,description=$2,color=$3,image_url=$4 WHERE id=$5',
      [title,description,color,imageUrl,panelId]);
    await dirty(q,panelId);await audit(q,actor.id,'appearance',panelId,null,title);
    return {id:panelId,revision:revision+1};
  });
}
export async function setRoleReaction(db:Store,actor:Actor,panelId:string,revision:number,roleId:string,emoji:string){
  ownerOnly(actor);id(panelId,'panel');requireThat(discordId.test(roleId),400,'Invalid role.');
  requireThat(emojiPattern.test(emoji),400,'Choose one Unicode emoji (custom server emojis are not supported yet).');
  return db.transaction(async q=>{
    const panel=await lockedPanel(q,db,panelId);checkVersion(panel,revision);
    requireThat(panel.style==='reactions',409,'Choose a reaction-based panel.');
    const [option]=await q('SELECT role_id FROM pc_role_panel_options WHERE panel_id=$1 AND role_id=$2',[panelId,roleId]);
    requireThat(option,404,'Add the role option before configuring its emoji.');
    const [taken]=await q('SELECT role_id FROM pc_role_reactions WHERE panel_id=$1 AND emoji=$2',[panelId,emoji]);
    requireThat(!taken||taken.role_id===roleId,409,'Another role uses that emoji.');
    await q('INSERT INTO pc_role_reactions(panel_id,role_id,emoji) VALUES($1,$2,$3) ON CONFLICT(panel_id,role_id) DO UPDATE SET emoji=excluded.emoji',
      [panelId,roleId,emoji]);
    await dirty(q,panelId);await audit(q,actor.id,'reaction-emoji',panelId,roleId,emoji);
    return {id:panelId,revision:revision+1};
  });
}
export async function deliverRolePanel(db:Store,discord:Pick<Discord,'call'>,now=Date.now()){
  const token=randomUUID();
  const row=await db.transaction(async q=>{
    const [panel]=await q('SELECT * FROM pc_role_panels WHERE revision>delivered_revision AND retry_ms<=$1 AND lease_until<=$1 ORDER BY created_ms LIMIT 1'+
      (db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''),[now]);
    if(!panel)return null;
    await q('UPDATE pc_role_panels SET lease=$1,lease_until=$2 WHERE id=$3',[token,now+45000,panel.id]);
    return panel;
  });
  if(!row)return false;
  try{
    const actor={id:row.creator_id,isOwner:true,isJudge:true,isPlayer:true},panel=(await listRolePanels(db,actor)).find(p=>p.id===row.id)!,
      enabled=await communityEnabled(db,'roles'),payload:any=rolePanelMessage(panel,enabled);
    if(!row.message_id){
      if(!panel.active){
        await db.query('UPDATE pc_role_panels SET delivered_revision=$1,lease=NULL,lease_until=0 WHERE id=$2 AND lease=$3',
          [row.revision,row.id,token]);
        return true;
      }
      payload.nonce=createHash('sha256').update('role-panel:'+panel.id).digest('base64url').slice(0,24);
      payload.enforce_nonce=true;
    }
    let message;
    try{
      message=await discord.call('/channels/'+panel.channelId+'/messages'+(row.message_id?'/'+row.message_id:''),{
        method:row.message_id?'PATCH':'POST',body:JSON.stringify(payload)});
    }catch(e){
      if(row.message_id&&e instanceof DiscordFailure&&e.status===404){
        await db.query('UPDATE pc_role_panels SET message_id=NULL,delivered_revision=0,retry_ms=0,lease=NULL,lease_until=0 WHERE id=$1 AND lease=$2',[row.id,token]);
        return true;
      }
      throw e;
    }
    const messageId=String(message?.id||row.message_id||'');
    requireThat(discordId.test(messageId),502,'Discord did not confirm the role panel.');
    if(panel.active&&enabled&&panel.style==='reactions'){
      const mapped=panel.options.filter((x:any)=>x.emoji);
      requireThat(mapped.length===panel.options.length,409,'Configure each reaction emoji before publishing this panel.');
      for(const option of mapped)await discord.call('/channels/'+panel.channelId+'/messages/'+messageId+
        '/reactions/'+encodeURIComponent(option.emoji)+'/@me',{method:'PUT'});
    }
    await db.query('UPDATE pc_role_panels SET message_id=$1,delivered_revision=$2,lease=NULL,lease_until=0,retry_ms=0,last_error=NULL WHERE id=$3 AND lease=$4',
      [messageId,Number(row.revision),panel.id,token]);
  }catch(error:any){
    const delay=error instanceof DiscordFailure?error.retryMs:0;
    await db.query('UPDATE pc_role_panels SET retry_ms=$1,lease=NULL,lease_until=0,last_error=$2 WHERE id=$3 AND lease=$4',
      [now+Math.max(delay||0,30000),error instanceof DiscordFailure?'Discord HTTP '+error.status:'Role panel delivery failed',row.id,token]);
  }
  return true;
}
export async function togglePanelRole(db:Store,discord:Pick<Discord,'call'>,config:Config,who:string,
  panelId:string,roleId:string,receiptId:string,messageId:string,channelId:string,protectedHelperRole:string){
  id(panelId,'panel');
  requireThat(discordId.test(who)&&discordId.test(roleId)&&discordId.test(messageId)&&discordId.test(channelId),400,'Invalid Discord role action.');
  requireThat(discordId.test(receiptId),400,'Invalid Discord interaction receipt.');
  requireThat(await communityEnabled(db,'roles'),403,'Role panels were disabled by the Owner.');
  const [panel]=await db.query('SELECT * FROM pc_role_panels WHERE id=$1',[panelId]);
  requireThat(panel&&Number(panel.active)===1&&panel.message_id===messageId&&panel.channel_id===channelId,403,'This role panel is no longer active.');
  const [option]=await db.query('SELECT role_id FROM pc_role_panel_options WHERE panel_id=$1 AND role_id=$2',[panelId,roleId]);
  requireThat(option,403,'This role is no longer available from this panel.');
  const [roles,member,bot]=await Promise.all([
    discord.call('/guilds/'+config.guild+'/roles'),
    discord.call('/guilds/'+config.guild+'/members/'+who),
    discord.call('/guilds/'+config.guild+'/members/'+config.clientId)
  ]);
  requireThat(member?.user?.id===who&&!member.user.bot&&Array.isArray(roles),403,'Verify current Discord membership before selecting a role.');
  verifyAssignableRole(roleId,roles,bot,config,protectedHelperRole);
  const saved=await db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',['role-receipt:'+receiptId]);
    const [old]=await q('SELECT * FROM pc_role_receipts WHERE id=$1',[receiptId]);
    if(old){
      requireThat(old.user_id===who&&old.panel_id===panelId&&old.role_id===roleId,409,'Role request receipt mismatch.');
      return {desired:Number(old.desired)===1,done:old.status==='done',replayed:true};
    }
    const desired=!(member.roles||[]).includes(roleId);
    await q('INSERT INTO pc_role_receipts(id,panel_id,role_id,user_id,desired,status,created_ms,updated_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',
      [receiptId,panelId,roleId,who,desired?1:0,'pending',Date.now()]);
    return {desired,done:false,replayed:false};
  });
  if(saved.done)return {added:saved.desired,replayed:true};
  try{
    await discord.call('/guilds/'+config.guild+'/members/'+who+'/roles/'+roleId,{method:saved.desired?'PUT':'DELETE'});
    await db.transaction(async q=>{
      const [receipt]=await q('SELECT status FROM pc_role_receipts WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[receiptId]);
      if(receipt?.status==='done')return;
      await q("UPDATE pc_role_receipts SET status='done',last_error=NULL,updated_ms=$1 WHERE id=$2",[Date.now(),receiptId]);
      await q('INSERT INTO pc_role_assignments(panel_id,role_id,user_id,active,updated_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT(panel_id,role_id,user_id) DO UPDATE SET active=excluded.active,updated_ms=excluded.updated_ms',
        [panelId,roleId,who,saved.desired?1:0,Date.now()]);
      await audit(q,who,saved.desired?'selected':'unselected',panelId,roleId,'Self-service role selection');
    });
    return {added:saved.desired,replayed:saved.replayed};
  }catch(error){
    await db.query("UPDATE pc_role_receipts SET status='failed',last_error=$1,updated_ms=$2 WHERE id=$3 AND status!='done'",
      [error instanceof DiscordFailure?'Discord HTTP '+error.status:'Discord role update failed',Date.now(),receiptId]);
    throw error;
  }
}
