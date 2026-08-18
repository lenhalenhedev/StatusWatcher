import db from '../utils/db.js';
import { logError } from '../utils/logger.js';

// Runtime configuration is intentionally separate from targets: target history
// belongs to uptime reporting, while these rows represent the current operator
// settings managed by /config.
db.exec(`
  CREATE TABLE IF NOT EXISTS runtime_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS minecraft_servers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    host       TEXT NOT NULL,
    port       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (host, port)
  );
`);

const stmtListConfig = db.prepare('SELECT key, value FROM runtime_config ORDER BY key');
const stmtGetConfig = db.prepare('SELECT value FROM runtime_config WHERE key = ?');
const stmtInsertConfigIgnore = db.prepare(`
  INSERT OR IGNORE INTO runtime_config (key, value, updated_at)
  VALUES (?, ?, ?)
`);
const stmtUpsertConfig = db.prepare(`
  INSERT INTO runtime_config (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const stmtDeleteConfig = db.prepare('DELETE FROM runtime_config WHERE key = ?');
const stmtListMc = db.prepare('SELECT * FROM minecraft_servers ORDER BY created_at, id');
const stmtGetMc = db.prepare('SELECT * FROM minecraft_servers WHERE id = ?');
const stmtInsertMc = db.prepare(`
  INSERT INTO minecraft_servers (id, name, host, port, created_at, updated_at)
  VALUES (@id, @name, @host, @port, @now, @now)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    host = excluded.host,
    port = excluded.port,
    updated_at = excluded.updated_at
`);
const stmtDeleteMc = db.prepare('DELETE FROM minecraft_servers WHERE id = ?');

export function listRuntimeConfig() {
  try {
    return Object.fromEntries(stmtListConfig.all().map((row) => [row.key, row.value]));
  } catch (err) {
    logError('RuntimeConfigStore.listRuntimeConfig', err);
    return {};
  }
}

export function getRuntimeConfigValue(key) {
  try {
    return stmtGetConfig.get(key)?.value ?? null;
  } catch (err) {
    logError('RuntimeConfigStore.getRuntimeConfigValue', err);
    return null;
  }
}

export function seedRuntimeConfig(entries) {
  const transaction = db.transaction(() => {
    const now = Date.now();
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined || value === null || value === '') continue;
      stmtInsertConfigIgnore.run(key, String(value), now);
    }
  });
  try {
    transaction();
  } catch (err) {
    logError('RuntimeConfigStore.seedRuntimeConfig', err);
  }
}

export function setRuntimeConfigValue(key, value) {
  try {
    stmtUpsertConfig.run(key, String(value), Date.now());
  } catch (err) {
    logError('RuntimeConfigStore.setRuntimeConfigValue', err);
    throw err;
  }
}

export function deleteRuntimeConfigValue(key) {
  try {
    stmtDeleteConfig.run(key);
  } catch (err) {
    logError('RuntimeConfigStore.deleteRuntimeConfigValue', err);
    throw err;
  }
}

export function listMinecraftServers() {
  try {
    return stmtListMc.all();
  } catch (err) {
    logError('RuntimeConfigStore.listMinecraftServers', err);
    return [];
  }
}

export function getMinecraftServer(id) {
  try {
    return stmtGetMc.get(id) ?? null;
  } catch (err) {
    logError('RuntimeConfigStore.getMinecraftServer', err);
    return null;
  }
}

export function saveMinecraftServer({ id, name, host, port }) {
  try {
    stmtInsertMc.run({ id, name, host, port, now: Date.now() });
  } catch (err) {
    logError('RuntimeConfigStore.saveMinecraftServer', err);
    throw err;
  }
}

export function deleteMinecraftServer(id) {
  try {
    stmtDeleteMc.run(id);
  } catch (err) {
    logError('RuntimeConfigStore.deleteMinecraftServer', err);
    throw err;
  }
}
