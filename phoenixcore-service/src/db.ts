import forms from '../../phoenixcore/templates.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Params = (string | number | Uint8Array | null)[];
export type Row = Record<string, any>;
export type Query = (sql: string, values?: Params) => Promise<Row[]>;
export interface Store {
  dialect: 'sqlite' | 'postgres';
  query: Query;
  transaction<T>(fn: (query: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function openSqlite(file: string): Store {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  const query: Query = async (sql, values = []) => {
    const ordered: Params = [];
    const statement = db.prepare(sql.replace(/\$(\d+)/g, (_, n) => {
      ordered.push(values[Number(n) - 1]);
      return '?';
    }));
    return statement.all(...ordered);
  };
  // A transaction and ordinary reads must never interleave on the same connection.
  let tail = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn);
    tail = next.then(() => {}, () => {});
    return next;
  }
  return {
    dialect:'sqlite',
    query: (sql, values) => exclusive(() => query(sql, values)),
    transaction: fn => exclusive(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = await fn(query);
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),
    close: () => exclusive(async () => { db.close(); })
  };
}

export async function openPostgres(url: string): Promise<Store> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 8 });
  return {
    dialect:'postgres',
    query: async (sql, values) => (await pool.query(sql, values)).rows,
    transaction: async fn => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(async (sql, values) => (await client.query(sql, values)).rows);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end()
  };
}

