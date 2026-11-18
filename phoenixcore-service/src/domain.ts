import forms from '../../phoenixcore/templates.js';
import { assignTag, currentTag } from './tags.ts';
import {racePaths} from './codex.ts';
import { attachImage } from './media.ts';
import { createHash,randomUUID } from 'node:crypto';
import { defaultSettings, type Store, type Row, type Query } from './db.ts';

export class Problem extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function requireThat(test: unknown, status: number, message: string): asserts test {
  if (!test) throw new Problem(status, message);
}
export const discordId = /^\d{17,20}$/;
const requestId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const isDesign = (kind: string) => forms.catalogue.includes(kind);
function validateForm(kind: string, input: unknown, partial=false): Record<string,string> {
  try { return forms.normalize(kind,input,partial); }
  catch(error) { throw new Problem(400,error instanceof Error ? error.message : 'Invalid form.'); }
}
export function textValue(value: unknown, limit: number, label: string, required = false): string {
  requireThat(typeof value === 'string', 400, label + ' must be text.');
  const s = value.trim();
  requireThat(s.length <= limit && (!required || s.length > 0), 400, label + ' must contain ' + (required ? '1–' : '0–') + limit + ' characters.');
  return s;
}
function integer(value: unknown, name: string) {
  requireThat(typeof value === 'string' && /^(0|[1-9]\d{0,59})$/.test(value), 400, name + ' must be a whole number of up to 60 digits.');
  return value;
}
function object(value: any): asserts value is Record<string, any> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 400, 'Expected a form object.');
}
function keys(value: Record<string, any>, allowed: string[]) {
  requireThat(Object.keys(value).every(key => allowed.includes(key)), 400, 'An unsupported field was submitted.');
}
function profile(input: any, previous?: Record<string,any>) {
  const changes=validateForm('create',input,!!previous);
  const next:Record<string,any>={...(previous ?? {wallet:'0',gear:[]}),...changes};
  next.bpl=integer(next.bpl,'Base Power Level');
  requireThat(next.name, 400, 'Give the character a name.');
  return next;
}

export function applyAward(before: Record<string,any>, input:any) {
  try { return forms.calculateAward(before,input); }
  catch(error) { throw new Problem(400,error instanceof Error ? error.message : 'Invalid award.'); }
}

