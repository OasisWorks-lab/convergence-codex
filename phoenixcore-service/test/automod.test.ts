import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSqlite,openPostgres,initialize} from '../src/db.ts';
import {staffIdentity} from '../src/staff.ts';
import {automodPolicy,setAutomodPolicy,automodPolicyHistory,observeAutomod,previewAutomod,
  automodIncidents,cleanupAutomodObservations,defaultAutomodPolicy} from '../src/automod.ts';
import {deliverScheduledJob} from '../src/jobs.ts';
const guild='930000000000000001',ownerId='930000000000000002',adminId='930000000000000003',
  helperId='930000000000000004',memberId='930000000000000005',channel='930000000000000006',
  otherChannel='930000000000000007',helperRole='930000000000000008',staffRole='930000000000000009';
const config:any={guild,owner:ownerId,clientId:'930000000000000010'};
const owner=staffIdentity(ownerId,[],'0',config,helperRole),
  admin=staffIdentity(adminId,[staffRole],'8',config,helperRole),
  helper=staffIdentity(helperId,[helperRole],'0',config,helperRole);
const sample=(content:string,id='930000000000000050',other:any={})=>({
  id,guildId:guild,channelId:channel,userId:memberId,roles:[],content,...other
});
async function fresh(t:any){const db=openSqlite(':memory:');await initialize(db,guild);t.after(()=>db.close());return db;}
function policy(input:any={}){return {...defaultAutomodPolicy,
  enabled:true,invites:true,blockedHosts:['scam.example'],mentionThreshold:2,
  duplicateThreshold:3,duplicateWindowSeconds:30,...input};}

