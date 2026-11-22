import {createHash,randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import {requireThat,discordId} from './domain.ts';
import type {Config} from './discord.ts';
import type {StaffIdentity} from './staff.ts';

export type AutomodPolicy={
  enabled:boolean;
  ownerAlerts:boolean;
  invites:boolean;
  blockedHosts:string[];
  duplicateThreshold:number;
  duplicateWindowSeconds:number;
  mentionThreshold:number;
  excludedChannels:string[];
  excludedRoles:string[];
};
export const defaultAutomodPolicy:AutomodPolicy={
  enabled:false,ownerAlerts:false,invites:false,blockedHosts:[],
  duplicateThreshold:0,duplicateWindowSeconds:0,mentionThreshold:0,
  excludedChannels:[],excludedRoles:[]
};
const rules=['invite','blocked-host','repeated-post','mention-flood'] as const;
export type AutomodRule=typeof rules[number];
export type ObservedMessage={id:string;guildId:string;channelId:string;userId:string;roles:string[];content:string};
const isOwner=(actor:StaffIdentity)=>requireThat(actor.isOwner,403,'Only the configured Convergence Owner can configure automod.');
const verified=(id:string,name:string)=>requireThat(discordId.test(id),400,'Choose a valid '+name+'.');
function validatePolicy(raw:any):AutomodPolicy{
  requireThat(raw&&typeof raw==='object'&&!Array.isArray(raw),400,'Provide automod rule settings.');
  requireThat(Object.keys(raw).every(key=>Object.hasOwn(defaultAutomodPolicy,key)),400,'Unknown automod option.');
  for(const key of ['enabled','ownerAlerts','invites'] as const)
    requireThat(typeof raw[key]==='boolean',400,key+' must be enabled or disabled.');
  for(const key of ['duplicateThreshold','duplicateWindowSeconds','mentionThreshold'] as const)
    requireThat(Number.isSafeInteger(raw[key])&&raw[key]>=0,400,key+' must be a whole number or zero.');
  requireThat(raw.duplicateThreshold===0||raw.duplicateThreshold>=2&&raw.duplicateThreshold<=12,400,
    'Repeat detection must use 2–12 identical posts or be disabled.');
  requireThat(raw.duplicateThreshold===0&&raw.duplicateWindowSeconds===0||
    raw.duplicateThreshold>=2&&raw.duplicateWindowSeconds>=5&&raw.duplicateWindowSeconds<=300,400,
    'Choose a 5–300 second repeat window for enabled repeat detection.');
  requireThat(raw.mentionThreshold===0||raw.mentionThreshold>=2&&raw.mentionThreshold<=30,400,
    'Mention detection must use 2–30 distinct user mentions or be disabled.');
  requireThat(Array.isArray(raw.blockedHosts)&&raw.blockedHosts.length<=50,400,'Choose up to 50 blocked domains.');
  const hosts=raw.blockedHosts.map((s:unknown)=>{
    requireThat(typeof s==='string',400,'Domains must be text.');
    const host=s.trim().toLowerCase();
    requireThat(/^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,63}$/.test(host)&&host.length<=253,
      400,'Enter hostnames only, without URL schemes, paths or wildcard stars.');
    return host;
  });
  for(const key of ['excludedChannels','excludedRoles'] as const){
    requireThat(Array.isArray(raw[key])&&raw[key].length<=50&&raw[key].every((s:any)=>typeof s==='string'&&discordId.test(s)),
      400,'Choose up to 50 valid Discord IDs for '+key+'.');
  }
  return {
    enabled:raw.enabled,ownerAlerts:raw.ownerAlerts,invites:raw.invites,
    blockedHosts:[...new Set(hosts)],duplicateThreshold:raw.duplicateThreshold,
    duplicateWindowSeconds:raw.duplicateWindowSeconds,mentionThreshold:raw.mentionThreshold,
    excludedChannels:[...new Set(raw.excludedChannels)],excludedRoles:[...new Set(raw.excludedRoles)]
  };
}
export async function automodPolicy(db:Store){
  const [row]=await db.query('SELECT revision,policy FROM pc_automod_policy WHERE slot=1');
  return {revision:Number(row?.revision||0),policy:row?JSON.parse(row.policy) as AutomodPolicy:defaultAutomodPolicy};
}
export async function setAutomodPolicy(db:Store,actor:StaffIdentity,revision:number,raw:any){
  isOwner(actor);
  const policy=validatePolicy(raw);
  requireThat(Number.isSafeInteger(revision)&&revision>=0,400,'Specify the current policy revision.');
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(739124862)');
    const [old]=await q('SELECT revision,policy FROM pc_automod_policy WHERE slot=1'+
      (db.dialect==='postgres'?' FOR UPDATE':'' ));
    requireThat(Number(old?.revision||0)===revision,409,'Automod configuration changed. Refresh before saving.');
    const next=revision+1,at=Date.now();
    await q(`INSERT INTO pc_automod_policy(slot,revision,policy,actor_id,updated_ms)
      VALUES(1,$1,$2,$3,$4) ON CONFLICT(slot) DO UPDATE SET
      revision=excluded.revision,policy=excluded.policy,actor_id=excluded.actor_id,updated_ms=excluded.updated_ms`,
      [next,JSON.stringify(policy),actor.id,at]);
    await q('INSERT INTO pc_automod_policy_history(revision,actor_id,before_policy,after_policy,changed_ms) VALUES($1,$2,$3,$4,$5)',
      [next,actor.id,old?.policy||JSON.stringify(defaultAutomodPolicy),JSON.stringify(policy),at]);
    return {revision:next,policy};
  });
}
export async function automodPolicyHistory(db:Store,actor:StaffIdentity){
  isOwner(actor);
  return db.query('SELECT revision,actor_id,changed_ms FROM pc_automod_policy_history ORDER BY revision DESC LIMIT 25');
}
function urlHosts(content:string){
  const found=new Set<string>();
  for(const raw of content.match(/https?:\/\/[^\s<>]+/gi)||[]){
    try{
      const url=new URL(raw.replace(/[.,;!?)}\]]+$/g,''));
      if(['http:','https:'].includes(url.protocol))found.add(url.hostname.toLowerCase());
    }catch{}
  }
  return found;
}
function inviteLink(content:string){
  return /(?:^|[^\w.])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)[a-z0-9-]+/i.test(content);
}
const normalize=(text:string)=>text.trim().toLowerCase().replace(/\s+/g,' ');
const digest=(content:string)=>createHash('sha256').update(normalize(content)).digest('hex');
export async function automodMatches(db:Store,policy:AutomodPolicy,message:ObservedMessage,now=Date.now(),includeCurrent=false){
  const matches:AutomodRule[]=[];
  if(policy.invites&&inviteLink(message.content))matches.push('invite');
  const hosts=urlHosts(message.content);
  if(policy.blockedHosts.some(b=>[...hosts].some(host=>host===b||host.endsWith('.'+b))))
    matches.push('blocked-host');
  const mentions=new Set([...message.content.matchAll(/<@!?\d{17,20}>/g)].map(m=>m[0].replace(/\D/g,'')));
  if(policy.mentionThreshold&&mentions.size>=policy.mentionThreshold)matches.push('mention-flood');
  if(policy.duplicateThreshold&&normalize(message.content).length>=8){
    const [count]=await db.query('SELECT COUNT(*) AS n FROM pc_automod_observations WHERE user_id=$1 AND channel_id=$2 AND digest=$3 AND created_ms>=$4',
      [message.userId,message.channelId,digest(message.content),now-policy.duplicateWindowSeconds*1000]);
    const previous=Number(count.n);
    if(previous+(includeCurrent?1:0)>=policy.duplicateThreshold)matches.push('repeated-post');
  }
  return matches;
}
export async function previewAutomod(db:Store,actor:StaffIdentity,message:ObservedMessage,now=Date.now()){
  isOwner(actor);
  verified(message.userId,'sample member ID');verified(message.channelId,'sample channel ID');
  requireThat(message.content.length<=2000,400,'Samples must be at most 2,000 characters.');
  const {policy}=await automodPolicy(db);
  const matches=await automodMatches(db,policy,message,now,true);
  return {rules:matches,policyEnabled:policy.enabled,recorded:false,enforced:false};
}
export async function observeAutomod(db:Store,config:Config,message:ObservedMessage,now=Date.now()){
  if(message.guildId!==config.guild||message.userId===config.owner||
    ![message.id,message.userId,message.channelId].every(x=>discordId.test(x))||
    !message.content.trim()||message.content.length>2000)return {rules:[],recorded:false};
  const {policy}=await automodPolicy(db);
  if(!policy.enabled||policy.excludedChannels.includes(message.channelId)||
    message.roles.some(id=>policy.excludedRoles.includes(id)))return {rules:[],recorded:false};
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(hashtext($1))',['automod:'+message.userId+':'+message.channelId]);
    const saved=await q('INSERT INTO pc_automod_observations(message_id,user_id,channel_id,digest,created_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id',
      [message.id,message.userId,message.channelId,digest(message.content),now]);
    if(!saved.length)return {rules:[],recorded:false};
    const matches=await automodMatches({query:q,dialect:db.dialect} as Store,policy,message,now,false);
    for(const rule of matches)await q('INSERT INTO pc_automod_hits(id,message_id,user_id,channel_id,rule,excerpt,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(message_id,rule) DO NOTHING',
      [randomUUID(),message.id,message.userId,message.channelId,rule,message.content.slice(0,220),now]);
    if(matches.length&&policy.ownerAlerts){
      const [recent]=await q('SELECT COUNT(*) AS n FROM pc_automod_hits WHERE user_id=$1 AND created_ms>=$2 AND message_id!=$3',
        [message.userId,now-60000,message.id]);
      if(Number(recent.n)===0){
        const details=matches.join(', ');
        await q('INSERT INTO pc_core_jobs(id,job_type,recipient_id,payload,due_ms,created_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
          ['automod-alert:'+message.id,'automod-alert',config.owner,
            JSON.stringify({memberId:message.userId,channelId:message.channelId,messageId:message.id,rules:details}),now,now]);
      }
    }
    return {rules:matches,recorded:true};
  });
}
export async function automodIncidents(db:Store,actor:StaffIdentity,page=1){
  requireThat(actor.canModerate,403,'Only the Convergence Owner or Administrators can inspect automod evidence.');
  requireThat(Number.isSafeInteger(page)&&page>=1&&page<=1000,400,'Invalid incident page.');
  const [row]=await db.query('SELECT COUNT(*) AS n FROM pc_automod_hits');
  const hits=await db.query('SELECT * FROM pc_automod_hits ORDER BY created_ms DESC,id DESC LIMIT 25 OFFSET $1',[(page-1)*25]);
  return {total:Number(row.n),page,pages:Math.max(1,Math.ceil(Number(row.n)/25)),hits};
}
export async function cleanupAutomodObservations(db:Store,now=Date.now()){
  const old=await db.query('DELETE FROM pc_automod_observations WHERE created_ms<$1 RETURNING message_id',[now-86400000]);
  return old.length;
}