export const defaultSettings = { playerRole: '', judgeRole: '1100315893864603649', submissionMessage:'{helper} A {type} submission for {character} is ready for review.', commandPrefixes:'pc!', botNickname:'', loreParagraphs:'0', loreSentences:'0', loreWords:'0', reviewGuidance:'', reviewChannel: '', ...forms.reviewRoutes as {characterChannel:string;designChannel:string;updatesForum:string}, currency: 'Zeni', rpChannels: '', rpDivider: '' };
const ddl = [
  'CREATE TABLE IF NOT EXISTS pc_rp_scenes (channel_id TEXT PRIMARY KEY, scene_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, ready_at BIGINT NOT NULL DEFAULT 0, lease_token TEXT, lease_until BIGINT NOT NULL DEFAULT 0, speech TEXT, attempts INTEGER NOT NULL DEFAULT 0, delivery_note TEXT)',
  'CREATE TABLE IF NOT EXISTS pc_rp_clocks (scene_id TEXT PRIMARY KEY REFERENCES pc_rp_scenes(scene_id) ON DELETE CASCADE,due_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_rp_clock_due ON pc_rp_clocks(due_at)',
  'CREATE TABLE IF NOT EXISTS pc_rp_panels (scene_id TEXT PRIMARY KEY REFERENCES pc_rp_scenes(scene_id) ON DELETE CASCADE,message_id TEXT,embed TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,delivered_revision INTEGER NOT NULL DEFAULT 0,retry_at BIGINT NOT NULL DEFAULT 0,lease TEXT,lease_until BIGINT NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS pc_rp_panels_pending ON pc_rp_panels(retry_at,lease_until)',
  'CREATE TABLE IF NOT EXISTS pc_rp_notices (id TEXT PRIMARY KEY,scene_id TEXT NOT NULL REFERENCES pc_rp_scenes(scene_id) ON DELETE CASCADE,turn_key TEXT NOT NULL,payload TEXT NOT NULL,retry_at BIGINT NOT NULL,lease TEXT)',
  'CREATE INDEX IF NOT EXISTS pc_rp_notice_due ON pc_rp_notices(retry_at)',
  'CREATE TABLE IF NOT EXISTS pc_npc_posts (post_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, character_id TEXT NOT NULL, form_key TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_rp_delivery ON pc_rp_scenes(ready_at,lease_until)',
  'CREATE TABLE IF NOT EXISTS pc_rp_receipts (id TEXT PRIMARY KEY, created_ms BIGINT NOT NULL, result TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_npc_ai_usage (day TEXT PRIMARY KEY, used INTEGER NOT NULL)',

  'CREATE TABLE IF NOT EXISTS pc_community_modules (module TEXT PRIMARY KEY,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,actor_id TEXT NOT NULL,updated_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_community_module_history (module TEXT NOT NULL,revision INTEGER NOT NULL,previous_enabled INTEGER,enabled INTEGER NOT NULL,actor_id TEXT NOT NULL,occurred_ms BIGINT NOT NULL,PRIMARY KEY(module,revision))',
  'CREATE TABLE IF NOT EXISTS pc_info_tags (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,body TEXT NOT NULL,author_id TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_ms BIGINT NOT NULL,updated_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_info_tag_aliases (alias TEXT PRIMARY KEY,tag_id TEXT NOT NULL REFERENCES pc_info_tags(id) ON DELETE CASCADE)',
  'CREATE TABLE IF NOT EXISTS pc_info_tag_history (tag_id TEXT NOT NULL REFERENCES pc_info_tags(id),revision INTEGER NOT NULL,body TEXT NOT NULL,actor_id TEXT NOT NULL,changed_ms BIGINT NOT NULL,PRIMARY KEY(tag_id,revision))',
  'CREATE TABLE IF NOT EXISTS pc_info_tag_proposals (id TEXT PRIMARY KEY,author_id TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,created_ms BIGINT NOT NULL,decided_by TEXT,decided_ms BIGINT,note TEXT)',
  'CREATE INDEX IF NOT EXISTS pc_info_tag_proposals_status ON pc_info_tag_proposals(status,created_ms)',
  'CREATE TABLE IF NOT EXISTS pc_suggestions (id TEXT PRIMARY KEY,author_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,anonymous INTEGER NOT NULL,status TEXT NOT NULL,staff_response TEXT NOT NULL DEFAULT \'\',created_ms BIGINT NOT NULL,updated_ms BIGINT NOT NULL,reviewed_by TEXT)',
  'CREATE INDEX IF NOT EXISTS pc_suggestions_status ON pc_suggestions(status,created_ms)',
  'CREATE TABLE IF NOT EXISTS pc_suggestion_votes (suggestion_id TEXT NOT NULL REFERENCES pc_suggestions(id) ON DELETE CASCADE,voter_id TEXT NOT NULL,choice INTEGER NOT NULL,updated_ms BIGINT NOT NULL,PRIMARY KEY(suggestion_id,voter_id))',
  'CREATE TABLE IF NOT EXISTS pc_suggestion_history (suggestion_id TEXT NOT NULL REFERENCES pc_suggestions(id) ON DELETE CASCADE,revision INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,detail TEXT NOT NULL,occurred_ms BIGINT NOT NULL,PRIMARY KEY(suggestion_id,revision))',

  'CREATE TABLE IF NOT EXISTS pc_suggestion_posts (suggestion_id TEXT PRIMARY KEY REFERENCES pc_suggestions(id) ON DELETE CASCADE,channel_id TEXT NOT NULL,message_id TEXT,revision INTEGER NOT NULL DEFAULT 1,delivered_revision INTEGER NOT NULL DEFAULT 0,retry_at BIGINT NOT NULL DEFAULT 0,lease TEXT,lease_until BIGINT NOT NULL DEFAULT 0,last_error TEXT)',
  'CREATE INDEX IF NOT EXISTS pc_suggestion_posts_pending ON pc_suggestion_posts(retry_at,lease_until)',
  'CREATE TABLE IF NOT EXISTS pc_suggestion_removals (suggestion_id TEXT PRIMARY KEY REFERENCES pc_suggestions(id) ON DELETE CASCADE,removed_by TEXT NOT NULL,removed_ms BIGINT NOT NULL,reason TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_community_notifications (id TEXT PRIMARY KEY,suggestion_id TEXT NOT NULL REFERENCES pc_suggestions(id) ON DELETE CASCADE,user_id TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',not_before BIGINT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until BIGINT NOT NULL DEFAULT 0,message_id TEXT,last_error TEXT)',
  'CREATE INDEX IF NOT EXISTS pc_community_notice_due ON pc_community_notifications(status,not_before,lease_until)',
  'CREATE TABLE IF NOT EXISTS pc_npc_ai_providers (provider_key TEXT PRIMARY KEY,day TEXT NOT NULL,day_used INTEGER NOT NULL DEFAULT 0,minute_bucket BIGINT NOT NULL DEFAULT 0,minute_used INTEGER NOT NULL DEFAULT 0,blocked_until BIGINT NOT NULL DEFAULT 0,last_status TEXT NOT NULL DEFAULT \'new\',last_checked_ms BIGINT NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS pc_mod_cases (id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL UNIQUE,target_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,reason TEXT NOT NULL,created_ms BIGINT NOT NULL,source_message_id TEXT,posted_message_id TEXT,source_channel_id TEXT,character_id TEXT,active INTEGER NOT NULL DEFAULT 0,removed_by TEXT,removed_ms BIGINT)',
  'CREATE INDEX IF NOT EXISTS pc_mod_cases_target ON pc_mod_cases(target_id,created_ms)',
  'CREATE INDEX IF NOT EXISTS pc_mod_active_warnings ON pc_mod_cases(target_id,kind,active)',
  'CREATE TABLE IF NOT EXISTS pc_mod_case_events (id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES pc_mod_cases(id) ON DELETE CASCADE,actor_id TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,occurred_ms BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_mod_case_events_case ON pc_mod_case_events(case_id,occurred_ms)',
  'CREATE TABLE IF NOT EXISTS pc_core_jobs (id TEXT PRIMARY KEY,job_type TEXT NOT NULL,recipient_id TEXT NOT NULL,payload TEXT NOT NULL,due_ms BIGINT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until BIGINT NOT NULL DEFAULT 0,last_error TEXT,delivery_id TEXT,created_ms BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_core_jobs_due ON pc_core_jobs(status,due_ms,lease_until)',
  'CREATE TABLE IF NOT EXISTS pc_migrations (name TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS pc_denials (request_id TEXT PRIMARY KEY, decision_key TEXT NOT NULL, stage TEXT NOT NULL, helper TEXT NOT NULL, note TEXT NOT NULL, dm_channel TEXT, dm_message TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at BIGINT NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS pc_designs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, author_id TEXT NOT NULL, fields TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_forum_checks (forum_id TEXT NOT NULL, subject TEXT NOT NULL, retry_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(forum_id,subject))',
  'CREATE TABLE IF NOT EXISTS pc_bot_profile (slot INTEGER PRIMARY KEY, nick TEXT NOT NULL, retry_at BIGINT NOT NULL, status TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_announcements (kind TEXT PRIMARY KEY, revision INTEGER NOT NULL, draft TEXT NOT NULL, channel_id TEXT, message_id TEXT)',
  'CREATE TABLE IF NOT EXISTS pc_native (id TEXT PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, raw_text TEXT NOT NULL, input TEXT NOT NULL, attachments TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_deleted_requests (id TEXT PRIMARY KEY)',
  `CREATE TABLE IF NOT EXISTS pc_forum_threads (forum_id TEXT NOT NULL, subject TEXT NOT NULL, thread_id TEXT,
    attempted_name TEXT, attempted_ms BIGINT, attempts INTEGER NOT NULL DEFAULT 0, retry_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY(forum_id,subject))`,
  'CREATE TABLE IF NOT EXISTS pc_review_posts (request_id TEXT PRIMARY KEY, channel_id TEXT, message_id TEXT, lease_until BIGINT NOT NULL DEFAULT 0, lease_token TEXT)',
  'CREATE TABLE IF NOT EXISTS pc_codex (entry_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, fields TEXT NOT NULL, editor TEXT NOT NULL, edited_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_archives (request_id TEXT PRIMARY KEY, previous_status TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_active_forms (character_id TEXT PRIMARY KEY, form_key TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_config (slot INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_settings_history (revision INTEGER PRIMARY KEY, actor TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, at_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_characters (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, sheet TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_characters_owner ON pc_characters(owner_id)',
  'CREATE TABLE IF NOT EXISTS pc_npc_encounters (id TEXT PRIMARY KEY, npc_id TEXT NOT NULL REFERENCES pc_characters(id) ON DELETE CASCADE, character_id TEXT NOT NULL REFERENCES pc_characters(id) ON DELETE CASCADE, scene_id TEXT NOT NULL, round INTEGER NOT NULL, occurred_ms BIGINT NOT NULL, player_text TEXT NOT NULL, npc_reply TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_npc_encounters_pair ON pc_npc_encounters(npc_id,character_id,occurred_ms)',
  'CREATE INDEX IF NOT EXISTS pc_npc_encounters_scene ON pc_npc_encounters(scene_id)',
  'CREATE TABLE IF NOT EXISTS pc_economy_accounts (character_id TEXT PRIMARY KEY REFERENCES pc_characters(id) ON DELETE CASCADE,currency_id TEXT NOT NULL,cash TEXT NOT NULL,bank TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)',
  'CREATE TABLE IF NOT EXISTS pc_economy_transactions (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,kind TEXT NOT NULL,reason TEXT NOT NULL,amount TEXT NOT NULL,currency_id TEXT NOT NULL,fingerprint TEXT NOT NULL,created_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_economy_entries (transaction_id TEXT NOT NULL REFERENCES pc_economy_transactions(id),character_id TEXT NOT NULL,cash_before TEXT NOT NULL,cash_after TEXT NOT NULL,bank_before TEXT NOT NULL,bank_after TEXT NOT NULL,PRIMARY KEY(transaction_id,character_id))',
  'CREATE INDEX IF NOT EXISTS pc_economy_entries_character ON pc_economy_entries(character_id)',
  'CREATE TABLE IF NOT EXISTS pc_character_favorites (user_id TEXT NOT NULL, character_id TEXT NOT NULL REFERENCES pc_characters(id) ON DELETE CASCADE, created_ms BIGINT NOT NULL, PRIMARY KEY(user_id,character_id))',
  `CREATE TABLE IF NOT EXISTS pc_requests (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, kind TEXT NOT NULL, character_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, author_id TEXT NOT NULL, base_revision INTEGER NOT NULL,
    before_sheet TEXT, after_sheet TEXT NOT NULL, reason TEXT NOT NULL, award TEXT,
    status TEXT NOT NULL, created_ms BIGINT NOT NULL, decided_by TEXT, decided_ms BIGINT,
    notified INTEGER NOT NULL DEFAULT 0, notify_after BIGINT NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, last_notify_error TEXT)`,
  'CREATE INDEX IF NOT EXISTS pc_requests_delivery ON pc_requests(status,notified,notify_after)',
  'CREATE TABLE IF NOT EXISTS pc_post_tags (owner_id TEXT NOT NULL, tag TEXT NOT NULL, character_id TEXT NOT NULL UNIQUE, PRIMARY KEY(owner_id,tag))',
  'CREATE TABLE IF NOT EXISTS pc_images (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, mime TEXT NOT NULL, bytes BYTEA NOT NULL, size INTEGER NOT NULL, attached INTEGER NOT NULL DEFAULT 0, created_ms BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_images_staging ON pc_images(owner_id,attached,created_ms)',
  'CREATE TABLE IF NOT EXISTS pc_post_defaults (owner_id TEXT NOT NULL, channel_id TEXT NOT NULL, character_id TEXT NOT NULL, PRIMARY KEY(owner_id,channel_id))',
  'CREATE TABLE IF NOT EXISTS pc_posts (source_id TEXT PRIMARY KEY, posted_id TEXT UNIQUE, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, character_id TEXT NOT NULL, character_name TEXT NOT NULL, created_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_auth_state (id TEXT PRIMARY KEY, binding TEXT NOT NULL, challenge TEXT NOT NULL, expires BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_exchanges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge TEXT NOT NULL, expires BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL)'
];

