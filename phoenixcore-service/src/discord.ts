import {characterCommand} from './characters.ts';
import forms from '../../phoenixcore/templates.js';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { Problem, requireThat, readSettings, visibleRequest, decide } from './domain.ts';
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
    const specs=[{name:'Character sheet',type:3},{name:'transform',type:1,description:'Switch your approved character to an attained form or base.',options:[
      {name:'character',description:'Your character name, posting tag or sheet ID',type:3,required:true,autocomplete:true},
      {name:'form',description:'Choose an attained form or base',type:3,required:true,autocomplete:true}]}];
    for(const spec of specs)await this.call(path,{method:'POST',body:JSON.stringify(spec)});
  }
  async sendReview(body: object, fallback: string) {
    try {
      const dm=await this.call('/users/@me/channels',{method:'POST',body:JSON.stringify({recipient_id:this.settings.owner})});
      await this.call('/channels/' + dm.id + '/messages',{method:'POST',body:JSON.stringify(body)});
    } catch(e) {
      if (!(e instanceof DiscordFailure) || e.status!==403 || !fallback) throw e;
      const channel=await this.call('/channels/' + fallback);
      if (channel.guild_id !== this.settings.guild) throw new Error('Review channel belongs to another guild.');
      await this.call('/channels/' + fallback + '/messages',{method:'POST',body:JSON.stringify(body)});
    }
  }
}

function brief(value: any, max=140) {
  const s=Array.isArray(value) ? value.map(v=>typeof v==='object' ? v.name+' +'+v.amount : v).join(', ') : String(value ?? '');
  const escaped=s.replace(/[\u0000-\u001f]/g,' ').replace(/([*_~`|>\\])/g,'\\$1');
  return escaped.length>max ? escaped.slice(0,max-1)+'…' : escaped || '—';
}
export function reviewMessage(r: ReturnType<typeof visibleRequest>, c: Config) {
  const waiting=r.status==='awaiting_judge';
  const type=forms.forms[r.kind]?.title??'Staff award';
  const fieldKind=forms.catalogue.includes(r.kind)?r.kind:'create';
  const captions:Record<string,string>=Object.fromEntries(forms.allFields(fieldKind).map((f:any)=>[f.key,f.label]));
  Object.assign(captions,{gear:'Gear',wallet:'Wallet',progress:'Training stats'});
  const notes=Object.entries(r.after).filter(([k,v])=>v!=='' && JSON.stringify(r.before?.[k])!==JSON.stringify(v) && (r.before || !Array.isArray(v) || v.length));
  const lines=notes.map(([k,v])=>'**'+(captions[k]??k)+'** '+(r.before?brief(r.before[k],70)+' → ':'')+brief(v,100));
  const fields=[{name:'Submitted by',value:'<@'+r.authorId+'>'},{name:'Reason',value:brief(r.reason,550)}];
  if(r.details?.claimed) fields.push({name:'Player claim',value:brief(r.details.claimed,400)});
  if(r.details?.approval) fields.push({name:'Approval requested',value:brief(r.details.approval,400)});
  if(r.judgment) fields.push({name:'Staff judgment',value:'<@'+r.judgment.judgeId+'> · '+brief(r.judgment.note,350)});
  if(r.award) fields.push({name:'Calculated award',value:'+'+r.award.gain+' BPL · +'+r.award.currency+' currency'+(r.award.stats?.length?' · '+r.award.stats.length+' stat gain(s)':'')});
  const buttons=[];
  if(!waiting) buttons.push({type:2,style:3,label:'Approve',custom_id:'pc:approve:'+r.id});
  buttons.push({type:2,style:4,label:'Decline',custom_id:'pc:decline:'+r.id},{type:2,style:5,label:'Full request',url:c.dashboard+'#request-'+r.id});
  return {content:'<@'+c.owner+'> '+(waiting?'A training claim is waiting for staff judgment.':'A submission is ready for your decision.'),
    allowed_mentions:{parse:[],users:[c.owner]},nonce:createHash('sha256').update(r.id+':'+r.status).digest('hex').slice(0,24),enforce_nonce:true,
    embeds:[{title:type+' · '+brief(r.after.name,70),description:lines.join('\n').slice(0,2700)||'The full claim is available in PhoenixCore.',
      color:0xea875b,fields,...((r.after.portrait||r.after.art)?{thumbnail:{url:new URL(r.after.portrait||r.after.art,c.dashboard).href}}:{}),footer:{text:'Open the full request for complete values and history.'}}],
    components:[{type:1,components:buttons}]};
}

export async function deliverNext(db: Store, discord: Discord, now=Date.now()) {
  const [r]=await db.query(`UPDATE pc_requests SET notify_after=$1,attempts=attempts+1
    WHERE id=(SELECT id FROM pc_requests WHERE status IN ('pending','awaiting_judge') AND notified=0 AND notify_after<=$2 ORDER BY created_ms LIMIT 1)
    AND notified=0 AND status IN ('pending','awaiting_judge') AND notify_after<=$2 RETURNING *`,[now+120000,now]);
  if (!r) return false;
  try {
    const {value}=await readSettings(db);
    await discord.sendReview(reviewMessage(visibleRequest(r),discord.settings),value.reviewChannel);
    await db.query('UPDATE pc_requests SET notified=1,last_notify_error=NULL WHERE id=$1 AND status=$2 AND attempts=$3',[r.id,r.status,r.attempts]);
  } catch(e) {
    const wait=Math.max(Math.min(3600000,5000 * 2**Math.min(Number(r.attempts),10)),e instanceof DiscordFailure?e.retryMs:0);
    await db.query('UPDATE pc_requests SET notify_after=$1,last_notify_error=$2 WHERE id=$3 AND status=$4 AND attempts=$5',[now+wait,e instanceof DiscordFailure?'Discord '+e.status:'Delivery unavailable',r.id,r.status,r.attempts]);
  }
  return true;
}

export function checkSignature(raw:Buffer, signature:string, timestamp:string, key:string, now=Date.now()) {
  if (!/^[0-9a-f]{128}$/i.test(signature) || !/^\d{9,12}$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300) return false;
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key,'hex')]),format:'der',type:'spki'});
  return verify(null,Buffer.concat([Buffer.from(timestamp),raw]),publicKey,Buffer.from(signature,'hex'));
}
export async function handleInteraction(db:Store, config:Config, body:any) {
  if (body.type===1) return {type:1};
  const reply=(content:string)=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
  if(body.application_id!==config.clientId || (body.guild_id && body.guild_id!==config.guild)) return reply('This action belongs to a different installation.');
  const actor=body.member?.user?.id ?? body.user?.id;
  if((body.type===2||body.type===4) && ['Character sheet','transform'].includes(body.data?.name))return characterCommand(db,config.guild,config.dashboard,body);
  if (actor !== config.owner) return reply('Only the configured PhoenixCore owner can decide this request.');
  const match=/^pc:(approve|decline):([0-9a-f-]{36})$/i.exec(body.data?.custom_id??'');
  if (body.type!==3 || !match) return reply('Unknown PhoenixCore action.');
  try {
    const r=await decide(db,actor,config.owner,match[2],match[1]==='approve');
    const label=r.status==='stale'?'Outdated · a newer sheet revision exists':r.status==='approved'?'Approved':'Declined';
    return {type:7,data:{content:label+' · '+brief(r.after.name,75),allowed_mentions:{parse:[]},embeds:[],components:[{type:1,components:[
      {type:2,style:5,label:'View decision',url:config.dashboard+'#request-'+r.id}]}]}};
  } catch(e) { if (e instanceof Problem) return reply(e.message); throw e; }
}
