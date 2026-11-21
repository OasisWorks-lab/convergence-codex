import { npcCommands, sceneInteraction } from './npc-scenes.ts';
import type { RoleplayScope } from './scope.ts';
import {characterCommand} from './characters.ts';
import forms from '../../phoenixcore/templates.js';
import { createPublicKey, verify, createHash } from 'node:crypto';
import {captureNative} from './native.ts';
import {assess} from './review-rules.ts';
import {defaultSettings} from './db.ts';
import { Problem, requireThat, visibleRequest, decide,readSettings,actorFor } from './domain.ts';
import type { Store } from './db.ts';

export type Config = { service: string; dashboard: string; clientId: string; clientSecret: string; publicKey: string; token: string; guild: string; owner: string };
type Member = { user: { id:string; username:string; global_name?:string; avatar?:string|null; discriminator?:string; bot?:boolean }; nick?:string; roles:string[] };
export function accountAvatar(user:Member['user']){
  if(user.avatar&&/^(a_)?[a-f0-9]+$/i.test(user.avatar))return 'https://cdn.discordapp.com/avatars/'+user.id+'/'+user.avatar+(user.avatar.startsWith('a_')?'.gif':'.png')+'?size=128';
  const index=user.discriminator&&user.discriminator!=='0'?Number(user.discriminator)%5:Number((BigInt(user.id)>>22n)%6n);
  return 'https://cdn.discordapp.com/embed/avatars/'+index+'.png';
}
export class DiscordFailure extends Error {
  status: number;
  retryMs: number;
  constructor(status: number, retryMs=0) { super('Discord HTTP ' + status); this.status=status; this.retryMs=retryMs; }
}

export class Discord {
  settings: Config;
  fetcher: typeof fetch;
  cache: { until:number; value:Member[] } | null = null;
  inFlight: Promise<Member[]> | null = null;
  constructor(settings: Config, fetcher=fetch) { this.settings=settings; this.fetcher=fetcher; }
  async call(path: string, init: RequestInit = {}) {
    const headers=new Headers(init.headers);
    if (!headers.has('authorization') && path !== '/oauth2/token') headers.set('authorization','Bot ' + this.settings.token);
    if (init.body && !headers.has('content-type')) headers.set('content-type','application/json');
    const response=await this.fetcher('https://discord.com/api/v10' + path, { ...init, headers, signal:AbortSignal.timeout(8500) });
    if (!response.ok) {
      const info=response.status === 429 ? await response.json().catch(()=>({})) : {};
      throw new DiscordFailure(response.status, Math.ceil(Number(info.retry_after || 0) * 1000));
    }
    return response.status === 204 ? null : response.json();
  }
  authorizeUrl(state: string) {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search=new URLSearchParams({ client_id:this.settings.clientId, response_type:'code', scope:'identify',
      redirect_uri:this.settings.service + '/auth/callback', state }).toString();
    return url.toString();
  }
  async identify(code: string) {
    const data=await this.call('/oauth2/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:this.settings.clientId,client_secret:this.settings.clientSecret,grant_type:'authorization_code',
        code, redirect_uri:this.settings.service + '/auth/callback'}) });
    const user=await this.call('/users/@me',{headers:{authorization:'Bearer ' + data.access_token}});
    return user.id as string;
  }
  async member(id: string): Promise<Member> {
    try {
      const m=await this.call('/guilds/' + this.settings.guild + '/members/' + id);
      requireThat(m.user?.id === id && !m.user.bot,403,'Sign in with a current Convergence member account.');
      return m;
    } catch (e) {
      if (e instanceof DiscordFailure && e.status===404) throw new Problem(403,'This Discord account is not a member of Convergence.');
      throw e;
    }
  }
  async members(): Promise<Member[]> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.value;
    if (!this.inFlight) this.inFlight=this.fetchMembers().finally(()=>{this.inFlight=null;});
    return this.inFlight;
  }
  private async fetchMembers() {
    const all:Member[]=[];
    let after='0';
    for (;;) {
      const page:Member[]=await this.call('/guilds/' + this.settings.guild + '/members?limit=1000&after=' + after);
      all.push(...page.filter(m=>m.user && !m.user.bot));
      if (page.length<1000) break;
      const cursor=page[page.length-1].user.id;
      if (BigInt(cursor)<=BigInt(after)) throw new Error('Discord returned an invalid member cursor.');
      after=cursor;
    }
    this.cache={value:all,until:Date.now()+30000};
    return all;
  }
  async registerCommands(){
    const path='/applications/'+this.settings.clientId+'/guilds/'+this.settings.guild+'/commands';
    const specs=[{name:'Catalog submission',type:3},{name:'Character sheet',type:3},{name:'transform',type:1,description:'Switch your approved character to an attained form or base.',options:[
      {name:'character',description:'Your character name, posting tag or sheet ID',type:3,required:true,autocomplete:true},
      {name:'form',description:'Choose an attained form or base',type:3,required:true,autocomplete:true}]}];
    specs.push({name:'revert-form',type:1,description:'Return to base or an earlier attained form.',options:[{name:'character',type:3,description:'Your approved character',required:true,autocomplete:true},{name:'form',type:3,description:'Base or an earlier attained form',required:false,autocomplete:true}]});
    for(const spec of [...specs,...npcCommands()])await this.call(path,{method:'POST',body:JSON.stringify(spec)});
  }
  async guildChannel(id:string) {
    const channel=await this.call('/channels/'+id);
    if(channel.id!==id || channel.guild_id!==this.settings.guild) throw new Error('Review destination is outside Convergence.');
    return channel;
  }
}

