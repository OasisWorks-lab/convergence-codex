import { createHash } from 'node:crypto';
import { defaultSettings, type Store, type Row } from './db.ts';

export class Problem extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function requireThat(test: unknown, status: number, message: string): asserts test {
  if (!test) throw new Problem(status, message);
}
export const discordId = /^\d{17,20}$/;
const requestId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const profileLimits: Record<string, number> = {
  name: 64, lineage: 80, portrait: 500, bio: 1000, strength: 180, speed: 180, durability: 180, intelligence: 180, control: 180
};
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
function newProfile() {
  return { ...Object.fromEntries(Object.keys(profileLimits).map(k => [k, ''])), bpl: '0', wallet: '0', gear: [] as string[] };
}
function profile(input: any, previous: Record<string, any>) {
  object(input); keys(input, [...Object.keys(profileLimits), 'bpl']);
  const next: Record<string, any> = { ...previous };
  for (const [key, raw] of Object.entries(input)) {
    next[key] = key === 'bpl' ? integer(raw, 'Base Power Level') : textValue(raw, profileLimits[key], key, key === 'name');
  }
  if (next.portrait) {
    const codexArt = /^\.\.\/assets\/uploads\/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp|gif)$/i;
    let allowed = codexArt.test(next.portrait) && !next.portrait.slice(3).includes('..');
    try {
      const image = new URL(next.portrait);
      allowed ||= image.protocol === 'https:' && !image.username && !image.password && !image.port && ['cdn.discordapp.com','media.discordapp.net'].includes(image.hostname);
    } catch { /* A Codex artwork path is relative to the dashboard. */ }
    requireThat(allowed, 400, 'Use a Discord image URL or an image under ../assets/uploads/.');
  }
  requireThat(next.name, 400, 'Give the character a name.');
  return next;
}

