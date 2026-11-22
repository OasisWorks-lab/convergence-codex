import {randomUUID} from 'node:crypto';
import {requireThat,textValue,discordId} from './domain.ts';
import type {Store,Query} from './db.ts';
import {requireModerator,type StaffIdentity} from './staff.ts';

export type ModerationKind='warn'|'note';
export type CaseEvidence={sourceMessageId:string;postedMessageId:string;sourceChannelId:string;characterId:string}|null;
const casePattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function proxyEvidence(db:Store,postId:string,targetId:string):Promise<CaseEvidence>{
  requireThat(discordId.test(postId),400,'Enter the original or proxied Discord message ID.');
  const [source]=await db.query('SELECT source_id,posted_id,channel_id,author_id,character_id FROM pc_posts WHERE source_id=$1 OR posted_id=$1',[postId]);
  requireThat(source,404,'PhoenixCore has no verified original author for that post. Supply a known proxied post ID or leave evidence blank.');
  requireThat(source.author_id===targetId,403,'That roleplay post belongs to a different Discord account. The webhook or character is not the responsible user.');
  return {sourceMessageId:String(source.source_id),postedMessageId:String(source.posted_id||''),sourceChannelId:String(source.channel_id),characterId:String(source.character_id)};
}
export async function recordCase(db:Store,actor:StaffIdentity,kind:ModerationKind,targetId:string,receipt:string,reason:string,evidence:CaseEvidence=null,now=Date.now()){
  requireModerator(actor);
  requireThat(kind==='warn'||kind==='note',400,'Choose a supported moderation record.');
  requireThat(discordId.test(targetId),400,'Choose a real Discord member.');
  requireThat(/^[\w-]{8,100}$/.test(receipt),400,'A valid unique Discord interaction receipt is required.');
  const content=textValue(reason,kind==='warn'?900:1800,kind==='warn'?'Warning reason':'Private note',kind==='note');
  return db.transaction(async q=>{
    const id=randomUUID(),active=kind==='warn'?1:0;
    const inserted=await q('INSERT INTO pc_mod_cases(id,receipt_id,target_id,actor_id,kind,reason,created_ms,source_message_id,posted_message_id,source_channel_id,character_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(receipt_id) DO NOTHING RETURNING id',
      [id,receipt,targetId,actor.id,kind,content,now,evidence?.sourceMessageId||null,evidence?.postedMessageId||null,evidence?.sourceChannelId||null,evidence?.characterId||null,active]);
    if(!inserted.length){
      const [existing]=await q('SELECT id,target_id,kind FROM pc_mod_cases WHERE receipt_id=$1',[receipt]);
      requireThat(existing&&existing.target_id===targetId&&existing.kind===kind,409,'A reused moderation receipt conflicts with an earlier action.');
      const [count]=await q("SELECT COUNT(*) AS n FROM pc_mod_cases WHERE target_id=$1 AND kind='warn' AND active=1",[targetId]);
      return {caseId:existing.id,created:false,activeWarnings:Number(count.n),needsReview:Number(count.n)>=5};
    }
    await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'recorded',kind,now]);
    const [count]=await q("SELECT COUNT(*) AS n FROM pc_mod_cases WHERE target_id=$1 AND kind='warn' AND active=1",[targetId]);
    const activeWarnings=Number(count.n),needsReview=kind==='warn'&&activeWarnings>=5;
    if(kind==='warn'){
      await q('INSERT INTO pc_core_jobs(id,job_type,recipient_id,payload,due_ms,created_ms) VALUES($1,$2,$3,$4,$5,$5)',
        ['mod-notice:'+id,'moderation-notice',targetId,JSON.stringify({caseId:id,reason:content}),now]);
      if(activeWarnings===5)
        await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(),id,actor.id,'five-warning-review','Five active warnings reached; no sanction is automatically selected.',now]);
    }
    return {caseId:id,created:true,activeWarnings,needsReview};
  });
}
export async function removeWarning(db:Store,actor:StaffIdentity,id:string,now=Date.now()){
  requireModerator(actor);requireThat(casePattern.test(id),400,'Use a valid moderation case ID.');
  return db.transaction(async q=>{
    const [row]=await q('SELECT * FROM pc_mod_cases WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(row,404,'Moderation case not found.');
    requireThat(row.kind==='warn',400,'Only warning cases can be deactivated.');
    if(Number(row.active)!==1)return {changed:false,targetId:row.target_id};
    await q('UPDATE pc_mod_cases SET active=0,removed_by=$1,removed_ms=$2 WHERE id=$3',[actor.id,now,id]);
    await q('INSERT INTO pc_mod_case_events(id,case_id,actor_id,event,detail,occurred_ms) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,actor.id,'warning-removed','Manually removed; the original warning and reason remain in the private audit trail.',now]);
    return {changed:true,targetId:row.target_id};
  });
}
export async function activeWarnings(db:Store,targetId:string){
  requireThat(discordId.test(targetId),400,'Choose a real Discord member.');
  const [count]=await db.query("SELECT COUNT(*) AS n FROM pc_mod_cases WHERE target_id=$1 AND kind='warn' AND active=1",[targetId]);
  return Number(count.n);
}
export async function moderationHistory(db:Store,actor:StaffIdentity,targetId:string,limit=15){
  requireModerator(actor);
  requireThat(discordId.test(targetId),400,'Choose a real Discord member.');
  const cases=await db.query('SELECT id,kind,reason,created_ms,actor_id,active,removed_by,removed_ms,source_message_id,posted_message_id,source_channel_id,character_id FROM pc_mod_cases WHERE target_id=$1 ORDER BY created_ms DESC,id DESC LIMIT $2',
    [targetId,Math.max(1,Math.min(50,limit))]);
  return {targetId,cases,activeWarnings:await activeWarnings(db,targetId)};
}
export async function caseEvents(db:Store,actor:StaffIdentity,id:string){
  requireModerator(actor);
  requireThat(casePattern.test(id),400,'Use a valid case ID.');
  const [record]=await db.query('SELECT * FROM pc_mod_cases WHERE id=$1',[id]);
  requireThat(record,404,'Moderation case not found.');
  const events=await db.query('SELECT actor_id,event,detail,occurred_ms FROM pc_mod_case_events WHERE case_id=$1 ORDER BY occurred_ms,id',[id]);
  return {record,events};
}
