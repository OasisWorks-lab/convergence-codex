import type {Store} from './db.ts';
import {requireThat,textValue} from './domain.ts';
import {getTag,type CommunityActor} from './community.ts';

const nameValid=/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
function safeUrl(value:unknown,label:string){
  const text=String(value||'').trim();
  if(!text)return '';
  requireThat(text.length<=600&&/^https:\/\//i.test(text),400,label+' must be an HTTPS URL.');
  let u:URL;try{u=new URL(text);}catch{requireThat(false,400,label+' is not a valid URL.');throw Error('URL');}
  requireThat(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash,400,label+' must not contain credentials or a fragment.');
  return u.href;
}
export type TagButton={label:string;url:string};
function presentation(input:any){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),400,'Provide an informational tag appearance.');
  const title=textValue(input.title||'',120,'Tag title'),
    imageUrl=safeUrl(input.imageUrl,'Image URL'),color=Number(input.color??0x6a7bc5);
  requireThat(Number.isInteger(color)&&color>=0&&color<=0xffffff,400,'Choose a valid Discord embed color.');
  const raw=input.buttons??[];
  requireThat(Array.isArray(raw)&&raw.length<=3,400,'Choose up to three safe link buttons.');
  const buttons:TagButton[]=raw.map((button:any)=>{
    requireThat(button&&typeof button==='object',400,'Invalid tag button.');
    return {label:textValue(button.label,80,'Button label',true),url:safeUrl(button.url,'Button URL')};
  });
  requireThat(buttons.every(b=>b.url),400,'Each tag button needs a safe HTTPS link.');
  return {title,imageUrl,color,buttons};
}
const format=(row:any)=>({title:row?.title||'',imageUrl:row?.image_url||'',color:Number(row?.color??0x6a7bc5),
  buttons:row?JSON.parse(row.buttons):[],presentationRevision:Number(row?.revision||0)});
export async function richTag(db:Store,name:string){
  const key=String(name||'').trim().toLowerCase();
  requireThat(nameValid.test(key),400,'Choose a valid informational tag name.');
  const [row]=await db.query(`SELECT m.* FROM pc_info_tags t LEFT JOIN pc_info_tag_aliases a ON a.tag_id=t.id
    LEFT JOIN pc_info_tag_rich m ON m.tag_id=t.id WHERE (t.name=$1 OR a.alias=$1) AND t.active=1 LIMIT 1`,[key]);
  requireThat(row,404,'No published informational tag has that name.');
  return format(row);
}
export async function richTagSave(db:Store,actor:CommunityActor,name:string,expected:number,input:any){
  requireThat(actor.isStaff,403,'Only Convergence staff can style informational tags.');
  const key=String(name||'').trim().toLowerCase();
  requireThat(nameValid.test(key),400,'Invalid informational tag name.');
  const design=presentation(input);
  return db.transaction(async q=>{
    const [tag]=await q('SELECT id FROM pc_info_tags WHERE name=$1 AND active=1',[key]);
    requireThat(tag,404,'Publish the informational tag before styling it.');
    const [old]=await q('SELECT revision FROM pc_info_tag_rich WHERE tag_id=$1'+
      (db.dialect==='postgres'?' FOR UPDATE':''),[tag.id]);
    requireThat(Number.isSafeInteger(expected)&&Number(old?.revision||0)===expected,409,
      'Tag appearance changed. Refresh before saving.');
    const revision=expected+1,now=Date.now(),buttons=JSON.stringify(design.buttons);
    await q(`INSERT INTO pc_info_tag_rich(tag_id,title,image_url,color,buttons,revision,updated_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(tag_id) DO UPDATE SET title=excluded.title,image_url=excluded.image_url,
        color=excluded.color,buttons=excluded.buttons,revision=excluded.revision,updated_ms=excluded.updated_ms`,
      [tag.id,design.title,design.imageUrl,design.color,buttons,revision,now]);
    await q(`INSERT INTO pc_info_tag_rich_history(tag_id,revision,title,image_url,color,buttons,actor_id,changed_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tag.id,revision,design.title,design.imageUrl,design.color,buttons,actor.id,now]);
    return {name:key,presentationRevision:revision};
  });
}
export async function richTagHistory(db:Store,actor:CommunityActor,name:string){
  requireThat(actor.isStaff,403,'Only staff can inspect tag presentation history.');
  const key=String(name||'').trim().toLowerCase();
  const [tag]=await db.query('SELECT id FROM pc_info_tags WHERE name=$1',[key]);
  requireThat(tag,404,'Tag not found.');
  const rows=await db.query('SELECT * FROM pc_info_tag_rich_history WHERE tag_id=$1 ORDER BY revision DESC LIMIT 30',[tag.id]);
  return rows.map(row=>({...format(row),actorId:row.actor_id,changedMs:Number(row.changed_ms)}));
}
export async function richTagRollback(db:Store,actor:CommunityActor,name:string,expected:number,target:number){
  requireThat(actor.isStaff,403,'Only staff can restore tag appearance.');
  const key=String(name||'').trim().toLowerCase();
  return db.transaction(async q=>{
    const [tag]=await q('SELECT id FROM pc_info_tags WHERE name=$1',[key]);requireThat(tag,404,'Tag not found.');
    const [current]=await q('SELECT revision FROM pc_info_tag_rich WHERE tag_id=$1'+
      (db.dialect==='postgres'?' FOR UPDATE':''),[tag.id]);
    requireThat(current&&Number(current.revision)===expected,409,'Refresh the tag appearance.');
    const [snapshot]=await q('SELECT * FROM pc_info_tag_rich_history WHERE tag_id=$1 AND revision=$2',[tag.id,target]);
    requireThat(snapshot,404,'Target appearance revision unavailable.');
    const revision=expected+1,now=Date.now();
    await q('UPDATE pc_info_tag_rich SET title=$1,image_url=$2,color=$3,buttons=$4,revision=$5,updated_ms=$6 WHERE tag_id=$7',
      [snapshot.title,snapshot.image_url,snapshot.color,snapshot.buttons,revision,now,tag.id]);
    await q('INSERT INTO pc_info_tag_rich_history(tag_id,revision,title,image_url,color,buttons,actor_id,changed_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [tag.id,revision,snapshot.title,snapshot.image_url,snapshot.color,snapshot.buttons,actor.id,now]);
    return {name:key,presentationRevision:revision};
  });
}
export async function tagDisplay(db:Store,name:string,context:{userId:string;channelId:string}){
  const [tag,rich]=await Promise.all([getTag(db,name,context),richTag(db,name)]);
  return {tag,rich};
}
export function tagEmbed(display:Awaited<ReturnType<typeof tagDisplay>>){
  const {tag,rich}=display;
  return {content:'',allowed_mentions:{parse:[]},
    embeds:[{title:rich.title||tag.name,description:tag.text.slice(0,4000),color:rich.color,
      ...(rich.imageUrl?{image:{url:rich.imageUrl}}:{}),footer:{text:'Convergence · Informational tag · v'+tag.revision}}],
    ...(rich.buttons.length?{components:[{type:1,components:rich.buttons.map(b=>({type:2,style:5,label:b.label,url:b.url}))}]}:{})};
}