test('automod is disabled by default and cannot punish or store users before Owner opt-in',async t=>{
  const db=await fresh(t);
  assert.equal((await automodPolicy(db)).revision,0);
  assert.equal((await automodPolicy(db)).policy.enabled,false);
  assert.deepEqual(await observeAutomod(db,config,sample('https://discord.gg/spam')),{rules:[],recorded:false});
  assert.equal((await db.query('SELECT * FROM pc_automod_observations')).length,0);
  assert.equal((await db.query('SELECT * FROM pc_automod_hits')).length,0);
  assert.equal((await db.query('SELECT * FROM pc_mod_cases')).length,0);
  assert.equal((await db.query('SELECT * FROM pc_core_jobs')).length,0);
});
test('Owner-only optimistic policy saves validate rules and keep an audited revision timeline',async t=>{
  const db=await fresh(t);
  await assert.rejects(setAutomodPolicy(db,admin,0,policy()),{status:403});
  await assert.rejects(setAutomodPolicy(db,helper,0,policy()),{status:403});
  await assert.rejects(setAutomodPolicy(db,owner,0,policy({duplicateThreshold:1})),{status:400});
  await assert.rejects(setAutomodPolicy(db,owner,0,policy({blockedHosts:['https://scam.example/a']})),{status:400});
  await assert.rejects(setAutomodPolicy(db,owner,0,policy({excludedRoles:['Admin']})),{status:400});
  const saved=await setAutomodPolicy(db,owner,0,policy());
  assert.equal(saved.revision,1);
  await assert.rejects(setAutomodPolicy(db,owner,0,policy()),{status:409});
  assert.equal((await setAutomodPolicy(db,owner,1,policy({ownerAlerts:true}))).revision,2);
  assert.deepEqual((await automodPolicyHistory(db,owner)).map(x=>Number(x.revision)),[2,1]);
  await assert.rejects(automodPolicyHistory(db,admin),{status:403});
});
test('invitation, exact/subdomain blocklist and mention flooding create private durable incidents only',async t=>{
  const db=await fresh(t);await setAutomodPolicy(db,owner,0,policy());
  const text='Join https://discord.gg/abc then visit https://sub.scam.example/path <@930000000000000011> <@930000000000000012>';
  const result=await observeAutomod(db,config,sample(text));
  assert.deepEqual(result.rules,['invite','blocked-host','mention-flood']);
  const prior=await automodIncidents(db,admin);
  assert.equal(prior.total,3);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pc_mod_cases'))[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pc_core_jobs'))[0].n,0);
  assert.deepEqual(await observeAutomod(db,config,sample(text)),{rules:[],recorded:false});
  const bare=await observeAutomod(db,config,sample('I posted discord.gg/abc in the chat','930000000000000054'));
  assert.deepEqual(bare.rules,['invite']);
  assert.equal((await automodIncidents(db,owner)).total,4);
  await assert.rejects(automodIncidents(db,helper),{status:403});
  assert.equal((await observeAutomod(db,config,sample('https://notscam.example/',
    '930000000000000051'))).rules.includes('blocked-host'),false);
  assert.equal((await observeAutomod(db,config,sample('https://scam.example/',
    '930000000000000052'))).rules.includes('blocked-host'),true);
});
test('repeat spam detection serializes observations, ignores Owner and excluded roles/channels',async t=>{
  const db=await fresh(t),now=Date.now(),message='Recruitment announcements repeated in a channel';
  await setAutomodPolicy(db,owner,0,policy({invites:false,blockedHosts:[],mentionThreshold:0}));
  for(let i=0;i<3;i++){
    const hit=await observeAutomod(db,config,sample(message,'93000000000000005'+i),now+i*1000);
    assert.deepEqual(hit.rules,i===2?['repeated-post']:[]);
  }
  assert.equal((await automodIncidents(db,admin)).total,1);
  assert.equal((await observeAutomod(db,config,sample(message,'930000000000000080',{userId:ownerId})).recorded,false);
  assert.equal((await observeAutomod(db,config,sample(message,'930000000000000081',{guildId:'930000000000000088'})).recorded,false);
  await setAutomodPolicy(db,owner,1,policy({excludedChannels:[channel],excludedRoles:[staffRole]}));
  assert.equal((await observeAutomod(db,config,sample(message,'930000000000000082')).recorded,false);
  assert.equal((await observeAutomod(db,config,sample(message,'930000000000000083',
    {channelId:otherChannel,roles:[staffRole]})).recorded,false);
});
test('preview never stores evidence, dispatches alerts, deletes posts or changes moderation cases',async t=>{
  const db=await fresh(t);
  await setAutomodPolicy(db,owner,0,policy({ownerAlerts:true}));
  await assert.rejects(previewAutomod(db,admin,sample('https://discord.gg/example')),{status:403});
  const preview=await previewAutomod(db,owner,sample('https://discord.gg/example'));
  assert.deepEqual(preview.rules,['invite']);
  assert.equal(preview.recorded,false);
  assert.equal(preview.enforced,false);
  assert.equal((await db.query('SELECT * FROM pc_automod_hits')).length,0);
  assert.equal((await db.query('SELECT * FROM pc_core_jobs')).length,0);
  assert.equal((await db.query('SELECT * FROM pc_mod_cases')).length,0);
});
test('optional Owner alerts use existing durable DM jobs without mentioning or punishing users',async t=>{
  const db=await fresh(t);await setAutomodPolicy(db,owner,0,policy({ownerAlerts:true}));
  const now=Date.now();
  await observeAutomod(db,config,sample('https://discord.gg/abc'),now);
  await observeAutomod(db,config,sample('https://discord.gg/def','930000000000000051'),now+1000);
  assert.equal((await automodIncidents(db,owner)).total,2);
  assert.equal((await db.query("SELECT COUNT(*) AS n FROM pc_core_jobs WHERE job_type='automod-alert'"))[0].n,1);
  let sends:any[]=[];
  const discord:any={call:async(path:string,options:any={})=>{
    if(path==='/users/@me/channels')return {id:'930000000000000099'};
    if(path==='/channels/930000000000000099/messages'){
      const message=JSON.parse(options.body);sends.push(message);return {id:'930000000000000098'};
    }
    throw Error('Unexpected '+path);
  }};
  await initialize(db,guild);
  assert.equal(await deliverScheduledJob(db,discord,now+1000),true);
  assert.equal(await deliverScheduledJob(db,discord,now+1000),false);
  assert.equal(sends.length,1);
  assert.match(sends[0].content,/audit only/i);
  assert.deepEqual(sends[0].allowed_mentions,{parse:[]});
});
test('observations expire after 24 hours without erasing the indefinite staff incident trail',async t=>{
  const db=await fresh(t),now=Date.now();
  await setAutomodPolicy(db,owner,0,policy());
  await observeAutomod(db,config,sample('https://discord.gg/abc'),now-90000000);
  assert.equal(await cleanupAutomodObservations(db,now),1);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pc_automod_observations'))[0].n,0);
  assert.equal((await automodIncidents(db,owner)).total,1);
});
test('PostgreSQL concurrent duplicate events cannot multiply incident matches',{skip:!process.env.PHOENIX_TEST_DATABASE_URL},async t=>{
  const url=new URL(process.env.PHOENIX_TEST_DATABASE_URL!),root=await openPostgres(url.href),
    schema='automod_'+randomUUID().replaceAll('-','');
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
  const db=await openPostgres(url.href);
  t.after(async()=>{await db.close();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.close();});
  await initialize(db,guild);
  await setAutomodPolicy(db,owner,0,policy());
  const results=await Promise.all(Array.from({length:10},()=>observeAutomod(db,config,sample('https://discord.gg/abc'))));
  assert.equal(results.filter(x=>x.recorded).length,1);
  assert.equal((await automodIncidents(db,owner)).total,1);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM pc_automod_observations'))[0].n),1);
});
