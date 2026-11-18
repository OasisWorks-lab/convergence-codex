import {createHash} from 'node:crypto';
import forms from '../../phoenixcore/templates.js';
import {actorFor,Problem,propose,readSettings,type Settings} from './domain.ts';
import {attachImage,maxImageBytes,saveImage} from './media.ts';
import type {Store} from './db.ts';
import type {Config} from './discord.ts';

const clean=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const kinds:Record<string,string>={oc:'create',npc:'create',character:'create','new character':'create','oc npc template':'create',technique:'technique',item:'item',race:'race',form:'transformation',transformation:'transformation','oc update':'edit','character update':'edit',update:'edit',training:'training'};
const aliases:Record<string,string>={'name alias':'name','lore backstory':'bio','family irp':'family','enemies irp':'enemies','race path class':'lineage','strengths 3 required':'strengths','weaknesses 3 required':'weaknesses','strengths':'strengths','weaknesses':'weaknesses','type':'techType','visual appearance':'appearance','effects abilities':'effects','form name':'name','technique name':'name','item name':'name','race name':'name','final pl stat increase claimed':'claimed','training goal s':'goals','approval request':'approval','reason for update':'reason','occupation role':'occupation','description':'description','bpl':'bpl','character name':'name','portrait':'portrait','path':'path'};
type Source={id:string;channel:string;parent?:string;guild:string;author:string;roles:string[];content:string;title?:string;attachments?:any[];bot?:boolean;reply?:boolean};
function identifier(id:string){
  const hex=createHash('sha256').update('phoenixcore:discord:'+id).digest('hex');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
export function parseNative(raw:string,channelKind:string,title='',explicit=false){
  const lines=raw.normalize('NFKC').split(/\r?\n/);
  const header=clean(title+' '+lines.slice(0,3).join(' '));
  const type=Object.entries(kinds).find(([name])=>new RegExp('(?:^| )'+name+' (?:submission|request|template)(?: |$)').test(header))?.[1];
  const explicitKind=explicit?Object.entries(kinds).sort(([a],[b])=>b.length-a.length).find(([k])=>clean(lines[0]).startsWith(k+' ')||clean(lines[0])===k)?.[1]:undefined;
  let kind=explicitKind||type;
  if(!kind){
    if(/technique name/i.test(raw))kind='technique';else if(/item name/i.test(raw))kind='item';else if(/race name/i.test(raw))kind='race';else if(/form name/i.test(raw))kind='transformation';
    else if(/training (?:location|type|goal)/i.test(raw))kind='training';else if(/reason for update|updated description/i.test(raw))kind='edit';
    else if(channelKind==='character')kind='create';else if(channelKind==='updates')kind='edit';
  }
  if(!kind || channelKind==='character'&&kind!=='create'||channelKind==='design'&&!forms.catalogue.includes(kind)||channelKind==='updates'&&!['edit','training'].includes(kind))return;
  const allowed=[...forms.allFields(kind),...(['edit','training'].includes(kind)?forms.allFields('create'):[])];
  const keys=new Map([...Object.entries(aliases),...allowed.flatMap((f:any)=>[[clean(f.label),f.key],[clean(f.key),f.key]])]);
  const values:Record<string,string>={};
  let active='',labels=0;
  for(const original of lines){
    const line=original.replace(/^[\s#>*•-]+/,'').replace(/\*\*|__/g,'');
    const match=/^([^:]{1,78}):\s*(.*)$/.exec(line);
    if(match && keys.has(clean(match[1]))){
      active=String(keys.get(clean(match[1])));values[active]=match[2].trim();labels++;continue;
    }
    if(match || (/^[#*-]/.test(original)&&/──|✦/.test(original))){active='';continue;}
    if(active)values[active]+='\n'+line;
  }
  if(!labels&&!type&&!explicit&&!title)return;
  if(!kind||(!explicit&&!type&&labels<2&&!title))return;
  for(const k of Object.keys(values))values[k]=values[k].trim();
  if(kind==='technique'&&values.techType)values.techType=values.techType.split(/\s|[|–-]/)[0].toUpperCase();
  return {kind,values};
}
export async function captureNative(db:Store,config:Config,src:Source,chosenKind='',settings?:Settings){
  if(src.guild!==config.guild||src.bot||src.reply||!src.content.trim()||!/^\d{17,20}$/.test(src.id))return;
  const value=settings||(await readSettings(db)).value,who=actorFor(src.author,src.roles,config.owner,value);
  if(!who.isPlayer)return;
  let channelKind='';
  if([src.channel,src.parent].includes(value.characterChannel))channelKind='character';
  else if([src.channel,src.parent].includes(value.designChannel))channelKind='design';
  else if(src.parent===value.updatesForum&&(await db.query('SELECT 1 FROM pc_forum_threads WHERE forum_id=$1 AND thread_id=$2 AND subject=$3',[src.parent,src.channel,'player:'+src.author])).length)channelKind='updates';
  if(!channelKind)return;
  const prefix=value.commandPrefixes.split(/\s+/).filter(Boolean).find(p=>src.content.toLowerCase().startsWith(p.toLowerCase()+'submit '));
  const forcedLabel=Object.entries(kinds).find(([,kind])=>kind===chosenKind)?.[0];
  const parsed=parseNative(forcedLabel?forcedLabel+'\n'+src.content:prefix?src.content.slice(prefix.length+7):src.content,channelKind,src.title||'',!!prefix||!!forcedLabel);
  if(!parsed)return;
  const id=identifier(src.id);
  if((await db.query('SELECT id FROM pc_native WHERE id=$1 UNION ALL SELECT id FROM pc_deleted_requests WHERE id=$1',[id])).length)return id;
  const {kind,values}=parsed;
  const files=(src.attachments||[]).slice(0,10).filter(a=>{try{const url=new URL(a.url);return url.protocol==='https:'&&['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)&&url.pathname.startsWith('/attachments/');}catch{return false;}});
  const image=files.find(a=>/^image\/(png|jpeg|gif|webp)$/.test(a.contentType||a.content_type||'')&&a.size<=maxImageBytes);
  if(image){
    let url=image.url;
    try{
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(response.ok&&Number(response.headers.get('content-length')||0)<=maxImageBytes){
        const bytes=Buffer.from(await response.arrayBuffer());url=await saveImage(db,src.author,bytes,config.service);
      }
    }catch{}
    values[['create','edit'].includes(kind)?'portrait':'art']=url;
  }
  const editable=Object.fromEntries(forms.allFields('create').filter((f:any)=>Object.hasOwn(values,f.key)).map((f:any)=>[f.key,values[f.key]]));
  const structured=Object.fromEntries(forms.allFields(kind).filter((f:any)=>Object.hasOwn(values,f.key)).map((f:any)=>[f.key,values[f.key]]));
  const input:any={id,kind,reason:values.reason||'Submitted in Discord'};
  if(kind==='edit'||kind==='training'){
    const own=await db.query('SELECT * FROM pc_characters WHERE owner_id=$1',[src.author]);
    const match=own.filter(c=>clean(JSON.parse(c.sheet).name)===clean(values.name||''));
    if(match.length===1){input.characterId=match[0].id;input.version=Number(match[0].revision);}
    input.details=structured;
    if(kind==='edit'){delete editable.name;input.fields=editable;}
  }else input.fields=structured;
  const after={...values,name:values.name||src.title||forms.forms[kind].title};
  const added=await db.transaction(async q=>{
    if((await q('SELECT id FROM pc_deleted_requests WHERE id=$1',[id])).length)return false;
    const row=await q('INSERT INTO pc_native VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',[id,src.id,src.channel,src.author,src.content,JSON.stringify(input),JSON.stringify(files.map(a=>({name:a.name||a.filename||'Attachment',url:a.url})))]);
    if(!row.length)return false;
    await attachImage(q,values.portrait||values.art,config.service,src.author);
    await q("INSERT INTO pc_requests(id,fingerprint,kind,character_id,owner_id,author_id,base_revision,after_sheet,reason,status,created_ms) VALUES($1,$2,$3,$4,$5,$5,0,$6,$7,'needs_details',$8)",[id,'discord:'+src.id,kind,input.characterId||id,src.author,JSON.stringify(after),input.reason,Date.now()]);
    await q('INSERT INTO pc_review_posts(request_id) VALUES($1)',[id]);return true;
  });
  if(added){
    try{await propose(db,who,input,new Set([who.id]),config.service,true);}catch(e){if(!(e instanceof Problem))throw e;}
  }
  return id;
}
