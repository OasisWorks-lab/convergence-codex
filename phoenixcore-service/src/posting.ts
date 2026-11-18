import {activeForm} from './characters.ts';
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
      try {tag=forms.normalizeTag(input.tag);} catch {requireThat(false,400,'Use a valid posting tag of 1–24 characters.');}
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
export async function relay(db:Store,config:Config,source:IncomingPost,send:(post:CharacterPost)=>Promise<string>,remove:()=>Promise<void>,inScope?:(settings:Settings)=>boolean){
  if(source.guild!==config.guild || !source.content.trim() || source.content.length>2000 || /^\s*(?:\/\/|\(\()/.test(source.content))return;
  const {value}=await readSettings(db);
  if(!(value.rpDivider?inScope?.(value):[source.channel,source.parent||''].some(id=>channelIds(value).includes(id))) || (value.playerRole&&!source.roles.includes(value.playerRole)))return;
  const tags=await db.query('SELECT tag,character_id FROM pc_post_tags WHERE owner_id=$1 ORDER BY LENGTH(tag) DESC,tag',[source.author]);
  const lower=source.content.toLowerCase();
  const tagged=tags.find(t=>lower.startsWith(forms.trigger(t.tag)));
  const trigger=tagged?forms.trigger(tagged.tag):'';
  if(!tagged && /^[^\\s>]+>/.test(source.content))return;
  let content=source.content;
  if(tagged){content=content.slice(trigger.length);if(!trigger.endsWith('>')&&content.startsWith('>'))content=content.slice(1);content=content.trimStart();}
  if(!content.trim())return;
  const [choice]=tagged?[tagged]:await db.query('SELECT character_id FROM pc_post_defaults WHERE owner_id=$1 AND channel_id IN ($2,$3) ORDER BY CASE WHEN channel_id=$2 THEN 0 ELSE 1 END LIMIT 1',[source.author,source.channel,source.parent||source.channel]);
  if(!choice?.character_id)return;
  const [sheet]=await db.query('SELECT c.*,a.form_key FROM pc_characters c LEFT JOIN pc_active_forms a ON a.character_id=c.id WHERE c.id=$1 AND c.owner_id=$2',[choice.character_id,source.author]);
  if(!sheet)return;
  const character=JSON.parse(sheet.sheet),form=activeForm(character,sheet.form_key);
  const reserved=await db.query('INSERT INTO pc_posts(source_id,channel_id,author_id,character_id,character_name,created_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_id) DO NOTHING RETURNING source_id',
    [source.id,source.channel,source.author,sheet.id,character.name,Date.now()]);
  if(!reserved.length)return;
  const posted=await send({name:character.name,portrait:form?.portrait||character.portrait||'',content});
  requireThat(discordId.test(posted),502,'Discord did not confirm a character post.');
  await db.query('UPDATE pc_posts SET posted_id=$1 WHERE source_id=$2',[posted,source.id]);
  await remove();
}

export async function startPosting(db:Store,config:Config,scope:RoleplayScope){
  const {Client,GatewayIntentBits,PermissionFlagsBits,MessageType}=await import('discord.js');
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],rest:{retries:0}});
  client.once('clientReady',ready=>{
    scope.guild=ready.guilds.cache.get(config.guild)??null;
    console.log(scope.guild?'PhoenixCore is online in the Convergence Discord server.':'PhoenixCore connected but could not find its configured Discord server.');
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
    if(!message.inGuild() || message.guildId!==config.guild || !message.member || message.author.bot || message.webhookId ||
      message.type!==MessageType.Default || message.attachments.size || message.stickers.size || message.poll || message.reference ||
      !message.deletable || !message.content || !message.guild.members.me)return;
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
      },settings=>scope.eligible(settings,channel));
    }catch{console.warn('Character post could not be completed. Original Discord posts are retained on delivery failure.');}
  });
  client.on('error',()=>console.warn('Discord roleplay connection reported an error.'));
  try{await client.login(config.token);}catch(e){await client.destroy();throw e;}
  return ()=>{scope.clear();return client.destroy();};
}