export async function initialize(db: Store, guildId: string) {
  await db.transaction(async q => {
    if(db.dialect==='postgres') await q('SELECT pg_advisory_xact_lock(739124861)');
    for (const statement of ddl) await q(statement);
    if(db.dialect==='postgres') await q('ALTER TABLE pc_post_tags ADD COLUMN IF NOT EXISTS tag_key TEXT');
    else if(!(await q('PRAGMA table_info(pc_post_tags)')).some(column=>column.name==='tag_key')) await q('ALTER TABLE pc_post_tags ADD COLUMN tag_key TEXT');
    await q('UPDATE pc_post_tags SET tag_key=tag WHERE tag_key IS NULL');
    await q('CREATE UNIQUE INDEX IF NOT EXISTS pc_tag_per_writer ON pc_post_tags(owner_id,tag_key)');
    // Pending requests delivered by an earlier DM-only installation still need a server review card.
    await q(`UPDATE pc_requests SET notified=0,notify_after=0 WHERE notified=1 AND status IN ('pending','awaiting_judge')
      AND NOT EXISTS (SELECT 1 FROM pc_review_posts p WHERE p.request_id=pc_requests.id AND p.message_id IS NOT NULL)`);
    await q(`INSERT INTO pc_review_posts(request_id) SELECT id FROM pc_requests WHERE status IN ('pending','awaiting_judge') ON CONFLICT DO NOTHING`);
    await q('INSERT INTO pc_config(slot,guild_id,revision,value) VALUES(1,$1,1,$2) ON CONFLICT(slot) DO NOTHING', [guildId, JSON.stringify(defaultSettings)]);
    const [config] = await q('SELECT guild_id FROM pc_config WHERE slot=1');
    if (config.guild_id !== guildId) throw new Error('This database belongs to a different Convergence server. Check DISCORD_GUILD_ID or use a new database.');
    const changed=await q("INSERT INTO pc_migrations(name) VALUES('helper-review-v1') ON CONFLICT DO NOTHING RETURNING name");
    if(changed.length){
      const [row]=await q('SELECT value FROM pc_config WHERE slot=1');
      await q('UPDATE pc_config SET value=$1 WHERE slot=1',[JSON.stringify({...JSON.parse(row.value),judgeRole:defaultSettings.judgeRole})]);
      await q("INSERT INTO pc_archives SELECT id,status FROM pc_requests WHERE status IN ('approved','declined','stale') ON CONFLICT DO NOTHING");
      await q("INSERT INTO pc_designs SELECT id,kind,author_id,after_sheet FROM pc_requests WHERE status='approved' AND kind IN ('technique','item','race','transformation') ON CONFLICT DO NOTHING");
    }
    const {seedExistingAccounts}=await import('./economy.ts');
    await seedExistingAccounts(q);
  });
}
