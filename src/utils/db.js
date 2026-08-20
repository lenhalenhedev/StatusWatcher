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

  CREATE TABLE IF NOT EXISTS incidents (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_key               TEXT NOT NULL UNIQUE,
    service_id                 TEXT NOT NULL,
    service_type               TEXT NOT NULL,
    name                       TEXT NOT NULL,
    status                     TEXT NOT NULL DEFAULT 'OPEN',
    opened_at                  INTEGER NOT NULL,
    updated_at                 INTEGER NOT NULL,
    resolved_at                INTEGER,
    error_category             TEXT,
    status_code                INTEGER,
    down_since                INTEGER,
    acknowledged_by            TEXT,
    acknowledged_at            INTEGER,
    communication_resolved_by  TEXT,
    communication_resolved_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS incident_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id     INTEGER NOT NULL,
    incident_key    TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    occurred_at     INTEGER NOT NULL,
    service_type    TEXT NOT NULL,
    service_id      TEXT NOT NULL,
    error_category  TEXT,
    status_code     INTEGER,
    duration_ms     INTEGER,
    reason          TEXT,
    actor_id        TEXT,
    FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS maintenance_windows (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id  TEXT NOT NULL,
    service_type TEXT NOT NULL,
    starts_at   INTEGER NOT NULL,
    ends_at     INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS latency_samples (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id     TEXT NOT NULL,
    service_type   TEXT NOT NULL,
    observed_at    INTEGER NOT NULL,
    duration_ms    INTEGER NOT NULL,
    success        INTEGER NOT NULL CHECK (success IN (0, 1)),
    status_code    INTEGER,
    probe_status   TEXT NOT NULL DEFAULT 'ONLINE',
    error_category TEXT,
    retry_index    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS service_dependencies (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id             TEXT NOT NULL,
    depends_on_service_id  TEXT NOT NULL,
    dependency_group_id    TEXT,
    created_by             TEXT NOT NULL,
    created_at             INTEGER NOT NULL,
    UNIQUE (service_id, depends_on_service_id)
  );

  CREATE TABLE IF NOT EXISTS config_audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    action       TEXT NOT NULL,
    actor_id     TEXT NOT NULL,
    target_type  TEXT NOT NULL,
    target_id    TEXT,
    value_hash   TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_ownership (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    service_id   TEXT NOT NULL,
    role_id      TEXT NOT NULL,
    updated_by   TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (service_type, service_id)
  );

  CREATE TABLE IF NOT EXISTS slos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type        TEXT NOT NULL,
    service_id          TEXT NOT NULL,
    target_percent      REAL NOT NULL,
    window_days         INTEGER NOT NULL,
    maintenance_policy  TEXT NOT NULL,
    created_by          TEXT NOT NULL,
    updated_at          INTEGER NOT NULL,
    UNIQUE (service_type, service_id)
  );

  CREATE TABLE IF NOT EXISTS tls_certificate_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type   TEXT NOT NULL,
    service_id     TEXT NOT NULL,
    observed_at    INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    fingerprint_hash TEXT NOT NULL,
    warning_mask   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_target ON downtime_sessions (target_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_open   ON downtime_sessions (target_id, up_end);
  CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events (incident_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_incident_events_key ON incident_events (incident_key, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_maintenance_service_window ON maintenance_windows (service_type, service_id, starts_at, ends_at);
  CREATE INDEX IF NOT EXISTS idx_latency_service_time ON latency_samples (service_type, service_id, observed_at);
  CREATE INDEX IF NOT EXISTS idx_dependencies_service ON service_dependencies (service_id);
  CREATE INDEX IF NOT EXISTS idx_dependencies_dependency ON service_dependencies (depends_on_service_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON config_audit_log (created_at);
  CREATE INDEX IF NOT EXISTS idx_ownership_service ON service_ownership (service_type, service_id);
  CREATE INDEX IF NOT EXISTS idx_slo_service ON slos (service_type, service_id);
  CREATE INDEX IF NOT EXISTS idx_tls_service_time ON tls_certificate_snapshots (service_type, service_id, observed_at);
`);

// Backward-compatible migration for databases created before probe evidence
// metadata was added. Column names are fixed constants, never user input.
const latencyColumns = new Set(db.prepare('PRAGMA table_info(latency_samples)').all().map((column) => column.name));
if (!latencyColumns.has('probe_status')) {
  db.exec("ALTER TABLE latency_samples ADD COLUMN probe_status TEXT NOT NULL DEFAULT 'ONLINE'");
}
if (!latencyColumns.has('error_category')) {
  db.exec('ALTER TABLE latency_samples ADD COLUMN error_category TEXT');
}
if (!latencyColumns.has('retry_index')) {
  db.exec('ALTER TABLE latency_samples ADD COLUMN retry_index INTEGER NOT NULL DEFAULT 0');
}

/** Close the database handle gracefully (used during shutdown). */
export function closeDatabase() {
  try {
    db.close();
  } catch (err) {
    logError('Db.closeDatabase', err);
  }
}

export default db;
