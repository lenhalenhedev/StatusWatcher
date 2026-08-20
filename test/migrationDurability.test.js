import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);
const validEnv = {
  TOKEN: 'token',
  CLIENT_ID: '123456789012345678',
  GUILD_ID: '123456789012345678',
  ADMIN_USER_ID: '123456789012345678',
};

function makeDbPath(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `statuswatcher-${label}-`));
  return {
    directory,
    dbPath: path.join(directory, 'uptime.db'),
  };
}

function runDbProbe(dbPath, script) {
  return JSON.parse(execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd,
      env: { ...process.env, ...validEnv, DB_PATH: dbPath },
      encoding: 'utf8',
    },
  ));
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test('fresh bootstrap creates every required table, column, index, and foreign-key policy', () => {
  const { directory, dbPath } = makeDbPath('migration-fresh');
  try {
    const snapshot = runDbProbe(dbPath, `
      import db from './src/utils/db.js';
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
      const latencyColumns = db.prepare('PRAGMA table_info(latency_samples)').all().map((row) => row.name);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
      const foreignKeys = db.pragma('foreign_keys');
      process.stdout.write(JSON.stringify({ tables, latencyColumns, indexes, foreignKeys }));
    `);

    assert.deepEqual(snapshot.tables, [
      'config_audit_log',
      'downtime_sessions',
      'incident_events',
      'incidents',
      'latency_samples',
      'maintenance_windows',
      'mutes',
      'service_dependencies',
      'service_ownership',
      'slos',
      'subscriptions',
      'targets',
      'tls_certificate_snapshots',
    ]);
    assert.deepEqual(snapshot.latencyColumns, [
      'id',
      'service_id',
      'service_type',
      'observed_at',
      'duration_ms',
      'success',
      'status_code',
      'probe_status',
      'error_category',
      'retry_index',
    ]);
    assert.ok(snapshot.indexes.includes('idx_latency_service_time'));
    assert.ok(snapshot.indexes.includes('idx_incident_events_incident'));
    assert.ok(snapshot.indexes.includes('idx_maintenance_service_window'));
    assert.equal(snapshot.foreignKeys[0].foreign_keys, 1);
  } finally {
    cleanup(directory);
  }
});

test('legacy latency schema migrates without losing rows and applies safe defaults', () => {
  const { directory, dbPath } = makeDbPath('migration-legacy');
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE latency_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      service_type TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      status_code INTEGER
    );
    INSERT INTO latency_samples (service_id, service_type, observed_at, duration_ms, success, status_code)
    VALUES ('website:legacy', 'website', 1000, 250, 0, 503);
  `);
  legacy.close();

  try {
    const snapshot = runDbProbe(dbPath, `
      import db from './src/utils/db.js';
      const columns = db.prepare('PRAGMA table_info(latency_samples)').all();
      const row = db.prepare('SELECT service_id, duration_ms, success, status_code, probe_status, error_category, retry_index FROM latency_samples').get();
      const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'incidents'").all();
      process.stdout.write(JSON.stringify({ columns: columns.map((column) => column.name), row, tableNames }));
    `);

    assert.deepEqual(snapshot.columns, [
      'id',
      'service_id',
      'service_type',
      'observed_at',
      'duration_ms',
      'success',
      'status_code',
      'probe_status',
      'error_category',
      'retry_index',
    ]);
    assert.deepEqual(snapshot.row, {
      service_id: 'website:legacy',
      duration_ms: 250,
      success: 0,
      status_code: 503,
      probe_status: 'ONLINE',
      error_category: null,
      retry_index: 0,
    });
    assert.deepEqual(snapshot.tableNames, [{ name: 'incidents' }]);
  } finally {
    cleanup(directory);
  }
});

test('reopening a migrated database is idempotent and does not duplicate columns or rows', () => {
  const { directory, dbPath } = makeDbPath('migration-repeat');
  try {
    const first = runDbProbe(dbPath, `
      import db from './src/utils/db.js';
      db.prepare("INSERT INTO latency_samples (service_id, service_type, observed_at, duration_ms, success, probe_status, retry_index) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run('website:repeat', 'website', 2000, 10, 1, 'PENDING', 1);
      process.stdout.write(JSON.stringify({ count: db.prepare('SELECT COUNT(*) AS count FROM latency_samples').get().count }));
    `);
    const second = runDbProbe(dbPath, `
      import db from './src/utils/db.js';
      const columns = db.prepare('PRAGMA table_info(latency_samples)').all().map((column) => column.name);
      const row = db.prepare('SELECT service_id, probe_status, retry_index FROM latency_samples').get();
      process.stdout.write(JSON.stringify({ count: db.prepare('SELECT COUNT(*) AS count FROM latency_samples').get().count, columns, row }));
    `);

    assert.deepEqual(first, { count: 1 });
    assert.equal(second.count, 1);
    assert.equal(new Set(second.columns).size, second.columns.length);
    assert.deepEqual(second.row, { service_id: 'website:repeat', probe_status: 'PENDING', retry_index: 1 });
  } finally {
    cleanup(directory);
  }
});

test('partially migrated latency schemas receive only missing metadata columns', () => {
  const { directory, dbPath } = makeDbPath('migration-partial');
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE latency_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      service_type TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      status_code INTEGER,
      probe_status TEXT NOT NULL DEFAULT 'PENDING'
    );
    INSERT INTO latency_samples (service_id, service_type, observed_at, duration_ms, success, probe_status)
    VALUES ('website:partial', 'website', 3000, 20, 1, 'ONLINE');
  `);
  legacy.close();

  try {
    const snapshot = runDbProbe(dbPath, `
      import db from './src/utils/db.js';
      const columns = db.prepare('PRAGMA table_info(latency_samples)').all().map((column) => column.name);
      const row = db.prepare('SELECT probe_status, error_category, retry_index FROM latency_samples').get();
      process.stdout.write(JSON.stringify({ columns, row }));
    `);
    assert.equal(snapshot.columns.filter((name) => name === 'probe_status').length, 1);
    assert.equal(snapshot.columns.filter((name) => name === 'error_category').length, 1);
    assert.equal(snapshot.columns.filter((name) => name === 'retry_index').length, 1);
    assert.deepEqual(snapshot.row, { probe_status: 'ONLINE', error_category: null, retry_index: 0 });
  } finally {
    cleanup(directory);
  }
});

