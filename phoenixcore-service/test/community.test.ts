import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {communityActor,communityEnabled,communitySetModule,saveTag,getTag,tagAlias,tagHistory,tagRollback,
  proposeTag,pendingTagProposals,reviewTag,createSuggestion,getSuggestion,voteSuggestion,reviewSuggestion,suggestionDisplay} from '../src/community.ts';
import {communityCommands,communityInteraction} from '../src/community-discord.ts';
import {deliverCommunityNotice} from '../src/community-delivery.ts';
import {DiscordFailure} from '../src/discord.ts';

const guild='950522987646418964',owner='110000000000000001',member='110000000000000002',helper='110000000000000003',another='110000000000000004',helperRole='1100315893864603649';
const people={
  owner:communityActor(owner,[],'0',owner,helperRole),
  member:communityActor(member,[],'0',owner,helperRole),
  helper:communityActor(helper,[helperRole],'0',owner,helperRole),
  admin:communityActor(another,[],'8',owner,helperRole)
};
const config:any={guild,owner,clientId:'110000000000000020'};
async function sqlite(t:any){
  const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;
}
const cmd=(command:string,operation:string,user:string,roles:string[]=[],opts:any[]=[],permissions='0')=>({
  type:2,guild_id:guild,channel_id:'130000000000000001',
  member:{user:{id:user,username:'Player'},roles,permissions},
  data:{name:command,options:[{type:1,name:operation,options:opts}]}
});
const arg=(name:string,value:unknown)=>({name,value});
test('all Carl informational tags and suggestion commands register as separate namespaces',()=>{
  const commands=communityCommands();
  assert.deepEqual(commands.map(x=>x.name),['tag','suggest','community-module']);
  const tag=commands[0].options.map(x=>x.name);
  assert.ok(['show','search','propose','save','alias','history','rollback','proposals','review'].every(x=>tag.includes(x)));
  assert.ok(commands[1].options.map(x=>x.name).includes('vote'));
});
test('helper/Admin can publish informational tags, members can only propose, aliases and rollback preserve history',async t=>{
  const db=await sqlite(t);
  assert.equal(people.helper.isStaff,true);
  assert.equal(people.admin.isStaff,true);
  assert.equal(people.member.isStaff,false);
  await assert.rejects(saveTag(db,people.member,'combat-guide','Use the posted rules.'),/Owner, Admin or Helper/);
  const proposal=await proposeTag(db,people.member,'combat-guide','Welcome, {user}. See the rules in {channel}.');
  assert.equal((await pendingTagProposals(db,people.helper)).length,1);
  const approved=await reviewTag(db,people.helper,proposal,'approve');
  assert.equal(approved.published?.revision,1);
  await assert.rejects(reviewTag(db,people.helper,proposal,'approve'),/Already reviewed/);
  const shown=await getTag(db,'combat-guide',{userId:member,channelId:'130000000000000001'});
  assert.match(shown.text,new RegExp(member));
  assert.match(shown.text,/<#130000000000000001>/);
  assert.equal(await tagAlias(db,people.admin,'combat-guide','fighting'), 'combat-guide');
  assert.equal((await getTag(db,'fighting',{userId:member,channelId:guild})).name,'combat-guide');
  const edited=await saveTag(db,people.owner,'combat-guide','Updated information.');
  assert.equal(edited.revision,2);
  const reverted=await tagRollback(db,people.admin,'combat-guide',1);
  assert.equal(reverted.revision,3);
  assert.match((await getTag(db,'fighting',{userId:member,channelId:guild})).text,/Welcome/);
  assert.deepEqual((await tagHistory(db,people.helper,'combat-guide')).map(x=>Number(x.revision)),[3,2,1]);
  await assert.rejects(tagAlias(db,people.helper,'combat-guide','combat-guide'),/different alias/);
  await assert.rejects(saveTag(db,people.helper,'fighting','Collision'),/already in use/);
});
test('module switches are independent, owner-controlled, restart-safe and have no destructive side effect',async t=>{
  const db=await sqlite(t);
  assert.equal(await communityEnabled(db,'tags'),true);
  assert.equal(await communityEnabled(db,'suggestions'),true);
  const id=await proposeTag(db,people.member,'faq','Questions and answers.');
  await assert.rejects(communitySetModule(db,people.helper,'tags',false),/Only the owner/);
  assert.equal(await communitySetModule(db,people.owner,'tags',false),false);
  assert.equal(await communityEnabled(db,'tags'),false);
  assert.equal(await communityEnabled(db,'suggestions'),true);
  await initialize(db,guild);
  assert.equal(await communityEnabled(db,'tags'),false);
  assert.equal((await pendingTagProposals(db,people.helper))[0].id,id);
  assert.equal(await communitySetModule(db,people.owner,'tags',true),true);
});
test('anonymous suggestions conceal identity, use only one current ballot per human, and preserve staff history',async t=>{
  const db=await sqlite(t),id=await createSuggestion(db,people.member,'Add a library','A library of RP lore would help.',true);
  await voteSuggestion(db,people.member,id,1);
  await voteSuggestion(db,people.member,id,1);
  let row=await getSuggestion(db,id);
  assert.equal(Number(row.upvotes),1);
  await voteSuggestion(db,people.member,id,-1);
  row=await getSuggestion(db,id);
  assert.equal(Number(row.upvotes),0);assert.equal(Number(row.downvotes),1);
  await voteSuggestion(db,people.admin,id,1);
  assert.equal(Number((await getSuggestion(db,id)).upvotes),1);
  const embed=suggestionDisplay(await getSuggestion(db,id));
  assert.equal(embed.embeds[0].fields.find(x=>x.name==='Submitted by')?.value,'Anonymous');
  assert.doesNotMatch(JSON.stringify(embed),new RegExp(member));
  await assert.rejects(reviewSuggestion(db,people.member,id,'Approved'),/Owner, Admin or Helper/);
  const review=await reviewSuggestion(db,people.helper,id,'Under Review','We are considering this.');
  assert.equal(review.status,'Under Review');assert.equal(review.authorId,member);
  await reviewSuggestion(db,people.admin,id,'Implemented','Added to the rules directory.');
  await assert.rejects(voteSuggestion(db,people.member,id,1),/Voting is closed/);
  const history=await db.query('SELECT event FROM pc_suggestion_history WHERE suggestion_id=$1 ORDER BY revision',[id]);
  assert.deepEqual(history.map(r=>r.event),['created','status:Under Review','status:Implemented']);
  await voteSuggestion(db,people.owner,id,0).catch(e=>assert.match(e.message,/Voting is closed/));
});
test('slash commands and vote components enforce signed Guild roles and private disclosures',async t=>{
  const db=await sqlite(t);
  const proposed=await communityInteraction(db,config,cmd('tag','propose',member,[],[arg('name','faq'),arg('content','Useful lore.')]));
  assert.match(proposed.data.content,/Proposal submitted/);
  const blocked=await communityInteraction(db,config,cmd('tag','save',member,[],[arg('name','faq'),arg('content','Illicit')]));
  assert.match(blocked.data.content,/Owner, Admin or Helper/);
  const tag=await communityInteraction(db,config,cmd('tag','save',helper,[helperRole],[arg('name','faq'),arg('content','Read the official rules.')]));
  assert.match(tag.data.content,/Published faq/);
  const shown=await communityInteraction(db,config,cmd('tag','show',member,[],[arg('name','faq')]));
  assert.equal(shown.type,4);assert.equal(shown.data.flags,undefined);
  const created=await communityInteraction(db,config,cmd('suggest','create',member,[],[arg('title','More worlds'),arg('content','Please add more worlds.'),arg('anonymous',true)]));
  assert.equal(created.type,4);assert.equal(created.data.flags,64);
  assert.match(created.data.content,/1573908218260885614/);
  const id=created.data.content.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  assert.ok(id);
  const posted=await getSuggestion(db,id);
  assert.equal(suggestionDisplay(posted).embeds[0].fields[2].value,'Anonymous');
  const button=await communityInteraction(db,config,{type:3,guild_id:guild,channel_id:'130000000000000001',member:{user:{id:another},roles:[],permissions:'0'},data:{custom_id:'pcs:vote:'+id+':up'}});
  assert.equal(button.type,4);assert.equal(button.data.flags,64);
  const second=await communityInteraction(db,config,{type:3,guild_id:guild,channel_id:'130000000000000001',member:{user:{id:another},roles:[],permissions:'0'},data:{custom_id:'pcs:vote:'+id+':up'}});
  assert.match(second.data.content,/Vote saved/);
  assert.equal(Number((await getSuggestion(db,id)).upvotes),1);
  const manager=await communityInteraction(db,config,cmd('suggest','manage',helper,[helperRole],[arg('id',id)]));
  assert.equal(manager.data.flags,64);assert.deepEqual(manager.data.components[0].components.map((c:any)=>c.label),['Approved','Denied','Implemented']);
  const forbidden=await communityInteraction(db,config,cmd('suggest','manage',member,[],[arg('id',id)]));
  assert.match(forbidden.data.content,/Only Owner, Admin or Helper/);
  const privateClick=await communityInteraction(db,config,{type:3,guild_id:guild,channel_id:'130000000000000001',member:{user:{id:helper},roles:[helperRole],permissions:'0'},data:{custom_id:'pcs:staff:'+id+':implemented'}});
  assert.equal(privateClick.type,7);assert.match(privateClick.data.content,/Implemented/);
  const refused=await communityInteraction(db,config,{type:3,guild_id:guild,channel_id:'130000000000000001',member:{user:{id:member},roles:[],permissions:'0'},data:{custom_id:'pcs:staff:'+id+':approved'}});
  assert.match(refused.data.content,/Only Owner, Admin or Helper/);
  const shortcut=await communityInteraction(db,config,{type:2,guild_id:guild,channel_id:'130000000000000001',member:{user:{id:helper},roles:[helperRole],permissions:'0'},data:{name:'pc-tag-save',options:[arg('name','guide'),arg('content','Here is the guide.')]}});
  assert.match(shortcut.data.content,/Published guide/);
  const shortcutShow=await communityInteraction(db,config,{type:2,guild_id:guild,channel_id:'130000000000000001',member:{user:{id:member},roles:[],permissions:'0'},data:{name:'pc-tag-show',options:[arg('name','guide')]}});
  assert.match(shortcutShow.data.content,/Here is the guide/);
  const reviewed=await communityInteraction(db,config,cmd('suggest','review',helper,[helperRole],[arg('id',id),arg('status','Approved'),arg('response','Planned.')]));
  assert.match(reviewed.data.content,/Approved/);
  const nonowner=await communityInteraction(db,config,cmd('community-module','set',helper,[helperRole],[arg('module','suggestions'),arg('enabled',false)]));
  assert.match(nonowner.data.content,/Only the owner/);
});
test('PostgreSQL concurrent suggestion ballots are deduplicated and tags have version history',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const u=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),admin=await openPostgres(u.href);
  const schema='community_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);u.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(u.href);
  t.after(async()=>{await db.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.close();});
  await initialize(db,guild);
  const id=await createSuggestion(db,people.member,'Backend stability','Votes must survive retries.',true);
  await Promise.all(Array.from({length:25},()=>voteSuggestion(db,people.admin,id,1)));
  assert.equal(Number((await getSuggestion(db,id)).upvotes),1);
  await saveTag(db,people.helper,'rules','Read the rules.');
  await saveTag(db,people.admin,'rules','Rules have been updated.');
  assert.deepEqual((await tagHistory(db,people.helper,'rules')).map(r=>Number(r.revision)),[2,1]);
});

