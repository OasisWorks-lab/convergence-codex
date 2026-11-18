import {readFileSync} from 'node:fs';
import model from '../../assets/content-model.js';
import type {Store,Query} from './db.ts';
import {attachImage} from './media.ts';
import {requireThat} from './domain.ts';

export const editorRole='1100315883773112432';
const bundled=readFileSync(new URL('../../assets/data.js',import.meta.url),'utf8').trim();
const baseline=JSON.parse(bundled.replace(/^window\.CONVERGENCE_DATA\s*=\s*/,'').replace(/;$/,''));
model.prepare(baseline);
const records=model.records(baseline);
const tags=new Set('p br hr h1 h2 h3 h4 h5 h6 ul ol li blockquote strong b em i u s code pre small sub sup table thead tbody tr td th'.split(' '));
function formatted(value:string){
  if(!value.includes('<'))return value.split(/\n\s*\n/).map(p=>'<p>'+p.replaceAll('&','&amp;').replaceAll('>','&gt;').replaceAll('\n','<br>')+'</p>').join('');
  return value.replace(/<[^>]*>|</g,token=>{
    const tag=/^<(\/?)([a-z0-9]+)(?:\s+[^>]*)?\s*\/?>$/i.exec(token);
    if(tag?.[2].toLowerCase()==='a'){
      if(tag[1])return '</a>';
      const link=/\shref\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(token);
      try{const url=new URL(link?.[1]||link?.[2]||'');
        if(url.protocol==='https:'&&!url.username&&!url.password)return '<a href="'+url.href.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','%3C').replaceAll('>','%3E')+'" rel="noopener noreferrer">';}catch{}
      return '<a>';
    }
    if(tag && tags.has(tag[2].toLowerCase()))return '<'+tag[1]+tag[2].toLowerCase()+'>';
    return token.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  });
}
function checkField(field:string,value:unknown,kind:string,service:string) {
  requireThat(typeof value==='string' && value.length<=(['html','descriptionHtml','text','lore'].includes(field)?95000:8000),400,'Check the length of '+field+'.');
  const v=value.trim();
  if(field==='playablePaths')requireThat(v.split(/\r?\n/).every(p=>p.trim().length<=240),400,'Each selectable path can contain up to 240 characters.');
  if(field==='title'||field==='name')requireThat(v && v.length<=260,400,'Enter a title of up to 260 characters.');
  if(field==='art'||field==='source'||field==='url'){
    let valid=!v || (field==='art' && /^assets\/(?:art|uploads)\/[a-zA-Z0-9_/-]+\.(?:png|jpg|jpeg|svg|gif|webp)$/i.test(v));
    if(!valid){try{const u=new URL(v);valid=(u.protocol==='https:'||(field==='art' && u.origin===service && /^\/media\/[a-f0-9-]{36}\.(png|gif|jpg|webp)$/.test(u.pathname)))&&!u.username&&!u.password;}catch{}}
    requireThat(valid&&v.length<=2048,400,'Use an HTTPS address or a Codex artwork path.');
  }
  if(model.colors.includes(field)||field==='shade')requireThat(/^#[0-9a-f]{6}$/i.test(v),400,'Choose a six-digit hex color.');
  if(field==='type'&&kind==='world')requireThat(['Planet','Realm','Landmark','Origin'].includes(v),400,'Choose a listed location type.');
  if(field==='group')requireThat(['In development','Events','Completed'].includes(v),400,'Choose a listed chronicle category.');
  if(field==='available'||field==='listed')requireThat(['yes','no'].includes(v),400,'Choose whether the theme is available.');
  if(field==='theme')requireThat(/^[a-z0-9-]{1,40}$/.test(v),400,'Select an available theme.');
  return ['html','descriptionHtml'].includes(field)&&v?formatted(v):v;
}
export async function published(db:Store){
  const rows=await db.query('SELECT entry_key,revision,fields FROM pc_codex ORDER BY entry_key');
  return rows.map(r=>({key:r.entry_key,revision:Number(r.revision),fields:JSON.parse(r.fields)}));
}
export async function publish(db:Store, roles:string[], actor:string, input:any, service=''){
  requireThat(roles.includes(editorRole),403,'Your Discord Owner role is required to publish Codex edits.');
  requireThat(input && typeof input.key==='string' && input.key.length<190 && Number.isSafeInteger(input.revision) && input.revision>=0,400,'Invalid Codex entry or revision.');
  const {key,revision}=input;
  let kind=records.get(key)?.kind||model.extraKind(baseline,key);
  if(/^design-paths\/[a-f0-9-]{36}$/.test(key)&&(await db.query("SELECT id FROM pc_designs WHERE kind='race' AND id=$1",[key.slice(13)])).length)kind='designPaths';
  requireThat(typeof kind==='string' && Object.hasOwn(model.groupFields,kind),400,'Unknown Codex entry.');
  requireThat(input.fields && typeof input.fields==='object' && !Array.isArray(input.fields) && Object.keys(input.fields).length,400,'Enter at least one change.');
  const fields:Record<string,string>={};
  for(const [name,value] of Object.entries(input.fields)){
    requireThat(model.groupFields[kind].includes(name),400,'Unknown entry field.');
    fields[name]=checkField(name,value,kind,service);
  }
  return db.transaction(async q=>{
    if(db.dialect==='postgres')await q('SELECT pg_advisory_xact_lock(739124862)');
    const [old]=await q('SELECT fields,revision FROM pc_codex WHERE entry_key=$1',[key]);
    requireThat((Number(old?.revision)||0)===revision,409,'Someone saved this entry while you were editing. Reopen it to review the published version.');
    await attachImage(q,fields.art,service,actor);
    const next={...(old?JSON.parse(old.fields):{}),...fields};
    if(!records.has(key)&&['item','guild','theme'].includes(kind))requireThat(next.name,400,'Give this entry a name.');
    if(!records.has(key)&&kind==='message')requireThat(next.title&&next.html,400,'Give this lore section a title and some text.');
    if(kind==='theme'||kind==='default'){
      if(kind==='theme'&&!records.has(key))requireThat(model.colors.every((c:string)=>next[c]),400,'Complete all theme colors.');
      const all=await q("SELECT entry_key,fields FROM pc_codex WHERE entry_key LIKE 'themes/%' OR entry_key='settings/default'");
      const themes=new Map(baseline.themes.map((t:any)=>[t.id,true]));
      let chosen=baseline.defaultTheme;
      for(const row of all){const f=JSON.parse(row.fields);if(row.entry_key==='settings/default')chosen=f.theme;else themes.set(row.entry_key.slice(7),f.available!=='no');}
      if(kind==='theme')themes.set(key.slice(7),next.available!=='no');else chosen=next.theme;
      requireThat(themes.get(chosen),400,'Select an available default theme before hiding or replacing it.');
    }
    await q('INSERT INTO pc_codex(entry_key,revision,fields,editor,edited_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT(entry_key) DO UPDATE SET revision=excluded.revision,fields=excluded.fields,editor=excluded.editor,edited_ms=excluded.edited_ms',[key,revision+1,JSON.stringify(next),actor,Date.now()]);
    return {key,revision:revision+1,fields:next};
  });
}

export async function racePaths(q:Query){
  const entries=await q("SELECT entry_key,fields FROM pc_codex WHERE entry_key LIKE 'races/%' OR entry_key LIKE 'design-paths/%'");
  const changes=new Map(entries.map(r=>[r.entry_key,JSON.parse(r.fields)]));
  const list=(text:string)=>[...new Set(text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
  const races=baseline.races.map((r:any)=>{
    const key='races/'+r.slug,published=changes.get(key)||{};
    const paths=r.paths.map((p:any,i:number)=>changes.get(key+'/paths/'+i)?.name||p.name);
    return {id:r.slug,name:published.name||r.name,paths:published.playablePaths===undefined?paths:list(published.playablePaths)};
  });
  for(const design of await q("SELECT id,fields FROM pc_designs WHERE kind='race' ORDER BY id")){
    const fields=JSON.parse(design.fields),override=changes.get('design-paths/'+design.id);
    races.push({id:design.id,name:fields.name,paths:list(override?.playablePaths??fields.paths??'')});
  }
  return races;
}
