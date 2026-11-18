import type { Channel, Guild, GuildBasedChannel, ThreadChannel } from 'discord.js';
import type { Actor, Settings } from './domain.ts';

type Ordered = { id:string; rawPosition:number };
type Archived = { id:string; name:string; parentId:string; type:number };
type ArchivePage = { threads:{id:string;name:string;type:number;thread_metadata:{archive_timestamp:string}}[]; has_more:boolean };
type Archive = { threads:Map<string,Archived>; scanned:number; generation:number; incomplete:boolean };
type Location = Archived & { missing?:string[] };
const availableParents = new Set([0,5,15,16]);
const interval = 10 * 60_000;

export function categoryOrder(a:Ordered,b:Ordered) {
  return a.rawPosition-b.rawPosition || (a.id===b.id?0:BigInt(a.id)<BigInt(b.id)?-1:1);
}
export function belowDivider(category:Ordered|null|undefined, divider:Ordered|null|undefined) {
  return !!category && !!divider && categoryOrder(category,divider)>0;
}

// Discord sends category moves and thread changes to the gateway. The actual
// message's parent determines eligibility even when a thread was archived.
export class RoleplayScope {
  guildId:string;
  guild:Guild|null=null;
  archives=new Map<string,Archive>();
  scanning=false;
  constructor(guildId:string) { this.guildId=guildId; }
  online() { return !!this.guild?.available && this.guild.client.isReady(); }
  clear() { this.guild=null; this.archives.clear(); }
  eligible(settings:Settings, channel:GuildBasedChannel) {
    if(!settings.rpDivider) return [channel.id,channel.isThread()?channel.parentId:''].some(id=>!!id&&settings.rpChannels.split(/\s+/).includes(id));
    if(!this.online() || channel.guildId!==this.guildId) return false;
    const parent=channel.isThread()?channel.parent:channel;
    const divider=this.guild!.channels.cache.get(settings.rpDivider);
    return divider?.type===4 && !!parent && !parent.isThread() && parent.type!==4 && belowDivider(parent.parent,divider);
  }
  archiveEvent(channel:Channel, removed=false) {
    if(!channel.isThread() || channel.guildId!==this.guildId || !channel.parentId) return;
    const archive=this.archives.get(channel.parentId);
    if(!archive)return;
    archive.generation++;
    if(removed || !channel.archived) archive.threads.delete(channel.id);
    else archive.threads.set(channel.id,{id:channel.id,name:channel.name,parentId:channel.parentId,type:channel.type});
  }
  async scan(parent:GuildBasedChannel, archive:Archive) {
    const guild=parent.guild, stamp=archive.generation, found=new Map<string,Archived>();
    const perms=guild.members.me && parent.permissionsFor(guild.members.me);
    if(!perms?.has('ReadMessageHistory')){archive.incomplete=true;archive.scanned=Date.now();return;}
    const kinds=['public'];
    if(parent.type===0)kinds.push(perms.has('ManageThreads')?'private':'joined');
    let incomplete=false;
    for(const kind of kinds){
      const end=kind==='joined'?'users/@me/threads/archived/private':'threads/archived/'+kind;
      let before='';
      try{
        for(;;){
          const query=new URLSearchParams({limit:'100'});
          if(before)query.set('before',before);
          const page=await guild.client.rest.get(('/channels/'+parent.id+'/'+end) as `/${string}`,{query}) as ArchivePage;
          for(const t of page.threads)found.set(t.id,{id:t.id,name:t.name,parentId:parent.id,type:t.type});
          const last=page.threads.at(-1);
          const cursor=last && (kind==='joined'?last.id:last.thread_metadata.archive_timestamp);
          if(!page.has_more)break;
          if(!cursor || cursor===before){incomplete=true;break;}
          before=cursor;
        }
      }catch{incomplete=true;}
    }
    if(stamp!==archive.generation)return;
    if(incomplete)for(const [id,t] of archive.threads)if(!found.has(id))found.set(id,t);
    archive.threads=found; archive.scanned=Date.now(); archive.incomplete=incomplete;
  }
  queueArchives(parents:GuildBasedChannel[]) {
    if(this.scanning || !this.online())return;
    const pending=parents.filter(p=>availableParents.has(p.type) && Date.now()-(this.archives.get(p.id)?.scanned||0)>interval);
    if(!pending.length)return;
    this.scanning=true;
    const run=async()=>{
      for(const parent of pending){
        if(!this.online())break;
        let archive=this.archives.get(parent.id);
        if(!archive){archive={threads:new Map(),scanned:0,generation:0,incomplete:false};this.archives.set(parent.id,archive);}
        await this.scan(parent,archive);
      }
    };
    void run().catch(()=>console.warn('RP archive listing will retry.')).finally(()=>{this.scanning=false;});
  }
  async inventory(settings:Settings, actor:Actor) {
    const guild=this.guild;
    const result={online:this.online(), categories:[] as {id:string;name:string}[], locations:[] as Location[], scanning:false, incomplete:0};
    if(!guild || !result.online)return result;
    const cache=guild.channels.cache;
    if(actor.isOwner)result.categories=[...cache.values()].filter(c=>c.type===4).sort(categoryOrder).map(c=>({id:c.id,name:c.name}));
    const member=actor.isOwner?null:(guild.members.cache.get(actor.id) || await guild.members.fetch(actor.id).catch(()=>null));
    if(!actor.isOwner && !member)return result;
    const parents=[...cache.values()].filter(c=>!c.isThread() && c.type!==4 && this.eligible(settings,c));
    if(settings.rpDivider)this.queueArchives(parents);
    const entries=new Map<string,Location>();
    const add=(p:GuildBasedChannel,c:Archived,thread?:ThreadChannel)=>{
      if(member && !p.permissionsFor(member)?.has('ViewChannel'))return;
      if(member && c.type===12 && !p.permissionsFor(member)?.has('ManageThreads') && !thread?.members.cache.has(member.id))return;
      let missing:string[]|undefined;
      if(actor.isOwner && guild.members.me){
        const permissions=p.permissionsFor(guild.members.me);
        const required=['ViewChannel','ReadMessageHistory','ManageMessages','ManageWebhooks',...(thread||[10,11,12,15,16].includes(c.type)?['SendMessagesInThreads']:['SendMessages'])] as const;
        missing=required.filter(permission=>!permissions?.has(permission as import('discord.js').PermissionResolvable));
      }
      entries.set(c.id,{...c,...(missing?.length?{missing}:{})});
    };
    for(const p of parents){
      add(p,{id:p.id,name:p.name,parentId:p.parentId||'',type:p.type});
      if(settings.rpDivider)for(const t of this.archives.get(p.id)?.threads.values()||[])add(p,t);
    }
    for(const t of cache.values())if(t.isThread() && t.parent && this.eligible(settings,t))add(t.parent,{id:t.id,name:t.name,parentId:t.parent.id,type:t.type},t);
    result.locations=[...entries.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    result.scanning=this.scanning;
    result.incomplete=parents.filter(p=>this.archives.get(p.id)?.incomplete).length;
    return result;
  }
}
