import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Params = (string | number | null)[];
export type Row = Record<string, any>;
export type Query = (sql: string, values?: Params) => Promise<Row[]>;
export interface Store {
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

export const defaultSettings = { playerRole: '', judgeRole: '', reviewChannel: '', currency: 'Credits' };
const ddl = [
  'CREATE TABLE IF NOT EXISTS pc_config (slot INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_settings_history (revision INTEGER PRIMARY KEY, actor TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, at_ms BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_characters (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, sheet TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pc_characters_owner ON pc_characters(owner_id)',
  `CREATE TABLE IF NOT EXISTS pc_requests (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, kind TEXT NOT NULL, character_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, author_id TEXT NOT NULL, base_revision INTEGER NOT NULL,
    before_sheet TEXT, after_sheet TEXT NOT NULL, reason TEXT NOT NULL, award TEXT,
    status TEXT NOT NULL, created_ms BIGINT NOT NULL, decided_by TEXT, decided_ms BIGINT,
    notified INTEGER NOT NULL DEFAULT 0, notify_after BIGINT NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, last_notify_error TEXT)`,
  'CREATE INDEX IF NOT EXISTS pc_requests_delivery ON pc_requests(status,notified,notify_after)',
  'CREATE TABLE IF NOT EXISTS pc_auth_state (id TEXT PRIMARY KEY, binding TEXT NOT NULL, challenge TEXT NOT NULL, expires BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_exchanges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge TEXT NOT NULL, expires BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pc_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires BIGINT NOT NULL)'
];

export async function initialize(db: Store, guildId: string) {
  await db.transaction(async q => {
    for (const statement of ddl) await q(statement);
    await q('INSERT INTO pc_config(slot,guild_id,revision,value) VALUES(1,$1,1,$2) ON CONFLICT(slot) DO NOTHING', [guildId, JSON.stringify(defaultSettings)]);
    const [config] = await q('SELECT guild_id FROM pc_config WHERE slot=1');
    if (config.guild_id !== guildId) throw new Error('This database belongs to a different Convergence server. Check DISCORD_GUILD_ID or use a new database.');
  });
}
