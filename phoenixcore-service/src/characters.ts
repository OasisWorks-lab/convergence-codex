import forms from '../../phoenixcore/templates.js';
import type {Store} from './db.ts';
import {requireThat, readSettings, type Actor} from './domain.ts';

export async function archiveRequest(db:Store,actor:Actor,id:string,archive:boolean){
  requireThat(actor.isOwner,403,'Only the configured owner can archive requests.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT status FROM pc_requests WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Request unavailable.');
    if(archive){
      await q('INSERT INTO pc_archives(request_id,previous_status) VALUES($1,$2) ON CONFLICT(request_id) DO NOTHING',[id,row.status]);
      if(['pending','awaiting_judge'].includes(row.status))await q("UPDATE pc_requests SET status='archived',notified=0,notify_after=0 WHERE id=$1",[id]);
    }else{
      const [previous]=await q('DELETE FROM pc_archives WHERE request_id=$1 RETURNING previous_status',[id]);
      if(previous && row.status==='archived')await q('UPDATE pc_requests SET status=$1,notified=0,notify_after=0 WHERE id=$2',[previous.previous_status,id]);
    }
  });
}
export async function removeCharacter(db:Store,actor:Actor,id:string,version:number){
  requireThat(actor.isOwner,403,'Only the configured owner can remove characters.');
  requireThat(Number.isSafeInteger(version)&&version>0,400,'Open the current sheet.');
  return db.transaction(async q=>{
    const rows=await q('DELETE FROM pc_characters WHERE id=$1 AND revision=$2 RETURNING id',[id,version]);
    requireThat(rows.length,409,'This sheet was changed or removed. Open the player profile again.');
    await q('DELETE FROM pc_post_defaults WHERE character_id=$1',[id]);
    await q('DELETE FROM pc_post_tags WHERE character_id=$1',[id]);
    await q('DELETE FROM pc_active_forms WHERE character_id=$1',[id]);
    await q("UPDATE pc_requests SET status='stale',notified=0,notify_after=0 WHERE character_id=$1 AND status IN ('pending','awaiting_judge','archived')",[id]);
  });
}
export function activeForm(sheet:any,key:string){
  return forms.readForms(sheet.attainedForms).find((f:any)=>f.id===key);
}
export async function characterCommand(db:Store,guild:string,dashboard:string,body:any){
  const reply=(content:string)=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
  if(body.type===4){
    const choices:{name:string;value:string}[]=[];
    if(body.guild_id===guild && body.member?.user?.id){
      const own=await db.query('SELECT c.id,c.sheet,t.tag FROM pc_characters c LEFT JOIN pc_post_tags t ON t.character_id=c.id WHERE c.owner_id=$1 ORDER BY c.id',[body.member.user.id]);
      const focus=body.data.options?.find((o:any)=>o.focused),query=String(focus?.value||'').toLowerCase();
      if(focus?.name==='character')choices.push(...own.map(c=>({name:JSON.parse(c.sheet).name,value:c.id})));
      if(focus?.name==='form'){
        const selected=String(body.data.options.find((o:any)=>o.name==='character')?.value||'').toLowerCase();
        const character=own.find(c=>c.id===selected||(c.tag && forms.tagKey(c.tag)===forms.tagKey(selected))||JSON.parse(c.sheet).name.toLowerCase()===selected);
        if(character)choices.push({name:'Base',value:'base'},...forms.readForms(JSON.parse(character.sheet).attainedForms).map((f:any)=>({name:f.name,value:f.id})));
      }
      return {type:8,data:{choices:choices.filter(c=>c.name.toLowerCase().includes(query)).slice(0,25)}};
    }
    return {type:8,data:{choices}};
  }
  if(body.guild_id!==guild || !body.member?.user?.id)return reply('Open this command in Convergence.');
  if(body.data.name==='Character sheet'){
    const [character]=await db.query('SELECT c.*,a.form_key FROM pc_posts p JOIN pc_characters c ON c.id=p.character_id LEFT JOIN pc_active_forms a ON a.character_id=c.id WHERE p.posted_id=$1 AND p.channel_id=$2',[String(body.data.target_id),String(body.channel_id)]);
    if(!character)return reply('Choose a PhoenixCore character post with a current sheet.');
    const s=JSON.parse(character.sheet),active=activeForm(s,character.form_key);
    const labels=['Strength','Speed','Durability','Intelligence','Energy control'];
    const fields=[{name:'Base Power Level',value:String(s.bpl)},{name:'Active form',value:active?.name||'Base'},...forms.stats.map((k:string,i:number)=>({name:labels[i],value:String(s[k]||'Unrecorded'),inline:true}))];
    const portrait=active?.portrait||s.portrait;
    return {type:4,data:{flags:64,allowed_mentions:{parse:[]},embeds:[{title:s.name,url:dashboard+'#sheet-'+character.id,fields,...(portrait?{thumbnail:{url:new URL(portrait,dashboard).href}}:{})}]}};
  }
  if(body.data.name!=='transform')return reply('Unknown character command.');
  const {value}=await readSettings(db);
  if(value.playerRole&&!body.member.roles?.includes(value.playerRole))return reply('A current player role is required.');
  const opts=Object.fromEntries((body.data.options||[]).map((o:any)=>[o.name,String(o.value).trim().toLowerCase()]));
  const owner=body.member.user.id;
  return db.transaction(async q=>{
    const own=await q('SELECT c.*,t.tag FROM pc_characters c LEFT JOIN pc_post_tags t ON t.character_id=c.id WHERE c.owner_id=$1 ORDER BY c.id'+(db.dialect==='postgres'?' FOR UPDATE OF c':''),[owner]);
    const matches=own.filter(r=>r.id===opts.character || (r.tag && forms.tagKey(r.tag)===forms.tagKey(opts.character)) || JSON.parse(r.sheet).name.toLowerCase()===opts.character);
    if(matches.length!==1)return reply('Choose one of your approved characters by name, posting tag or sheet ID.');
    const c=matches[0],s=JSON.parse(c.sheet);
    if(opts.form==='base'){await q('DELETE FROM pc_active_forms WHERE character_id=$1',[c.id]);return reply(s.name+' returned to base form.');}
    const attained=forms.readForms(s.attainedForms);
    const form=attained.find((x:any)=>x.id===opts.form||x.name.toLowerCase()===opts.form);
    if(!form)return reply('Choose an attained form for '+s.name+'. Approved forms: '+(attained.map((x:any)=>x.name).join(', ').slice(0,1600)||'none yet')+'.');
    await q('INSERT INTO pc_active_forms(character_id,form_key) VALUES($1,$2) ON CONFLICT(character_id) DO UPDATE SET form_key=excluded.form_key',[c.id,form.id]);
    return reply(s.name+' transformed into '+form.name+'. Your next character post will use this form.');
  });
}