export function applyAward(before: Record<string, any>, input: any) {
  object(input); keys(input, ['percent', 'currency', 'gear']);
  const percent = textValue(input.percent ?? '0', 12, 'Percentage', true);
  requireThat(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(percent), 400, 'Enter a nonnegative percentage with up to two decimal places.');
  const [whole, fraction = ''] = percent.split('.');
  const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const currency = integer(input.currency ?? '0', 'Currency grant');
  requireThat(Array.isArray(input.gear ?? []) && (input.gear ?? []).length <= 20, 400, 'Use up to 20 gear entries per award.');
  const gear = (input.gear ?? []).map((v: unknown) => textValue(v, 100, 'Gear', true));
  const gain = BigInt(before.bpl) * basisPoints / 10000n;
  const next = { ...before, bpl: integer(String(BigInt(before.bpl) + gain), 'Resulting BPL'),
    wallet: integer(String(BigInt(before.wallet) + BigInt(currency)), 'Resulting wallet'), gear: [...before.gear, ...gear] };
  requireThat(gain > 0n || BigInt(currency) > 0n || gear.length, 400, 'The award must change the sheet after whole-point rounding.');
  return { next, award: { percent, gain: String(gain), currency, gear } };
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
  return { revision: Number(row.revision), value: JSON.parse(row.value) as Settings };
}
export async function saveSettings(db: Store, actor: Actor, input: any) {
  requireThat(actor.isOwner, 403, 'Only the configured owner can change bot settings.');
  object(input); object(input.value); keys(input.value, Object.keys(defaultSettings));
  const value = { ...defaultSettings };
  for (const key of ['playerRole', 'judgeRole', 'reviewChannel'] as const) {
    const id = input.value[key];
    requireThat(typeof id === 'string' && (!id || discordId.test(id)), 400, 'Enter a Discord ID or leave the field empty.');
    value[key] = id;
  }
  value.currency = textValue(input.value.currency, 32, 'Currency name', true);
  await db.transaction(async q => {
    const [old] = await q('SELECT revision,value FROM pc_config WHERE slot=1');
    const rows = await q('UPDATE pc_config SET value=$1,revision=revision+1 WHERE slot=1 AND revision=$2 RETURNING revision', [JSON.stringify(value), input.revision]);
    requireThat(rows.length && old.revision === input.revision, 409, 'Settings changed. Reload and review the current values.');
    await q('INSERT INTO pc_settings_history VALUES($1,$2,$3,$4,$5)', [rows[0].revision, actor.id, old.value, JSON.stringify(value), Date.now()]);
  });
}
export function visibleRequest(r: Row) {
  return { id:r.id, kind:r.kind, characterId:r.character_id, ownerId:r.owner_id, authorId:r.author_id,
    version:Number(r.base_revision), before:r.before_sheet ? JSON.parse(r.before_sheet) : null, after:JSON.parse(r.after_sheet),
    award:r.award ? JSON.parse(r.award) : null, reason:r.reason, status:r.status, created:Number(r.created_ms),
    decidedBy:r.decided_by, decided:r.decided_ms ? Number(r.decided_ms) : null,
    delivery:r.notified ? 'Delivered' : r.last_notify_error ? 'Retry scheduled' : 'Queued' };
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export async function propose(db: Store, who: Actor, input: any, active: Set<string>) {
  object(input); keys(input, ['id','kind','characterId','version','fields','award','reason']);
  requireThat(typeof input.id === 'string' && requestId.test(input.id), 400, 'Invalid request identifier.');
  const { kind, id } = input;
  requireThat(['create','edit','award'].includes(kind), 400, 'Unknown request type.');
  if (kind === 'award') requireThat(who.isJudge, 403, 'A training judge must assign an award.');
  else requireThat(who.isPlayer && active.has(who.id), 403, 'A current player may submit a character sheet.');
  const reason = textValue(input.reason, 600, 'Reason', true);
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical([who.id,input]))).digest('hex');
  return db.transaction(async q => {
    const [retry] = await q('SELECT * FROM pc_requests WHERE id=$1', [id]);
    if (retry) {
      requireThat(retry.fingerprint === fingerprint, 409, 'That submission identifier was already used.');
      return visibleRequest(retry);
    }
    let ownerId=who.id, version=0, characterId=id, previous=null, award=null;
    let next: Record<string, any>;
    if (kind === 'create') {
      next=profile(input.fields, newProfile());
    } else {
      requireThat(typeof input.characterId === 'string' && requestId.test(input.characterId), 400, 'Choose a character.');
      const [sheet] = await q('SELECT * FROM pc_characters WHERE id=$1', [input.characterId]);
      requireThat(sheet && active.has(sheet.owner_id), 404, 'Character is unavailable.');
      requireThat(kind === 'award' || sheet.owner_id === who.id, 403, 'You can propose edits only to your characters.');
      requireThat(Number.isInteger(input.version) && sheet.revision === input.version, 409, 'The sheet changed. Reload before submitting.');
      ownerId=sheet.owner_id; version=sheet.revision; characterId=sheet.id; previous=JSON.parse(sheet.sheet);
      if (kind === 'award') ({ next, award } = applyAward(previous, input.award));
      else next=profile(input.fields, previous);
      requireThat(JSON.stringify(previous) !== JSON.stringify(next), 400, 'The proposed sheet is already current.');
    }
    const rows = await q(`INSERT INTO pc_requests
      (id,fingerprint,kind,character_id,owner_id,author_id,base_revision,before_sheet,after_sheet,reason,award,status,created_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12) ON CONFLICT(id) DO NOTHING RETURNING *`,
      [id,fingerprint,kind,characterId,ownerId,who.id,version,previous && JSON.stringify(previous),JSON.stringify(next),reason,award && JSON.stringify(award),Date.now()]);
    if (rows.length) return visibleRequest(rows[0]);
    const [concurrent] = await q('SELECT * FROM pc_requests WHERE id=$1', [id]);
    requireThat(concurrent?.fingerprint === fingerprint, 409, 'That submission identifier was already used.');
    return visibleRequest(concurrent);
  });
}

export async function decide(db: Store, reviewer: string, ownerId: string, id: string, approve: boolean) {
  requireThat(reviewer === ownerId, 403, 'Only the configured owner can review this request.');
  return db.transaction(async q => {
    const rows = await q("UPDATE pc_requests SET status=$1,decided_by=$2,decided_ms=$3 WHERE id=$4 AND status='pending' RETURNING *", [approve?'approved':'declined',reviewer,Date.now(),id]);
    if (!rows.length) {
      const [existing] = await q('SELECT * FROM pc_requests WHERE id=$1', [id]);
      requireThat(existing, 404, 'Unknown request.');
      return visibleRequest(existing);
    }
    const r=rows[0];
    if (approve) {
      const touched = r.kind === 'create'
        ? await q('INSERT INTO pc_characters(id,owner_id,revision,sheet) VALUES($1,$2,1,$3) ON CONFLICT(id) DO NOTHING RETURNING id', [r.character_id,r.owner_id,r.after_sheet])
        : await q('UPDATE pc_characters SET sheet=$1,revision=revision+1 WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING id', [r.after_sheet,r.character_id,r.owner_id,r.base_revision]);
      if (!touched.length) {
        await q("UPDATE pc_requests SET status='stale' WHERE id=$1", [id]);
        r.status='stale';
      }
    }
    return visibleRequest(r);
  });
}