export type Actor = { id: string; isOwner: boolean; isJudge: boolean; isPlayer: boolean };
export type Settings = typeof defaultSettings;
export function actorFor(userId: string, roles: string[], ownerId: string, settings: Settings): Actor {
  const isOwner = userId === ownerId;
  return { id: userId, isOwner, isJudge: isOwner || (!!settings.judgeRole && roles.includes(settings.judgeRole)),
    isPlayer: !settings.playerRole || roles.includes(settings.playerRole) };
}
export async function readSettings(db: Store) {
  const [row] = await db.query('SELECT revision,value FROM pc_config WHERE slot=1');
  return { revision: Number(row.revision), value: {...defaultSettings, ...JSON.parse(row.value)} as Settings };
}
export async function saveSettings(db: Store, actor: Actor, input: any) {
  requireThat(actor.isOwner, 403, 'Only the configured owner can change bot settings.');
  object(input); object(input.value); keys(input.value, Object.keys(defaultSettings));
  const value = { ...defaultSettings };
  for (const key of ['playerRole', 'judgeRole'] as const) {
    const id = input.value[key];
    requireThat(typeof id === 'string' && (!id || discordId.test(id)), 400, 'Enter a Discord ID or leave the field empty.');
    value[key] = id;
  }
  const channels=input.value.rpChannels ?? '';
  requireThat(typeof channels==='string' && channels.length<=2200,400,'Enter up to 100 RP channel IDs.');
  const channelIds=[...new Set(channels.split(/[\s,]+/).filter(Boolean))];
  requireThat(channelIds.length<=100 && channelIds.every(id=>discordId.test(id)),400,'Enter valid Discord RP channel IDs, one per line.');
  value.rpChannels=channelIds.join('\n');
  const divider=input.value.rpDivider ?? '';
  requireThat(typeof divider==='string' && (!divider||discordId.test(divider)),400,'Choose a valid category divider.');
  value.rpDivider=divider;
  value.currency = textValue(input.value.currency, 32, 'Currency name', true);
  await db.transaction(async q => {
    const [old] = await q('SELECT revision,value FROM pc_config WHERE slot=1');
    const saved={...defaultSettings,...JSON.parse(old.value)};
    for(const key of ['characterChannel','designChannel','updatesForum'] as const){
      const id=input.value[key]??saved[key];
      requireThat(typeof id==='string' && discordId.test(id),400,'Enter valid Discord IDs for the two submission channels and the OC updates forum.');
      value[key]=id;
    }
    value.submissionMessage=textValue(input.value.submissionMessage??saved.submissionMessage,1300,'Submission message',true);
    value.reviewGuidance=textValue(input.value.reviewGuidance??saved.reviewGuidance,1500,'Review guidance');
    value.botNickname=textValue(input.value.botNickname??saved.botNickname,32,'Server nickname');
    const prefixes=textValue(input.value.commandPrefixes??saved.commandPrefixes,150,'Command prefixes').split(/[\s,]+/).filter(Boolean);
    requireThat(prefixes.length<=5&&prefixes.every((p:string)=>p.length<=12),400,'Choose up to five prefixes of 1–12 characters.');
    value.commandPrefixes=[...new Set(prefixes)].join(' ');
    for(const k of ['loreParagraphs','loreSentences','loreWords'] as const){
      const n=String(input.value[k]??saved[k]);requireThat(/^(0|[1-9]\d?)$/.test(n),400,'Lore minimums must be whole numbers from 0 to 99.');value[k]=n;
    }
    if(value.botNickname!==saved.botNickname)await q("INSERT INTO pc_bot_profile VALUES(1,$1,0,'Queued') ON CONFLICT(slot) DO UPDATE SET nick=excluded.nick,retry_at=0,status='Queued'",[value.botNickname]);
    value.reviewChannel=saved.reviewChannel;
    if(!Object.hasOwn(input.value,'rpDivider')) value.rpDivider=JSON.parse(old.value).rpDivider??'';
    if(!Object.hasOwn(input.value,'rpChannels')) value.rpChannels=JSON.parse(old.value).rpChannels??'';
    const rows = await q('UPDATE pc_config SET value=$1,revision=revision+1 WHERE slot=1 AND revision=$2 RETURNING revision', [JSON.stringify(value), input.revision]);
    requireThat(rows.length && old.revision === input.revision, 409, 'Settings changed. Reload and review the current values.');
    await q('INSERT INTO pc_settings_history VALUES($1,$2,$3,$4,$5)', [rows[0].revision, actor.id, old.value, JSON.stringify(value), Date.now()]);
  });
}
export function visibleRequest(r: Row) {
  const metadata=r.award ? JSON.parse(r.award) : null;
  const current=metadata?.format===2;
  return { id:r.id, kind:r.kind, characterId:r.character_id, ownerId:r.owner_id, authorId:r.author_id,
    version:Number(r.base_revision), before:r.before_sheet ? JSON.parse(r.before_sheet) : null, after:JSON.parse(r.after_sheet),
    award:current ? metadata.award??null : metadata, details:current ? metadata.details??null : null, judgment:current ? metadata.judgment??null : null, reason:r.reason, status:r.status, created:Number(r.created_ms),
    decidedBy:r.decided_by, decided:r.decided_ms ? Number(r.decided_ms) : null,
    archived:!!r.archived,delivery:r.notified ? 'Delivered' : r.last_notify_error ? 'Retry scheduled · '+r.last_notify_error : 'Queued' };
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export async function propose(db: Store, who: Actor, input: any, active: Set<string>, service='',completeIntake=false,mediaOwner=who.id) {
  object(input); keys(input, ['id','kind','characterId','version','fields','award','reason','details']);
  requireThat(typeof input.id === 'string' && requestId.test(input.id), 400, 'Invalid request identifier.');
  const { kind, id } = input;
  requireThat(['create','edit','award','training',...forms.catalogue].includes(kind), 400, 'Unknown request type.');
  if (kind === 'award') requireThat(who.isJudge, 403, 'A training judge must assign an award.');
  else requireThat(who.isPlayer && active.has(who.id), 403, 'A current player may submit a character sheet.');
  const reason = textValue(input.reason, 600, 'Reason', true);
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical([who.id,input]))).digest('hex');
  return db.transaction(async q => {
    requireThat(!(await q('SELECT id FROM pc_deleted_requests WHERE id=$1',[id])).length,409,'This archived request was deleted.');
    let [retry] = await q('SELECT * FROM pc_requests WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''), [id]);
    if(completeIntake && retry?.status==='needs_details' && retry.author_id===who.id){
      await q('DELETE FROM pc_requests WHERE id=$1',[id]);retry=undefined;
    }
    if (retry) {
      requireThat(retry.fingerprint === fingerprint, 409, 'That submission identifier was already used.');
      return visibleRequest(retry);
    }
    let ownerId=who.id, version=0, characterId=id, previous=null, award=null;
    let next: Record<string, any>;
    let immediate=false;
    if (kind === 'create') {
      next=profile(input.fields);
    } else if (isDesign(kind)) {
      next=validateForm(kind,input.fields);
    } else {
      requireThat(typeof input.characterId === 'string' && requestId.test(input.characterId), 400, 'Choose a character.');
      const [sheet] = await q('SELECT * FROM pc_characters WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''), [input.characterId]);
      requireThat(sheet && active.has(sheet.owner_id), 404, 'Character is unavailable.');
      requireThat(kind === 'award' || sheet.owner_id === who.id, 403, 'You can propose edits only to your characters.');
      requireThat(Number.isInteger(input.version) && sheet.revision === input.version, 409, 'The sheet changed. Reload before submitting.');
      ownerId=sheet.owner_id; version=sheet.revision; characterId=sheet.id; previous=JSON.parse(sheet.sheet);
      if (kind === 'award') ({ next, award } = applyAward(previous, input.award));
      else if (kind === 'training') {
        const details=validateForm('training',input.details);
        if (details.scene) {
          const [config]=await q('SELECT guild_id FROM pc_config WHERE slot=1');
          requireThat(new URL(details.scene).pathname.split('/')[2]===config.guild_id,400,'Choose a scene in Convergence.');
        }
        next=previous;award={format:2,details};
      } else {
        if (Object.hasOwn(input.fields??{},'tag')) {
          const [duplicate]=await q('SELECT * FROM pc_requests WHERE id=$1',[id]);
          if (duplicate) {
            requireThat(duplicate.fingerprint===fingerprint,409,'That submission identifier was already used.');
            return visibleRequest(duplicate);
          }
        }
        next=profile(input.fields,previous);
        if (Object.hasOwn(next,'tag')) {
          const beforeTag=await currentTag(q,characterId);
          if (beforeTag===next.tag) delete next.tag;
          else {
            previous.tag=beforeTag;
            immediate=who.id===mediaOwner&&Object.keys(next).every(k=>k==='tag'||JSON.stringify(next[k]??'')===JSON.stringify(previous[k]??''));
          }
        }
        if(!immediate && input.details!==undefined) award={format:2,details:validateForm('edit',input.details)};
      }
      requireThat(kind==='training' || JSON.stringify(previous) !== JSON.stringify(next), 400, 'The proposed sheet is already current.');
    }
    if((kind==='create'||kind==='edit') && next.path && (next.lineage!==previous?.lineage||next.path!==previous?.path)){
      const race=(await racePaths(q)).find((r:any)=>r.name===next.lineage);
      requireThat(race?.paths.includes(next.path),400,'Choose a current path for the selected race.');
    }
    if(kind==='create' || kind==='edit' || isDesign(kind)) await attachImage(q,input.fields?.portrait||input.fields?.art,service,mediaOwner);
    if(input.fields?.attainedForms && ['create','edit'].includes(kind)){
      for(const form of forms.readForms(next.attainedForms))await attachImage(q,form.portrait,service,mediaOwner);
    }
    const rows = await q(`INSERT INTO pc_requests
      (id,fingerprint,kind,character_id,owner_id,author_id,base_revision,before_sheet,after_sheet,reason,award,status,created_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING RETURNING *`,
      [id,fingerprint,kind,characterId,ownerId,who.id,version,previous && JSON.stringify(previous),JSON.stringify(next),reason,award && JSON.stringify(award),kind==='training'?'awaiting_judge':'pending',Date.now()]);
    if (rows.length) {
      if (!immediate) {
        if(kind==='create' && (await q('SELECT id FROM pc_characters WHERE owner_id=$1 LIMIT 1',[ownerId])).length)await queueForumCheck(q,ownerId);
        await q('INSERT INTO pc_review_posts(request_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
        return visibleRequest(rows[0]);
      }
      requireThat(await assignTag(q,ownerId,characterId,next.tag),409,'You already use that tag on another character.');
      const [saved]=await q("UPDATE pc_requests SET status='approved',decided_by=$1,decided_ms=$2,notified=1 WHERE id=$3 RETURNING *",[who.id,Date.now(),id]);
      await archiveFinal(q,saved);return visibleRequest(saved);
    }
    const [concurrent] = await q('SELECT * FROM pc_requests WHERE id=$1', [id]);
    requireThat(concurrent?.fingerprint === fingerprint, 409, 'That submission identifier was already used.');
    return visibleRequest(concurrent);
  });
}

export async function judgeTraining(db:Store, who:Actor, id:string, input:any, active:Set<string>) {
  requireThat(who.isJudge,403,'A training judge must assess the claim.');
  object(input);keys(input,['award','note']);
  const note=textValue(input.note,1600,'Staff judgment',true);
  return db.transaction(async q=>{
    const [row]=await q("SELECT * FROM pc_requests WHERE id=$1 AND kind='training'",[id]);
    requireThat(row && active.has(row.owner_id),404,'Training claim is unavailable.');
    const request=visibleRequest(row);
    const result=applyAward(request.before,input.award);
    const judgment={judgeId:who.id,note};
    if(request.status!=='awaiting_judge') {
      requireThat(request.judgment?.judgeId===who.id && request.judgment.note===note && JSON.stringify(result.award)===JSON.stringify(request.award),409,'This claim was already reviewed.');
      return request;
    }
    const [sheet]=await q('SELECT revision FROM pc_characters WHERE id=$1',[row.character_id]);
    const stale=!sheet || sheet.revision!==row.base_revision;
    const extra={format:2,details:request.details,judgment,award:result.award};
    const [changed]=await q(`UPDATE pc_requests SET status=$1,award=$2,after_sheet=$3,notified=0,notify_after=0,attempts=0,last_notify_error=NULL
      WHERE id=$4 AND status='awaiting_judge' RETURNING *`,[stale?'stale':'pending',JSON.stringify(extra),JSON.stringify(result.next),id]);
    requireThat(changed,409,'Another reviewer handled this claim. Reload the request.');
    if(changed.status==='stale')await archiveFinal(q,changed);return visibleRequest(changed);
  });
}

export async function archiveFinal(q:Query,row:Row){
  await q('INSERT INTO pc_archives(request_id,previous_status) VALUES($1,$2) ON CONFLICT(request_id) DO UPDATE SET previous_status=excluded.previous_status',[row.id,row.status]);row.archived=true;
}
async function queueForumCheck(q:Query,owner:string){
  const [config]=await q('SELECT value FROM pc_config WHERE slot=1');
  const forum=JSON.parse(config.value).updatesForum||defaultSettings.updatesForum,subject='player:'+owner;
  await q('INSERT INTO pc_forum_threads(forum_id,subject) VALUES($1,$2) ON CONFLICT DO NOTHING',[forum,subject]);
  await q('INSERT INTO pc_forum_checks VALUES($1,$2,0) ON CONFLICT(forum_id,subject) DO UPDATE SET retry_at=0',[forum,subject]);
}
export async function decide(db:Store,reviewer:string,ownerId:string,id:string,approve:boolean,roles:string[]=[],action='review',note='',decisionKey=''){
  return db.transaction(async q=>{
    const [cfg]=await q('SELECT value FROM pc_config WHERE slot=1');
    const helperRole=JSON.parse(cfg.value).judgeRole??defaultSettings.judgeRole,owner=reviewer===ownerId;
    requireThat(owner||(helperRole&&roles.includes(helperRole)),403,'Only the configured owner or a Convergence Helper can review this request.');
    const [existing]=await q('SELECT * FROM pc_requests WHERE id=$1'+(db.dialect==='postgres'?' FOR UPDATE':''),[id]);
    requireThat(existing,404,'Unknown request.');
    requireThat(existing.status!=='archived',409,'This request is archived. Restore it in PhoenixCore to resume review.');
    if(!['pending','awaiting_judge','needs_details','owner_review'].includes(existing.status))return visibleRequest(existing);
    let target=approve?'approved':'declined';
    if(existing.status==='owner_review'){
      requireThat(owner&&['uphold','veto'].includes(action),403,'The owner must uphold or veto the Helper denial.');
      const [denial]=await q('SELECT stage,decision_key FROM pc_denials WHERE request_id=$1',[id]);
      requireThat(denial,409,'Denial record unavailable.');
      requireThat(!decisionKey||decisionKey===denial.decision_key,409,'This denial has been replaced. Open the current request.');
      target=action==='uphold'?'declined':denial.stage==='pending'?'approved':denial.stage;
    }else{
      requireThat(action==='review',409,'There is no pending Helper denial.');
      requireThat(!approve||existing.status==='pending',409,existing.status==='needs_details'?'Complete the Discord submission before approval.':'A staff judgment is required before approval.');
      if(!approve&&!owner){
        target='owner_review';
        await q(`INSERT INTO pc_denials(request_id,stage,helper,note,decision_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id) DO UPDATE SET decision_key=excluded.decision_key,stage=excluded.stage,helper=excluded.helper,note=excluded.note,dm_channel=NULL,dm_message=NULL,attempts=0,retry_at=0`,[id,existing.status,reviewer,textValue(note,600,'Denial note'),randomUUID()]);
      }
    }
    const final=['approved','declined'].includes(target);
    const rows=await q('UPDATE pc_requests SET status=$1,decided_by=$2,decided_ms=$3,notified=0,notify_after=0,attempts=0,last_notify_error=NULL WHERE id=$4 RETURNING *',[target,final?reviewer:null,final?Date.now():null,id]);
    const r=rows[0];
    if (target==='approved' && !isDesign(r.kind)) {
      const after=JSON.parse(r.after_sheet), before=r.before_sheet?JSON.parse(r.before_sheet):null;
      const writesTag=Object.hasOwn(after,'tag');
      const tag=after.tag;
      delete after.tag;
      await q('SAVEPOINT character_review');
      const touched=r.kind==='create'
        ?await q('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[r.character_id,r.owner_id,JSON.stringify(after)])
        :await q('UPDATE pc_characters SET sheet=$1,revision=revision+1 WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING id',[JSON.stringify(after),r.character_id,r.owner_id,r.base_revision]);
      const applied=touched.length>0 && (!writesTag || ((await currentTag(q,r.character_id))===(before?.tag||'') && await assignTag(q,r.owner_id,r.character_id,tag)));
      if(applied && Object.hasOwn(after,'attainedForms')){
        const [current]=await q('SELECT form_key FROM pc_active_forms WHERE character_id=$1',[r.character_id]);
        if(current&&!forms.readForms(after.attainedForms).some((f:any)=>f.id===current.form_key))await q('DELETE FROM pc_active_forms WHERE character_id=$1',[r.character_id]);
      }
      if (!applied) await q('ROLLBACK TO SAVEPOINT character_review');
      await q('RELEASE SAVEPOINT character_review');
      if(applied && r.kind==='create')await queueForumCheck(q,r.owner_id);
      if (!applied) {
        await q("UPDATE pc_requests SET status='stale' WHERE id=$1", [id]);
        r.status='stale';
      }
    }
    if(r.status==='approved'&&isDesign(r.kind))await q('INSERT INTO pc_designs VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[r.id,r.kind,r.author_id,r.after_sheet]);
    if(['approved','declined','stale'].includes(r.status))await archiveFinal(q,r);
    return visibleRequest(r);
  });
}
