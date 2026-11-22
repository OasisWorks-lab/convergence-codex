import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {createRolePanel,addRoleOption,publishRolePanel,setRoleReaction,styleRolePanel,
  rolePanelMessage,listRolePanels,deliverRolePanel,verifyAssignableRole} from '../src/role-panels.ts';
import {applyRoleReaction,captureStickyRoles,restoreStickyRoles} from '../src/role-persistence.ts';
import {saveTag,tagAlias,tagRollback,getTag} from '../src/community.ts';
import {richTagSave,richTagHistory,richTagRollback,tagDisplay,tagEmbed} from '../src/rich-tags.ts';
const guild='920000000000000001',ownerId='920000000000000002',
  playerId='920000000000000003',botId='920000000000000004',channel='920000000000000005',
  traveler='920000000000000006',botRole='920000000000000007',helperRole='920000000000000008',
  protectedRole='920000000000000009';
const config:any={guild,owner:ownerId,clientId:botId};
const owner:any={id:ownerId,isOwner:true,isJudge:true,isPlayer:true,isStaff:true},
  player:any={id:playerId,isOwner:false,isJudge:false,isPlayer:true,isStaff:false};
const roles=[
  {id:traveler,name:'Traveler',position:3,permissions:'1024',managed:false},
  {id:protectedRole,name:'Administrator',position:7,permissions:'8',managed:false},
  {id:helperRole,name:'Helper',position:8,permissions:'0',managed:false},
  {id:botRole,name:'PhoenixCore',position:20,permissions:'268435456',managed:false}
];
const bot={user:{id:botId},roles:[botRole]};
async function setup(t:any){const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;}
function fakeDiscord(){
  const user={user:{id:playerId,bot:false},roles:[] as string[]},calls:any[]=[];
  const discord:any={call:async(path:string,init:any={})=>{
    calls.push({path,method:init.method});
    if(path==='/guilds/'+guild+'/roles')return roles;
    if(path==='/guilds/'+guild+'/members/'+playerId)return user;
    if(path==='/guilds/'+guild+'/members/'+botId)return bot;
    if(path==='/guilds/'+guild+'/members/'+playerId+'/roles/'+traveler){
      user.roles=init.method==='PUT'?[traveler]:[];return null;
    }
    if(path.startsWith('/channels/'+channel+'/messages')){
      if(init.method==='POST')return {id:'920000000000000030'};
      if(init.method==='PATCH')return {id:'920000000000000030'};
      if(init.method==='PUT')return null;
    }
    throw Error('Unexpected Discord route '+path);
  }};
  return {discord,user,calls};
}
async function reactionPanel(db:any){
  const base=await createRolePanel(db,owner,{channelId:channel,title:'Community interests',style:'reactions',
    description:'Pick a role',color:0x334455,imageUrl:'https://example.org/banner.png'});
  const withRole=await addRoleOption(db,owner,base.id,1,traveler,'Traveler');
  return {id:base.id,revision:withRole.revision};
}
test('Owner-only reaction panel creation, role emoji configuration and appearance remain revision-safe',async t=>{
  const db=await setup(t),p=await reactionPanel(db);
  await assert.rejects(publishRolePanel(db,owner,p.id,2,true),{status:409});
  await assert.rejects(setRoleReaction(db,player,p.id,2,traveler,'🔥'),{status:403});
  await assert.rejects(setRoleReaction(db,owner,p.id,2,traveler,'not-an-emoji'),{status:400});
  const change=await setRoleReaction(db,owner,p.id,2,traveler,'🔥');
  assert.equal(change.revision,3);
  await assert.rejects(setRoleReaction(db,owner,p.id,2,traveler,'✨'),{status:409});
  await assert.rejects(styleRolePanel(db,player,p.id,3,{title:'Bad',color:123}),{status:403});
  await assert.rejects(styleRolePanel(db,owner,p.id,3,{title:'Bad',color:123,imageUrl:'javascript:alert(1)'}),{status:400});
  const style=await styleRolePanel(db,owner,p.id,3,{title:'Discover worlds',
    description:'React to get the badge',color:0x335577,imageUrl:'https://example.org/new.png'});
  assert.equal(style.revision,4);
  assert.equal((await publishRolePanel(db,owner,p.id,4,true)).revision,5);
  const live=(await listRolePanels(db,owner))[0];
  assert.equal(live.imageUrl,'https://example.org/new.png');
  assert.equal(live.options[0].emoji,'🔥');
  const embed=rolePanelMessage(live);
  assert.equal(embed.components.length,0);
  assert.match(embed.embeds[0].description,/🔥/);
  assert.equal(embed.embeds[0].image.url,'https://example.org/new.png');
  const {discord,calls}=fakeDiscord();
  assert.equal(await deliverRolePanel(db,discord),true);
  assert.equal(await deliverRolePanel(db,discord),false);
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.equal(calls.filter(c=>c.method==='PUT'&&c.path.includes('/reactions/')).length,1);
  assert.equal((await listRolePanels(db,player)).length,1);
});
test('explicit reaction add/remove cannot flip on duplicate delivery or choose a different role',async t=>{
  const db=await setup(t),p=await reactionPanel(db);
  await setRoleReaction(db,owner,p.id,2,traveler,'🔥');
  await publishRolePanel(db,owner,p.id,3,true);
  const messageId='920000000000000030';
  await db.query('UPDATE pc_role_panels SET message_id=$1 WHERE id=$2',[messageId,p.id]);
  const {discord,user,calls}=fakeDiscord(),event={guildId:guild,userId:playerId,channelId:channel,messageId,emoji:'🔥'};
  assert.equal((await applyRoleReaction(db,discord,config,{...event,added:true})).changed,true);
  assert.equal((await applyRoleReaction(db,discord,config,{...event,added:true})).changed,false);
  assert.deepEqual(user.roles,[traveler]);
  assert.equal(calls.filter(x=>x.path.endsWith('/roles/'+traveler)&&x.method==='PUT').length,1);
  await assert.rejects(applyRoleReaction(db,discord,config,{...event,emoji:'🔒',added:true}),{status:403});
  await assert.rejects(applyRoleReaction(db,discord,config,{...event,messageId:'920000000000000031',added:true}),{status:403});
  await assert.rejects(applyRoleReaction(db,discord,config,{...event,guildId:'920000000000000066',added:true}),{status:403});
  assert.equal((await applyRoleReaction(db,discord,config,{...event,added:false})).changed,true);
  assert.equal((await applyRoleReaction(db,discord,config,{...event,added:false})).changed,false);
  assert.deepEqual(user.roles,[]);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pc_role_audit WHERE action IN ($1,$2)',
    ['reaction-selected','reaction-removed']))[0].n,2);
});
test('sticky roles require actual role possession at departure and recheck privilege and active selection',async t=>{
  const db=await setup(t),p=await reactionPanel(db);
  await setRoleReaction(db,owner,p.id,2,traveler,'🔥');
  await publishRolePanel(db,owner,p.id,3,true);
  await db.query('UPDATE pc_role_panels SET message_id=$1 WHERE id=$2',['920000000000000030',p.id]);
  const {discord,user}=fakeDiscord(),event={guildId:guild,userId:playerId,channelId:channel,
    messageId:'920000000000000030',emoji:'🔥',added:true};
  await applyRoleReaction(db,discord,config,event);
  assert.equal(await captureStickyRoles(db,guild,playerId,[protectedRole],config),0);
  assert.equal((await db.query('SELECT * FROM pc_role_sticky_snapshots')).length,0);
  assert.equal(await captureStickyRoles(db,guild,playerId,[traveler,protectedRole],config),1);
  user.roles=[];
  const restored=await restoreStickyRoles(db,discord,config,guild,playerId);
  assert.equal(restored.restored,1);
  assert.deepEqual(user.roles,[traveler]);
  assert.equal((await db.query('SELECT * FROM pc_role_sticky_snapshots')).length,0);
  await captureStickyRoles(db,guild,playerId,[traveler],config);
  roles[0].permissions='8';
  user.roles=[];
  const skipped=await restoreStickyRoles(db,discord,config,guild,playerId);
  assert.equal(skipped.skipped,1);
  assert.deepEqual(user.roles,[]);
  roles[0].permissions='1024';
  await captureStickyRoles(db,guild,playerId,[traveler],config);
  await db.query('UPDATE pc_role_assignments SET active=0 WHERE user_id=$1',[playerId]);
  assert.equal((await restoreStickyRoles(db,discord,config,guild,playerId)).skipped,1);
  assert.deepEqual(user.roles,[]);
});
test('rich tag presentation preserves existing aliases, proxy independence and rollback revisions',async t=>{
  const db=await setup(t);
  await saveTag(db,owner,'rules','Welcome {user} to {server} in {channel} on {date}');
  await tagAlias(db,owner,'rules','law');
  const plain=await tagDisplay(db,'law',{userId:playerId,channelId:channel});
  assert.deepEqual(plain.rich.buttons,[]);
  assert.match(tagEmbed(plain).embeds[0].description,/Convergence: Phoenix Rising/);
  await assert.rejects(richTagSave(db,player,'rules',0,{title:'Illegal'}),{status:403});
  await assert.rejects(richTagSave(db,owner,'rules',0,{title:'Bad',imageUrl:'javascript:alert(1)'}),{status:400});
  await assert.rejects(richTagSave(db,owner,'rules',0,{title:'Bad',buttons:[{label:'Click',url:'http://invalid.test'}]}),{status:400});
  const style=await richTagSave(db,owner,'rules',0,{
    title:'House Rules',imageUrl:'https://example.com/rules.png',color:0x123456,
    buttons:[{label:'Codex',url:'https://example.com/codex'}]
  });
  assert.equal(style.presentationRevision,1);
  await assert.rejects(richTagSave(db,owner,'rules',0,{title:'Stale'}),{status:409});
  const rich=await tagDisplay(db,'law',{userId:playerId,channelId:channel});
  const output=tagEmbed(rich);
  assert.equal(output.embeds[0].title,'House Rules');
  assert.equal(output.embeds[0].image.url,'https://example.com/rules.png');
  assert.equal(output.components[0].components[0].style,5);
  assert.equal(output.allowed_mentions.parse.length,0);
  assert.match(output.embeds[0].description,new RegExp('<@'+playerId+'>'));
  assert.equal((await getTag(db,'law',{userId:playerId,channelId:channel})).revision,1);
  await richTagSave(db,owner,'rules',1,{title:'Second style',color:4,buttons:[]});
  assert.deepEqual((await richTagHistory(db,owner,'rules')).map(x=>x.presentationRevision),[2,1]);
  await richTagRollback(db,owner,'rules',2,1);
  assert.equal((await tagDisplay(db,'rules',{userId:playerId,channelId:channel})).rich.title,'House Rules');
  await tagRollback(db,owner,'rules',1);
  assert.equal((await getTag(db,'rules',{userId:playerId,channelId:channel})).revision,2);
  assert.equal((await tagDisplay(db,'rules',{userId:playerId,channelId:channel})).rich.presentationRevision,3);
  const posting=await db.query('SELECT * FROM pc_post_tags');
  assert.equal(posting.length,0);
});
test('PostgreSQL reaction mapping and rich tags migrate, save and round-trip',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='role_rich_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  await initialize(db,guild);
  const p=await reactionPanel(db);
  await setRoleReaction(db,owner,p.id,2,traveler,'🔥');
  await publishRolePanel(db,owner,p.id,3,true);
  assert.equal((await listRolePanels(db,owner))[0].options[0].emoji,'🔥');
  await saveTag(db,owner,'codex','Read the rules');
  await richTagSave(db,owner,'codex',0,{title:'Codex Reference',color:15});
  assert.equal((await tagDisplay(db,'codex',{userId:playerId,channelId:channel})).rich.title,'Codex Reference');
});
