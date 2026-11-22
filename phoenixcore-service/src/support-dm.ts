import {Problem,requireThat,discordId,readSettings} from './domain.ts';
import type {Store} from './db.ts';
import type {Discord,Config} from './discord.ts';
import {staffIdentity} from './staff.ts';
import {chooseSupportStaff} from './support-auth.ts';
import {createSupportCase,addSupportMessage,getSupportCase} from './support.ts';

export type DmAttachment={name?:string;url?:string;size?:number;contentType?:string};
export type SupportIncomingDm={messageId:string;userId:string;text:string;attachments?:DmAttachment[]};
export async function receiveSupportDm(db:Store,discord:Discord,config:Config,input:SupportIncomingDm,now=Date.now()){
  requireThat(discordId.test(input.messageId)&&discordId.test(input.userId),400,'Discord DM identity is missing.');
  let text=String(input.text||'').trim().slice(0,1800);
  const attachments=(input.attachments||[]).slice(0,8).filter(a=>a&&typeof a.url==='string'&&
    /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[\w/?=&.%:-]+$/i.test(a.url));
  if(attachments.length){
    const descriptions=attachments.map(a=>'Attachment: '+String(a.name||'file').slice(0,70)+' · '+String(a.url).slice(0,230)).join('\n');
    text=(text+'\n'+descriptions).trim().slice(0,1900);
  }
  requireThat(text.length>0,400,'Send a message or supported Discord attachment.');
  const addressed=/^#([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\s+([\s\S]+)$/i.exec(text);
  const author=staffIdentity(input.userId,[],'0',config,'');
  if(addressed){
    const id=addressed[1],c=await getSupportCase(db,id);
    requireThat(c.requester_id===input.userId,403,'You can only reply to your own case.');
    const result=await addSupportMessage(db,author,id,'dm-reply:'+input.messageId,addressed[2],'member',now);
    return {caseId:id,created:false,accepted:result.created,
      message:'Your message was added to SupportCase '+id+'. Convergence Staff will see it.'};
  }
  const current=await db.query("SELECT id FROM pc_support_cases WHERE requester_id=$1 AND kind='modmail' AND status NOT IN ('Closed','Resolved') ORDER BY created_ms DESC LIMIT 4",
    [input.userId]);
  if(current.length>1)return {caseId:null,created:false,accepted:false,message:
    'You have several open Modmail conversations. Start your next DM with #CASE-ID followed by your message, using the ID from the earlier acknowledgment. Nothing was forwarded to the wrong case.'};
  if(current.length===1){
    const id=current[0].id;
    const result=await addSupportMessage(db,author,id,'dm-reply:'+input.messageId,text,'member',now);
    return {caseId:id,created:false,accepted:result.created,
      message:'Your message was added to Modmail SupportCase '+id+'.'};
  }
  const isAppeal=/^appeal\s*:/i.test(text);
  const {value:settings}=await readSettings(db);
  const assigned=await chooseSupportStaff(db,discord,config,settings.judgeRole);
  const result=await createSupportCase(db,{receipt:'dm:'+input.messageId,actorId:input.userId,requesterId:input.userId,
    kind:isAppeal?'appeal':'modmail',message:text,assigneeId:assigned||config.owner},now);
  return {caseId:result.id,created:result.created,accepted:true,
    message:'Convergence Staff received your '+(isAppeal?'appeal':'private Modmail request')+'.\nCase ID: '+result.id+
      '\nYou can continue replying here. For multiple open cases, use #CASE-ID before your message.'};
}
