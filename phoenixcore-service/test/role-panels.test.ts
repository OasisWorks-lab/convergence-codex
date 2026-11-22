import test from 'node:test';
import assert from 'node:assert/strict';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import type {Actor} from '../src/domain.ts';
import {randomUUID} from 'node:crypto';
import {communitySetModule} from '../src/community.ts';
import {createRolePanel,addRoleOption,removeRoleOption,publishRolePanel,
  listRolePanels,verifyAssignableRole,togglePanelRole,rolePanelMessage,deliverRolePanel} from '../src/role-panels.ts';
import {roleCommands,roleInteraction,roleComponent} from '../src/role-panels-discord.ts';

const guild='920000000000000001',ownerId='920000000000000002',
  memberId='920000000000000003',botId='920000000000000004',channel='920000000000000005',
  ordinaryRole='920000000000000006',botRole='920000000000000007',helperRole='920000000000000008',
  staffRole='920000000000000009';
const config:any={guild,owner:ownerId,clientId:botId};
const owner:Actor={id:ownerId,isOwner:true,isJudge:true,isPlayer:true},
  player:Actor={id:memberId,isOwner:false,isJudge:false,isPlayer:true};
const roles=[
  {id:ordinaryRole,name:'World Traveler',position:2,permissions:'1024',managed:false},
  {id:staffRole,name:'Moderator',position:3,permissions:'268435456',managed:false},
  {id:helperRole,name:'Helper',position:4,permissions:'0',managed:false},
  {id:botRole,name:'PhoenixCore',position:20,permissions:'268435456',managed:false}
];
const bot={user:{id:botId},roles:[botRole]};
async function setup(t:any){
  const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());
  return db;
}
async function panel(db:any,style='buttons'){
  const p=await createRolePanel(db,owner,{channelId:channel,title:'Choose your role',description:'Member badges',style});
  const added=await addRoleOption(db,owner,p.id,1,ordinaryRole,'World Traveler');
  const published=await publishRolePanel(db,owner,p.id,added.revision,true);
  return {...p,revision:published.revision};
}
test('only the Owner manages drafts, role options and publication using revision checks',async t=>{
  const db=await setup(t);
  await assert.rejects(createRolePanel(db,player,{channelId:channel,title:'No',style:'buttons'}),{status:403});
  const p=await createRolePanel(db,owner,{channelId:channel,title:'Choose a community badge',style:'buttons',color:0xAA33AA});
  assert.equal((await listRolePanels(db,player)).length,0);
  await assert.rejects(publishRolePanel(db,owner,p.id,1,true),{status:409});
  await assert.rejects(addRoleOption(db,player,p.id,1,ordinaryRole,'Traveler'),{status:403});
  const added=await addRoleOption(db,owner,p.id,1,ordinaryRole,'Traveler');
  assert.equal(added.revision,2);
  await assert.rejects(addRoleOption(db,owner,p.id,1,staffRole,'Staff'),{status:409});
  const published=await publishRolePanel(db,owner,p.id,2,true);
  assert.equal(published.active,true);
  assert.equal((await listRolePanels(db,player))[0].options[0].roleId,ordinaryRole);
  assert.equal(rolePanelMessage((await listRolePanels(db,owner))[0]).components[0].components[0].type,2);
  await assert.rejects(removeRoleOption(db,player,p.id,3,ordinaryRole),{status:403});
  assert.equal((await removeRoleOption(db,owner,p.id,3,ordinaryRole)).revision,4);
  assert.equal((await publishRolePanel(db,owner,p.id,4,false)).active,false);
  assert.equal((await listRolePanels(db,player)).length,0);
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM pc_role_audit'))[0].total,5);
});
test('roles with Discord moderation privileges, managed IDs or hierarchy conflicts are rejected',async()=>{
  assert.equal(verifyAssignableRole(ordinaryRole,roles,bot,config,helperRole).id,ordinaryRole);
  assert.throws(()=>verifyAssignableRole(staffRole,roles,bot,config,helperRole),{status:403});
  assert.throws(()=>verifyAssignableRole(helperRole,roles,bot,config,helperRole),{status:403});
  assert.throws(()=>verifyAssignableRole(guild,roles,bot,config,helperRole),{status:403});
  assert.throws(()=>verifyAssignableRole(ordinaryRole,roles,{...bot,roles:[]},config,helperRole),{status:403});
  assert.throws(()=>verifyAssignableRole(ordinaryRole,
    roles.map(r=>r.id===ordinaryRole?{...r,managed:true}:r),bot,config,helperRole),{status:403});
  assert.throws(()=>verifyAssignableRole(ordinaryRole,
    roles.map(r=>r.id===ordinaryRole?{...r,position:99}:r),bot,config,helperRole),{status:403});
});
test('single role interaction toggles with live membership and cannot replay into a second flip',async t=>{
  const db=await setup(t),p=await panel(db),messageId='920000000000000020';
  await db.query('UPDATE pc_role_panels SET message_id=$1 WHERE id=$2',[messageId,p.id]);
  const current:any={user:{id:memberId,bot:false},roles:[]};
  let writes=0;
  const discord:any={call:async(path:string,init:any={})=>{
    if(path.endsWith('/roles'))return roles;
    if(path.endsWith('/members/'+memberId))return current;
    if(path.endsWith('/members/'+botId))return bot;
    if(path.endsWith('/roles/'+ordinaryRole)){
      writes++;
      current.roles=init.method==='PUT'?[ordinaryRole]:[];
      return null;
    }
    throw Error('Unexpected Discord path '+path);
  }};
  const first='920000000000000021';
  const r=await togglePanelRole(db,discord,config,memberId,p.id,ordinaryRole,first,messageId,channel,helperRole);
  assert.equal(r.added,true);assert.deepEqual(current.roles,[ordinaryRole]);
  const replay=await togglePanelRole(db,discord,config,memberId,p.id,ordinaryRole,first,messageId,channel,helperRole);
  assert.equal(replay.replayed,true);assert.equal(writes,1);
  const second=await togglePanelRole(db,discord,config,memberId,p.id,ordinaryRole,
    '920000000000000022',messageId,channel,helperRole);
  assert.equal(second.added,false);assert.equal(writes,2);
  assert.deepEqual(current.roles,[]);
  assert.equal((await listRolePanels(db,owner))[0].options[0].recordedSelections,0);
  await assert.rejects(togglePanelRole(db,discord,config,memberId,p.id,ordinaryRole,
    '920000000000000023',messageId,'920000000000000090',helperRole),{status:403});
  await assert.rejects(togglePanelRole(db,discord,config,memberId,p.id,ordinaryRole,
    '920000000000000024','920000000000000099',channel,helperRole),{status:403});
});
test('role assignment never grants protected Helper/Admin role even when a panel contains that role',async t=>{
  const db=await setup(t),p=await createRolePanel(db,owner,{channelId:channel,title:'Unsafe old panel',style:'select'});
  await addRoleOption(db,owner,p.id,1,helperRole,'Helper');
  await publishRolePanel(db,owner,p.id,2,true);
  const msg='920000000000000020';
  await db.query('UPDATE pc_role_panels SET message_id=$1 WHERE id=$2',[msg,p.id]);
  let writes=0;
  const discord:any={call:async(path:string,init:any={})=>{
    if(path.endsWith('/roles'))return roles;
    if(path.endsWith('/members/'+memberId))return {user:{id:memberId},roles:[]};
    if(path.endsWith('/members/'+botId))return bot;
    writes++;return null;
  }};
  await assert.rejects(togglePanelRole(db,discord,config,memberId,p.id,helperRole,
    '920000000000000025',msg,channel,helperRole),{status:403});
  assert.equal(writes,0);
});
test('public post reconciles a single message across restart, editing and module disable',async t=>{
  const db=await setup(t),p=await panel(db,'select');
  let posts=0,patches=0;
  const discord:any={call:async(path:string,opts:any)=>{
    if(opts.method==='POST'){posts++;return {id:'920000000000000030'};}
    if(opts.method==='PATCH'){patches++;return {id:'920000000000000030'};}
    throw Error('Unexpected Discord action '+path);
  }};
  assert.equal(await deliverRolePanel(db,discord),true);
  assert.equal(await deliverRolePanel(db,discord),false);
  assert.equal(posts,1);
  const live=(await listRolePanels(db,owner))[0];
  assert.equal(live.messageId,'920000000000000030');
  assert.equal(rolePanelMessage(live).components[0].components[0].type,3);
  await addRoleOption(db,owner,p.id,p.revision,'920000000000000088','Local Explorer');
  await initialize(db,guild);
  assert.equal(await deliverRolePanel(db,discord),true);assert.equal(patches,1);
  await communitySetModule(db,{id:ownerId,isOwner:true,isStaff:true},'roles',false);
  assert.equal(await deliverRolePanel(db,discord),true);
  assert.equal(patches,2);
  const disabled=rolePanelMessage((await listRolePanels(db,owner))[0],false);
  assert.deepEqual(disabled.components,[]);
  await assert.rejects(togglePanelRole(db,discord,config,memberId,p.id,ordinaryRole,
    '920000000000000040',live.messageId!,channel,helperRole),{status:403});
});
test('Discord button and select panel interactions enforce live IDs and private replies',async t=>{
  const db=await setup(t),p=await panel(db,'select'),msg='920000000000000045';
  await db.query('UPDATE pc_role_panels SET message_id=$1 WHERE id=$2',[msg,p.id]);
  const members:any={[memberId]:{user:{id:memberId},roles:[]},[botId]:bot};
  const discord:any={call:async(path:string,init:any={})=>{
    if(path.endsWith('/roles'))return roles;
    if(path.endsWith('/members/'+memberId))return members[memberId];
    if(path.endsWith('/members/'+botId))return bot;
    if(path.endsWith('/roles/'+ordinaryRole)){members[memberId].roles=init.method==='PUT'?[ordinaryRole]:[];return null;}
    throw Error('Unexpected '+path);
  }};
  const body:any={id:'920000000000000046',guild_id:guild,channel_id:channel,
    message:{id:msg},member:{user:{id:memberId},roles:[]},data:{custom_id:'pcr:'+p.id,values:[ordinaryRole]}};
  const result:any=await roleComponent(db,config,body,discord);
  assert.equal(result.data.flags,64);assert.match(result.data.content,/assigned/);
  const again:any=await roleComponent(db,config,body,discord);
  assert.match(again.data.content,/previous interaction already applied/);
  assert.ok(roleCommands().some(c=>c.name==='roles'));
  const outsider:any=await roleInteraction(db,config,{guild_id:guild,member:{user:{id:memberId},roles:[]},
    data:{options:[{name:'admin-create',options:[]}]}},discord);
  assert.match(outsider.data.content,/Only the configured Owner/);
});
test('PostgreSQL concurrent same-receipt role toggles do not multiply audit records',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='role_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  const p=await panel(db),msg='920000000000000050';
  await db.query('UPDATE pc_role_panels SET message_id=$1 WHERE id=$2',[msg,p.id]);
  const member:any={user:{id:memberId},roles:[]};
  const discord:any={call:async(path:string,init:any={})=>{
    if(path.endsWith('/roles'))return roles;
    if(path.endsWith('/members/'+memberId))return member;
    if(path.endsWith('/members/'+botId))return bot;
    if(path.endsWith('/roles/'+ordinaryRole)){member.roles=[ordinaryRole];return null;}
    throw Error('Unexpected path '+path);
  }};
  const results=await Promise.all(Array.from({length:6},()=>togglePanelRole(db,discord,config,memberId,p.id,
    ordinaryRole,'920000000000000051',msg,channel,helperRole)));
  assert.equal(results.filter(x=>!x.replayed).length,1);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS total FROM pc_role_audit WHERE action='selected'"))[0].total),1);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS total FROM pc_role_receipts'))[0].total),1);
});
