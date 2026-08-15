import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { logError } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the database location (defaults to <project_root>/data/uptime.db).
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DEFAULT_DATA_DIR, 'uptime.db');

// Make sure the target directory exists before opening the SQLite connection.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema: created once if missing. Single source of truth for all tables.
db.exec(`
  CREATE TABLE IF NOT EXISTS targets (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    type               TEXT NOT NULL DEFAULT 'bot',
    has_important_role INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'active',
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS downtime_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id  TEXT NOT NULL,
    down_start INTEGER NOT NULL,
    up_end     INTEGER,
    FOREIGN KEY (target_id) REFERENCES targets (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mutes (
    target_id   TEXT PRIMARY KEY,
    muted_until INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    kind       TEXT NOT NULL,
    target_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (kind, target_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_target ON downtime_sessions (target_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_open   ON downtime_sessions (target_id, up_end);
`);

/** Close the database handle gracefully (used during shutdown). */
export function closeDatabase() {
  try {
    db.close();
  } catch (err) {
    logError('Db.closeDatabase', err);
  }
}

export default db;