test('migrated schema supports prepared evidence writes and preserves foreign-key cascades', () => {
  const { directory, dbPath } = makeDbPath('migration-write');
  try {
    const snapshot = runDbProbe(dbPath, `
      import db from './src/utils/db.js';
      import { appendLatencySample } from './src/store/latencyStore.js';
      db.prepare("INSERT INTO targets (id, name, type, created_at, updated_at) VALUES ('target-1', 'Target', 'website', 1, 1)").run();
      db.prepare("INSERT INTO incidents (incident_key, service_id, service_type, name, opened_at, updated_at) VALUES ('website:target-1', 'target-1', 'website', 'Target', 1, 1)").run();
      const incident = db.prepare('SELECT id FROM incidents WHERE incident_key = ?').get('website:target-1');
      db.prepare("INSERT INTO incident_events (incident_id, incident_key, event_type, occurred_at, service_type, service_id) VALUES (?, ?, 'DETECTED', 1, 'website', 'target-1')").run(incident.id, 'website:target-1');
      appendLatencySample({ serviceId: 'target-1', serviceType: 'website', observedAt: 10, durationMs: 15, success: false, statusCode: 503, probeStatus: 'DOWN', errorCategory: 'HTTP_STATUS_FAILURE', retryIndex: 2 });
      const sample = db.prepare('SELECT service_id, probe_status, error_category, retry_index FROM latency_samples').get();
      db.prepare("DELETE FROM targets WHERE id = 'target-1'").run();
      const eventsBeforeIncidentDelete = db.prepare('SELECT COUNT(*) AS count FROM incident_events').get().count;
      db.prepare("DELETE FROM incidents WHERE incident_key = 'website:target-1'").run();
      const events = db.prepare('SELECT COUNT(*) AS count FROM incident_events').get().count;
      process.stdout.write(JSON.stringify({ sample, eventsBeforeIncidentDelete, events }));
    `);
    assert.deepEqual(snapshot.sample, {
      service_id: 'target-1',
      probe_status: 'DOWN',
      error_category: 'HTTP_STATUS_FAILURE',
      retry_index: 2,
    });
    assert.equal(snapshot.eventsBeforeIncidentDelete, 1);
    assert.equal(snapshot.events, 0);
  } finally {
    cleanup(directory);
  }
});

// This intentionally documents the unsupported-schema boundary: a table with
// incompatible required columns must fail closed rather than silently mutate.
test('incompatible latency schema fails closed instead of silently losing data', () => {
  const { directory, dbPath } = makeDbPath('migration-incompatible');
  const legacy = new Database(dbPath);
  legacy.exec('CREATE TABLE latency_samples (id TEXT PRIMARY KEY, payload TEXT NOT NULL);');
  legacy.close();
  try {
    assert.throws(
      () => runDbProbe(dbPath, `
        import './src/utils/db.js';
        process.stdout.write(JSON.stringify({ booted: true }));
      `),
      /no such column|NOT NULL constraint failed|table latency_samples/i,
    );
  } finally {
    cleanup(directory);
  }
});
