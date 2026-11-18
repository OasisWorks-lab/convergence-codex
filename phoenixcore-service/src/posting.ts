import { discordId, readSettings, requireThat, type Actor, type Settings } from './domain.ts';
import type { Store } from './db.ts';
import type { Config } from './discord.ts';

const tagPattern=/^[a-z0-9][a-z0-9_-]{0,23}$/;
const channelIds=(settings:Settings)=>settings.rpChannels.split(/\s+/).filter(Boolean);
export async function preferences(db:Store,actor:Actor,settings:Settings) {
  const [tags,defaults]=await Promise.all([
    db.query('SELECT character_id,tag FROM pc_post_tags WHERE owner_id=$1 ORDER BY tag',[actor.id]),
    db.query('SELECT channel_id,character_id FROM pc_post_defaults WHERE owner_id=$1 ORDER BY channel_id',[actor.id])
  ]);
  const channels=channelIds(settings);
  return {tags:tags.map(t=>({characterId:t.character_id,tag:t.tag})),channels,
    defaults:defaults.filter(d=>channels.includes(d.channel_id)).map(d=>({channel:d.channel_id,characterId:d.character_id}))};
}
export async function savePosting(db:Store, actor:Actor, input:any) {
  requireThat(actor.isPlayer,403,'Only current players can set posting preferences.');
  requireThat(input && typeof input.characterId==='string' && ['tag','default'].includes(input.kind),400,'Choose a character posting preference.');
  await db.transaction(async q=>{
    if(input.characterId || input.kind==='tag'){
      const [sheet]=await q('SELECT owner_id FROM pc_characters WHERE id=$1',[input.characterId]);
      requireThat(sheet?.owner_id===actor.id,403,'Choose one of your approved characters.');
    }
    if(input.kind==='tag'){
      requireThat(typeof input.tag==='string',400,'Enter a character tag.');
      const tag=input.tag.trim().toLowerCase();
      requireThat(!tag||tagPattern.test(tag),400,'Use a tag of 1–24 letters, numbers, underscores or hyphens.');
      await q('DELETE FROM pc_post_tags WHERE owner_id=$1 AND character_id=$2',[actor.id,input.characterId]);
      if(tag){
        const added=await q('INSERT INTO pc_post_tags(owner_id,tag,character_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING tag',[actor.id,tag,input.characterId]);
        requireThat(added.length,409,'That tag is already assigned. Refresh your preferences.');
      }
    } else {
      const [row]=await q('SELECT value FROM pc_config WHERE slot=1');
      requireThat(discordId.test(input.channel) && channelIds({rpChannels:'',...JSON.parse(row.value)}).includes(input.channel),400,'Choose an enabled roleplay channel.');
      if(!input.characterId)await q('DELETE FROM pc_post_defaults WHERE owner_id=$1 AND channel_id=$2',[actor.id,input.channel]);
      else await q('INSERT INTO pc_post_defaults(owner_id,channel_id,character_id) VALUES($1,$2,$3) ON CONFLICT(owner_id,channel_id) DO UPDATE SET character_id=excluded.character_id',[actor.id,input.channel,input.characterId]);
    }
  });
}
export async function lookupAuthor(db:Store,actor:Actor,message:string){
  requireThat(actor.isJudge,403,'Only staff can look up the writer of a character post.');
  requireThat(discordId.test(message),400,'Use a Discord message ID.');
  const [row]=await db.query('SELECT author_id,character_name FROM pc_posts WHERE posted_id=$1',[message]);
  requireThat(row,404,'PhoenixCore has no recorded character post with that message ID.');
  return {authorId:row.author_id,characterName:row.character_name};
}

type IncomingPost={id:string;channel:string;guild:string;author:string;roles:string[];content:string};
type CharacterPost={content:string;name:string;portrait:string};
export async function relay(db:Store,config:Config,source:IncomingPost,send:(post:CharacterPost)=>Promise<string>,remove:()=>Promise<void>){
  if(source.guild!==config.guild || !source.content.trim() || source.content.length>2000 || /^\s*(?:\/\/|\(\()/.test(source.content))return;
  const {value}=await readSettings(db);
  if(!channelIds(value).includes(source.channel) || (value.playerRole&&!source.roles.includes(value.playerRole)))return;
  const explicit=/^([a-z0-9][a-z0-9_-]{0,23})>\s*([\s\S]*)$/i.exec(source.content);
  if(!explicit && /^[^\s>]+>/.test(source.content))return;
  const content=explicit?explicit[2]:source.content;
  if(!content.trim())return;
  const [sheet]=explicit
    ?await db.query('SELECT c.* FROM pc_characters c JOIN pc_post_tags t ON t.character_id=c.id AND t.owner_id=c.owner_id WHERE t.owner_id=$1 AND t.tag=$2',[source.author,explicit[1].toLowerCase()])
    :await db.query('SELECT c.* FROM pc_characters c JOIN pc_post_defaults d ON d.character_id=c.id AND d.owner_id=c.owner_id WHERE d.owner_id=$1 AND d.channel_id=$2',[source.author,source.channel]);
  if(!sheet)return;
  const character=JSON.parse(sheet.sheet);
  const reserved=await db.query('INSERT INTO pc_posts(source_id,channel_id,author_id,character_id,character_name,created_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_id) DO NOTHING RETURNING source_id',
    [source.id,source.channel,source.author,sheet.id,character.name,Date.now()]);
  if(!reserved.length)return;
  const posted=await send({name:character.name,portrait:character.portrait||'',content});
  requireThat(discordId.test(posted),502,'Discord did not confirm a character post.');
  await db.query('UPDATE pc_posts SET posted_id=$1 WHERE source_id=$2',[posted,source.id]);
  await remove();
}

export async function startPosting(db:Store,config:Config){
  const {Client,GatewayIntentBits,PermissionFlagsBits,MessageType,ChannelType}=await import('discord.js');
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],rest:{retries:0}});
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
    if(!channel.isThread() && channel.type!==ChannelType.GuildText && channel.type!==ChannelType.GuildAnnouncement)return;
    const permissions=channel.permissionsFor(message.guild.members.me);
    if(!permissions?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageMessages,channel.isThread()?PermissionFlagsBits.SendMessagesInThreads:PermissionFlagsBits.SendMessages]) ||
      !parent.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageWebhooks))return;
    const original=message.content;
    try {
      await relay(db,config,{id:message.id,channel:channel.id,guild:message.guildId,author:message.author.id,roles:[...message.member.roles.cache.keys()],content:original},async post=>{
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
      });
    }catch{console.warn('Character post could not be completed. Original Discord posts are retained on delivery failure.');}
  });
  client.on('error',()=>console.warn('Discord roleplay connection reported an error.'));
  try{await client.login(config.token);}catch(e){await client.destroy();throw e;}
  return ()=>client.destroy();
}
