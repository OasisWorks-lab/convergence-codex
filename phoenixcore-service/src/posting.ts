import {forumType,writableType} from './forum-threads.ts';
import {captureNative} from './native.ts';
import {activeForm,characterCommand} from './characters.ts';
import forms from '../../phoenixcore/templates.js';
import type { RoleplayScope } from './scope.ts';
import { assignTag } from './tags.ts';
import { discordId, readSettings, requireThat, type Actor, type Settings } from './domain.ts';
import type { Store } from './db.ts';
import type { Config } from './discord.ts';

const channelIds=(settings:Settings)=>settings.rpChannels.split(/\s+/).filter(Boolean);
export async function preferences(db:Store,actor:Actor,settings:Settings,liveChannels?:string[]) {
  const [tags,defaults]=await Promise.all([
    db.query('SELECT character_id,tag FROM pc_post_tags WHERE owner_id=$1 ORDER BY tag',[actor.id]),
    db.query('SELECT channel_id,character_id FROM pc_post_defaults WHERE owner_id=$1 ORDER BY channel_id',[actor.id])
  ]);
  const channels=settings.rpDivider?(liveChannels??[]):[...new Set([...channelIds(settings),...(liveChannels||[])])];
  return {tags:tags.map(t=>({characterId:t.character_id,tag:t.tag})),channels,
    defaults:defaults.filter(d=>channels.includes(d.channel_id)).map(d=>({channel:d.channel_id,characterId:d.character_id}))};
}
export async function savePosting(db:Store, actor:Actor, input:any, coverage?:{divider:string;channels:string[]}) {
  requireThat(actor.isPlayer,403,'Only current players can set posting preferences.');
  requireThat(input && typeof input.characterId==='string' && ['tag','default'].includes(input.kind),400,'Choose a character posting preference.');
  await db.transaction(async q=>{
    if(input.characterId || input.kind==='tag'){
      const [sheet]=await q('SELECT owner_id FROM pc_characters WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[input.characterId]);
      requireThat(sheet?.owner_id===actor.id,403,'Choose one of your approved characters.');
    }
    if(input.kind==='tag'){
      requireThat(Object.keys(input).every(k=>['kind','characterId','tag'].includes(k)),400,'Only a posting tag can be changed here.');
      let tag;
      try {tag=forms.normalizeTag(input.tag);} catch(error) {requireThat(false,400,error instanceof Error?error.message:'Choose a valid posting tag.');}
      requireThat(await assignTag(q,actor.id,input.characterId,tag),409,'That tag is already assigned. Refresh your preferences.');
    } else {
      const [row]=await q('SELECT value FROM pc_config WHERE slot=1');
      const settings=JSON.parse(row.value);
      const allowed=settings.rpDivider?(coverage?.divider===settings.rpDivider?coverage.channels:[]):[...new Set([...channelIds(settings),...(coverage?.divider===''?coverage.channels:[])])];
      requireThat(discordId.test(input.channel) && allowed.includes(input.channel),400,'Choose an enabled roleplay channel.');
      if(!input.characterId && !input.account)await q('DELETE FROM pc_post_defaults WHERE owner_id=$1 AND channel_id=$2',[actor.id,input.channel]);
      else await q('INSERT INTO pc_post_defaults(owner_id,channel_id,character_id) VALUES($1,$2,$3) ON CONFLICT(owner_id,channel_id) DO UPDATE SET character_id=excluded.character_id',[actor.id,input.channel,input.characterId]);
    }
  });
}
export async function lookupAuthor(db:Store,actor:Actor,message:string,guild=''){
  requireThat(actor.isJudge,403,'Only staff can look up the writer of a character post.');
  const link=/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(message);
  if(link){requireThat(link[1]===guild,400,'Choose a message from Convergence.');message=link[3];}
  requireThat(discordId.test(message),400,'Use a Discord message ID.');
  const [row]=await db.query('SELECT author_id,character_name FROM pc_posts WHERE posted_id=$1',[message]);
  requireThat(row,404,'PhoenixCore has no recorded character post with that message ID.');
  return {authorId:row.author_id,characterName:row.character_name};
}

type IncomingPost={id:string;channel:string;parent?:string;guild:string;author:string;roles:string[];content:string};
type CharacterPost={content:string;name:string;portrait:string};
function matchPrefix(text:string,tags:{tag_key:string;character_id:string}[]) {
  if(!tags.length)return;
  const byKey=new Map(tags.map(t=>[t.tag_key,t.character_id]));
  let match, end=0;
  for(const symbol of text){
    end+=symbol.length;
    if(end>forms.tagLimit*4)break;
    const prefix=text.slice(0,end), id=byKey.get(forms.tagKey(prefix));
    if(!id)continue;
    const rest=text.slice(end);
    if(/[\p{L}\p{M}\p{N}]$/u.test(prefix) && /^[\p{L}\p{M}\p{N}]/u.test(rest))continue;
    match={character_id:id,content:rest.trimStart()};
  }
  return match;
}
export async function relay(db:Store,config:Config,source:IncomingPost,send:(post:CharacterPost)=>Promise<string>,remove:()=>Promise<void>,inScope?:(settings:Settings)=>boolean,settings?:Settings){
  if(source.guild!==config.guild || !source.content.trim() || source.content.length>2000)return;
  const value=settings||(await readSettings(db)).value;
  if(!(value.rpDivider?inScope?.(value):[source.channel,source.parent||''].some(id=>channelIds(value).includes(id))) || (value.playerRole&&!source.roles.includes(value.playerRole)))return;
  const tags=await db.query('SELECT tag_key,character_id FROM pc_post_tags WHERE owner_id=$1',[source.author]);
  const tagged=matchPrefix(source.content,tags as {tag_key:string;character_id:string}[]);
  if(!tagged && /^\s*(?:\/\/|\(\()/.test(source.content))return;
  const content=tagged?tagged.content:source.content;
  if(!content.trim())return;
  const [choice]=tagged?[tagged]:await db.query('SELECT character_id FROM pc_post_defaults WHERE owner_id=$1 AND channel_id IN ($2,$3) ORDER BY CASE WHEN channel_id=$2 THEN 0 ELSE 1 END LIMIT 1',[source.author,source.channel,source.parent||source.channel]);
  if(!choice?.character_id)return;
  const [sheet]=await db.query('SELECT c.*,a.form_key FROM pc_characters c LEFT JOIN pc_active_forms a ON a.character_id=c.id WHERE c.id=$1 AND c.owner_id=$2',[choice.character_id,source.author]);
  if(!sheet)return;
  const character=JSON.parse(sheet.sheet),form=activeForm(character,sheet.form_key);
  const reserved=await db.query('INSERT INTO pc_posts(source_id,channel_id,author_id,character_id,character_name,created_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_id) DO NOTHING RETURNING source_id',
    [source.id,source.channel,source.author,sheet.id,character.name,Date.now()]);
  if(!reserved.length)return;
  const posted=await send({name:form?(character.name+' ('+form.name+')').slice(0,80):character.name,portrait:form?.portrait||character.portrait||'',content});
  requireThat(discordId.test(posted),502,'Discord did not confirm a character post.');
  await db.query('UPDATE pc_posts SET posted_id=$1 WHERE source_id=$2',[posted,source.id]);
  await remove();
}

export async function startPosting(db:Store,config:Config,scope:RoleplayScope){
  const {Client,GatewayIntentBits,PermissionFlagsBits,MessageType}=await import('discord.js');
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],rest:{retries:0}});
  client.once('clientReady',async ready=>{
    scope.guild=ready.guilds.cache.get(config.guild)??null;
    console.log(scope.guild?'PhoenixCore is online in the Convergence Discord server.':'PhoenixCore connected but could not find its configured Discord server.');
    const guild=ready.guilds.cache.get(config.guild);
    if(!guild)return;
    try{
      const {value}=await readSettings(db);
      const checks=[['Character submissions',value.characterChannel],['Design submissions',value.designChannel],['OC updates',value.updatesForum]];
      for(const [label,id] of checks){
        try{
          const target=await guild.channels.fetch(id);
          if(!target || (label==='OC updates'?!forumType(target.type):!forumType(target.type)&&!writableType(target.type)))throw Error('Unexpected channel type');
          const flags=PermissionFlagsBits;
          const needed=[flags.ViewChannel,flags.EmbedLinks,flags.ReadMessageHistory];
          if(!target.isThread())needed.push(flags.SendMessages);
          if(forumType(target.type)||target.isThread())needed.push(flags.SendMessagesInThreads);
          const missing=target.permissionsFor(ready.user)?.missing(needed)??['ViewChannel'];
          if(missing.length)console.warn(label+' '+id+' missing bot permissions: '+missing.join(', '));
          else console.log(label+' '+id+' ready ('+(forumType(target.type)?'forum':target.isThread()?'thread':'text channel')+').');
        }catch{console.warn(label+' '+id+' is unavailable or has an unsupported channel type.');}
      }
    }catch{console.warn('Could not verify the Discord review destinations.');}
  });
  client.on('threadCreate',t=>scope.archiveEvent(t));
  client.on('threadUpdate',(_,t)=>scope.archiveEvent(t));
  client.on('threadDelete',t=>scope.archiveEvent(t,true));
  client.on('channelDelete',c=>{scope.archives.delete(c.id);});
  const hooks=new Map<string,Promise<any>>();
  async function channelHook(parent:any){
    const all=await parent.fetchWebhooks();
    return all.find((hook:any)=>hook.owner?.id===client.user?.id && hook.name==='PhoenixCore RP' && hook.token)
      || parent.createWebhook({name:'PhoenixCore RP',reason:'Convergence approved character posting'});
  }
  client.on('messageCreate',async message=>{
    if(!message.inGuild()||message.guildId!==config.guild||!message.member||message.author.bot||message.webhookId||!message.content||!message.guild.members.me)return;
    const roles=[...message.member.roles.cache.keys()],thread=message.channel.isThread()?message.channel:null;
    let settings:Settings;
    try{
      settings=(await readSettings(db)).value;
      if(await captureNative(db,config,{id:message.id,channel:message.channelId,parent:thread?.parentId||undefined,title:thread?.id===message.id?thread.name:'',guild:message.guildId,author:message.author.id,roles,content:message.content,attachments:[...message.attachments.values()],reply:!!message.reference},'',settings))return;
      const prefix=settings.commandPrefixes.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length).find(p=>message.content.startsWith(p));
      if(prefix){
        const command=/^(help|transform|revert-form)(?:\s+([\s\S]*))?$/i.exec(message.content.slice(prefix.length).trim());
        if(command){
          const [name,form]=(command[2]||'').split('|').map(x=>x.trim()),action=command[1].toLowerCase();
          const response=action==='help'?'Use /transform or /revert-form, or type '+prefix+'transform Character | Form. To submit a template in its review channel, start with '+prefix+'submit and the submission type.':(await characterCommand(db,config.guild,config.dashboard,{guild_id:message.guildId,member:{user:{id:message.author.id},roles},data:{name:action,options:[{name:'character',value:name},...(form?[{name:'form',value:form}]:[])]}})).data.content;
          await message.reply({content:response,allowedMentions:{parse:[],repliedUser:false}});return;
        }
      }
    }catch{console.warn('Discord submission or character command could not be processed.');return;}
    if(message.type!==MessageType.Default||message.attachments.size||message.stickers.size||message.poll||message.reference||!message.deletable)return;
    const channel=message.channel;
    const parent=channel.isThread()?channel.parent:channel;
    if(!parent||!('fetchWebhooks' in parent)||!('createWebhook' in parent))return;
    if(!channel.isTextBased())return;
    const permissions=channel.permissionsFor(message.guild.members.me);
    if(!permissions?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageMessages,channel.isThread()?PermissionFlagsBits.SendMessagesInThreads:PermissionFlagsBits.SendMessages]) ||
      !parent.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageWebhooks))return;
    const original=message.content;
    try {
      await relay(db,config,{id:message.id,channel:channel.id,parent:channel.isThread()?channel.parentId??undefined:undefined,guild:message.guildId,author:message.author.id,roles:[...message.member.roles.cache.keys()],content:original},async post=>{
        let pending=hooks.get(parent.id);
        if(!pending){pending=channelHook(parent);hooks.set(parent.id,pending);}
        try{
          const hook=await pending;
          const sent=await hook.send({username:post.name,avatarURL:post.portrait?new URL(post.portrait,config.dashboard).href:undefined,
            content:post.content,allowedMentions:{parse:[]},...(channel.isThread()?{threadId:channel.id}:{})});
          return sent.id;
        }catch(e){hooks.delete(parent.id);throw e;}
      },async()=>{
        const current=await message.fetch(true);
        if(current.content===original && !current.editedTimestamp && !current.attachments.size)await current.delete();
      },current=>scope.eligible(current,channel),settings);
    }catch{console.warn('Character post could not be completed. Original Discord posts are retained on delivery failure.');}
  });
  client.on('error',()=>console.warn('Discord roleplay connection reported an error.'));
  try{await client.login(config.token);}catch(e){await client.destroy();throw e;}
  return ()=>{scope.clear();return client.destroy();};
}
