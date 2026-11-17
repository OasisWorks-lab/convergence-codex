-- Proposed Phoenix Core SQLite / Cloudflare D1 schema.
-- This file is documentation and has NOT been deployed or migrated.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_discord_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  race TEXT,
  path TEXT,
  approved_sheet_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(guild_id, owner_discord_user_id)
    REFERENCES players(guild_id, discord_user_id)
);
CREATE INDEX IF NOT EXISTS idx_character_owner ON characters(guild_id, owner_discord_user_id);

-- There is no user-level wallet: assets belong to a particular character.
CREATE TABLE IF NOT EXISTS character_wallets (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  currency_key TEXT NOT NULL DEFAULT 'credits',
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
);

CREATE TABLE IF NOT EXISTS character_items (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_data_json TEXT NOT NULL DEFAULT '{}',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_items_character ON character_items(character_id);

CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  submitted_by_discord_user_id TEXT NOT NULL,
  base_character_version INTEGER NOT NULL,
  proposed_patch_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','APPROVED','DENIED','CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by_discord_user_id TEXT,
  review_note TEXT,
  discord_notification_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_queue ON change_requests(status,created_at);
CREATE INDEX IF NOT EXISTS idx_request_character ON change_requests(character_id,created_at);

CREATE TABLE IF NOT EXISTS bot_settings (
  guild_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(guild_id,key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  actor_discord_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type,entity_id,created_at);

-- This schema cannot establish identity or enforce owner-only settings.
-- All ownership, approval, and settings permissions must be enforced
-- in the authenticated backend, and approvals must be transactional.