test('staff decisions enqueue one durable private DM per actual change and never duplicate after successful delivery',async t=>{
  const db=await sqlite(t),id=await createSuggestion(db,people.member,'Lore archive','Preserve older chronicles.',true);
  await reviewSuggestion(db,people.helper,id,'Approved','This will be added.');
  await reviewSuggestion(db,people.helper,id,'Approved','This will be added.');
  assert.equal((await db.query('SELECT id FROM pc_community_notifications')).length,1);
  const sent:any[]=[];
  const discord:any={call:async(path:string,opts:any)=>{
    sent.push({path,opts});
    if(path==='/users/@me/channels')return {id:'140000000000000001'};
    if(path==='/channels/140000000000000001/messages')return {id:'140000000000000002'};
    throw Error('Unexpected route');
  }};
  assert.equal(await deliverCommunityNotice(db,discord),true);
  assert.equal(await deliverCommunityNotice(db,discord),false);
  assert.equal(sent.length,2);
  const body=JSON.parse(sent[1].opts.body);
  assert.match(body.content,/Lore archive/);
  assert.match(body.content,/Approved/);
  assert.deepEqual(body.allowed_mentions,{parse:[]});
  assert.equal(body.enforce_nonce,true);
  const [row]=await db.query('SELECT status,message_id FROM pc_community_notifications');
  assert.equal(row.status,'delivered');
  assert.equal(row.message_id,'140000000000000002');
  await initialize(db,guild);
  assert.equal(await deliverCommunityNotice(db,discord),false);
});
test('blocked Discord DMs cannot block a staff decision or cause endless retries',async t=>{
  const db=await sqlite(t),id=await createSuggestion(db,people.member,'Help wanted','Need a volunteer.',false);
  await reviewSuggestion(db,people.helper,id,'Denied','Not currently possible.');
  const discord:any={call:async()=>{throw new DiscordFailure(403,0,50007);}};
  assert.equal(await deliverCommunityNotice(db,discord),true);
  const [record]=await db.query('SELECT status,attempts,last_error FROM pc_community_notifications');
  assert.equal(record.status,'undeliverable');
  assert.equal(Number(record.attempts),1);
  assert.equal(await deliverCommunityNotice(db,discord),false);
});