function brief(value: any, max=140) {
  const s=Array.isArray(value) ? value.map(v=>typeof v==='object' ? v.name+' +'+v.amount : v).join(', ') : String(value ?? '');
  const escaped=s.replace(/[\u0000-\u001f]/g,' ').replace(/([*_~`|>\\])/g,'\\$1');
  return escaped.length>max ? escaped.slice(0,max-1)+'…' : escaped || '—';
}
export function reviewMessage(r: ReturnType<typeof visibleRequest>, c: Config, settings=defaultSettings, ownerDm=false, denialNote='',decisionKey='') {
  const waiting=r.status==='awaiting_judge', open=waiting||r.status==='pending'||r.status==='needs_details';
  const type=forms.forms[r.kind]?.title??'Staff award';
  const fieldKind=forms.catalogue.includes(r.kind)?r.kind:'create';
  const captions:Record<string,string>=Object.fromEntries(forms.allFields(fieldKind).map((f:any)=>[f.key,f.label]));
  Object.assign(captions,{gear:'Gear',wallet:'Wallet',progress:'Training stats'});
  const notes=Object.entries(r.after).filter(([k,v])=>v!=='' && JSON.stringify(r.before?.[k])!==JSON.stringify(v) && (r.before || !Array.isArray(v) || v.length));
  const reviewValue=(key:string,value:any,limit:number)=>key==='attainedForms'?brief(forms.readForms(value).map((f:any)=>f.name+(f.portrait?' (artwork)':'')).join(', '),limit):brief(value,limit);
  const lines=notes.map(([k,v])=>'**'+(captions[k]??k)+'** '+(r.before?reviewValue(k,r.before[k],70)+' → ':'')+reviewValue(k,v,100));
  const fields=[{name:'Submitted by',value:'<@'+r.authorId+'>'},{name:'Reason',value:brief(r.reason,550)}];
  if(r.details?.formula) fields.push({name:'Training breakdown',value:brief(r.details.formula,350)});
  if(r.details?.claimed) fields.push({name:'Player claim',value:brief(r.details.claimed,400)});
  if(r.details?.approval) fields.push({name:'Approval requested',value:brief(r.details.approval,400)});
  if(r.judgment) fields.push({name:'Staff judgment',value:'<@'+r.judgment.judgeId+'> · '+brief(r.judgment.note,350)});
  if(r.award) fields.push({name:'Calculated award',value:'+'+r.award.gain+' BPL · +'+r.award.currency+' currency'+(r.award.stats?.length?' · '+r.award.stats.length+' stat gain(s)':'')});
  const buttons=[];
  if(r.details?.scene)fields.push({name:'Training scene',value:r.details.scene});
  if(r.status==='pending') buttons.push({type:2,style:3,label:'Approve',custom_id:'pc:approve:'+r.id});
  if(open)buttons.push({type:2,style:4,label:'Decline',custom_id:'pc:decline:'+r.id});
  if(ownerDm&&r.status==='owner_review'){
    buttons.push({type:2,style:4,label:'Uphold denial',custom_id:'pc:uphold:'+r.id+':'+decisionKey},{type:2,style:3,label:'Veto denial',custom_id:'pc:veto:'+r.id+':'+decisionKey});
    if(denialNote)fields.push({name:'Helper’s reason',value:brief(denialNote,600)});
  }
  if(open||r.status==='owner_review')buttons.push({type:2,style:2,label:'Staff checks',custom_id:'pc:checks:'+r.id});
  buttons.push({type:2,style:5,label:waiting?'Review training':open?'Full request':'View decision',url:c.dashboard+'#request-'+r.id});
  const labels:Record<string,string>={approved:'Approved',declined:'Declined',stale:'Outdated',archived:'Archived',owner_review:'A Helper denied this request. Awaiting the owner’s decision.'};
  const mention=settings.judgeRole?'<@&'+settings.judgeRole+'>':'';
  const substitutions:Record<string,string>={helper:mention,type,character:brief(r.after.name,80),player:'<@'+r.authorId+'>'};
  let content=open?settings.submissionMessage.replace(/\{(helper|type|character|player)\}/g,(_,k)=>substitutions[k]):labels[r.status]||r.status;
  if(open&&mention&&!content.includes(mention))content=mention+' '+content;
  return {content,allowed_mentions:{parse:[],roles:open&&settings.judgeRole?[settings.judgeRole]:[]}, nonce:createHash('sha256').update(r.id+':'+r.status+decisionKey).digest('hex').slice(0,24),enforce_nonce:true,
    embeds:[{title:type+' · '+brief(r.after.name,70),description:lines.join('\n').slice(0,2700)||'The full claim is available in PhoenixCore.',
      color:0xea875b,fields,...((forms.validImage(r.after.portrait||r.after.art||''))?{image:{url:new URL(r.after.portrait||r.after.art,c.dashboard).href}}:{}),footer:{text:'PhoenixCore request '+r.id}}],
    components:[{type:1,components:buttons}]};
}

export {deliverNext} from './review-delivery.ts';

export function checkSignature(raw:Buffer, signature:string, timestamp:string, key:string, now=Date.now()) {
  if (!/^[0-9a-f]{128}$/i.test(signature) || !/^\d{9,12}$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300) return false;
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key,'hex')]),format:'der',type:'spki'});
  return verify(null,Buffer.concat([Buffer.from(timestamp),raw]),publicKey,Buffer.from(signature,'hex'));
}
export async function handleInteraction(db:Store, config:Config, body:any,discord=new Discord(config),defer?:(work:()=>Promise<string>)=>void,scope?:RoleplayScope) {
  if (body.type===1) return {type:1};
  const reply=(content:string)=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
  if(body.application_id!==config.clientId || (body.guild_id && body.guild_id!==config.guild)) return reply('This action belongs to a different installation.');
  const actor=body.member?.user?.id ?? body.user?.id;
  if(((body.type===2||body.type===4)&&['roleplay-start','roleplay-status','roleplay-cancel'].includes(body.data?.name)) ||
      ((body.type===3||body.type===5)&&String(body.data?.custom_id||'').startsWith('npc:')))return sceneInteraction(db,config,body,scope);
  if((body.type===2||body.type===4) && ['Character sheet','transform','revert-form'].includes(body.data?.name))return characterCommand(db,config.guild,config.dashboard,body);
  if(body.data?.name==='Catalog submission'||String(body.data?.custom_id||'').startsWith('pc:catalog:')){
    const {value}=await readSettings(db);
    if(body.guild_id!==config.guild||!body.member?.user?.id||!actorFor(actor,body.member.roles||[],config.owner,value).isJudge)return reply('Only a Convergence Helper or the owner can catalog a message.');
    if(body.type===2&&body.data.name==='Catalog submission'){
      const message=body.data.resolved?.messages?.[body.data.target_id];
      if(!message||message.author?.bot||message.webhook_id)return reply('Choose a player’s original submission.');
      const destination=body.channel?.parent_id||([value.characterChannel,value.designChannel].includes(body.channel_id)?body.channel_id:(await discord.guildChannel(body.channel_id)).parent_id);
      const kinds=[body.channel_id,destination].includes(value.characterChannel)?['create']:[body.channel_id,destination].includes(value.designChannel)?forms.catalogue:destination===value.updatesForum?['edit','training']:[];
      if(!kinds.length)return reply('Choose a message in a configured submission channel or player updates thread.');
      return {type:4,data:{flags:64,content:'Which template did the player submit?',components:[{type:1,components:kinds.map((kind:string)=>({type:2,style:2,label:forms.forms[kind].title,custom_id:['pc','catalog',kind,body.channel_id,message.id].join(':')}))}]}};
    }
    const ids=/^pc:catalog:(create|technique|item|race|transformation|edit|training):(\d{17,20}):(\d{17,20})$/.exec(body.data.custom_id);
    if(body.type!==3||!ids||ids[2]!==body.channel_id)return reply('Choose the submission again from its original channel.');
    const catalog=async()=>{
      const channel=await discord.guildChannel(ids[2]);
      const message=await discord.call('/channels/'+channel.id+'/messages/'+ids[3]);
      if(message.author?.bot||message.webhook_id||!message.content)return 'Choose an original text submission from a player.';
      const writer=await discord.member(message.author.id);
      const id=await captureNative(db,config,{id:message.id,author:writer.user.id,roles:writer.roles,channel:channel.id,parent:channel.parent_id,guild:config.guild,content:message.content,title:channel.id===message.id?channel.name:'',attachments:message.attachments},ids[1]);
      return id?'Open the cataloged request: '+config.dashboard+'#request-'+id:'This template or writer does not match the configured submission channel.';
    };
    if(defer){defer(catalog);return {type:5,data:{flags:64}};}
    return reply(await catalog());
  }
  const match=/^pc:(approve|decline|uphold|veto|checks):([0-9a-f-]{36})(?::([0-9a-f-]{36}))?$/i.exec(body.data?.custom_id??'');
  if (body.type!==3 || !match) return reply('Unknown PhoenixCore action.');
  try {
    const roles=body.guild_id===config.guild?body.member?.roles||[]:[],{value}=await readSettings(db);
    requireThat(actorFor(actor,roles,config.owner,value).isJudge,403,'Only the configured owner or a Convergence Helper can review this request.');
    if(match[1]==='checks'){
      const [row]=await db.query('SELECT * FROM pc_requests WHERE id=$1',[match[2]]);
      requireThat(row,404,'Request unavailable.');
      const report=assess(visibleRequest(row),value);
      return reply(('**'+report.summary+'**\n'+report.checks.map(c=>'**'+c.label+'** · '+c.detail).join('\n')).slice(0,1980));
    }
    const r=await decide(db,actor,config.owner,match[2],match[1]==='approve',roles,['uphold','veto'].includes(match[1])?match[1]:'review','',match[3]||'');
    const {nonce,enforce_nonce,...data}=reviewMessage(r,config,value,!body.guild_id);
    return {type:7,data};
  } catch(e) { if (e instanceof Problem) return reply(e.message); throw e; }
}
