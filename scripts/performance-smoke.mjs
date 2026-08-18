import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-perf-')), 'uptime.db');
process.env.DB_PATH = dbPath;
for (const key of [
  'TOKEN', 'CLIENT_ID', 'GUILD_ID', 'MONITOR_CHANNEL_ID', 'LOG_CHANNEL_ID',
  'MC_SERVER_IP', 'MC_SERVER_PORT', 'MC_SERVER_NAME', 'IMPORTANT_ROLE_ID',
  'ADMIN_USER_ID', 'CHECK_INTERVAL',
]) process.env[key] ??= 'test-value';
process.env.MC_SERVER_PORT = '25565';
process.env.CHECK_INTERVAL = '30000';

const { default: db, closeDatabase } = await import('../src/utils/db.js');
const upsert = db.prepare(`
  INSERT INTO targets (id, name, type, has_important_role, created_at, updated_at)
  VALUES (@id, @name, @type, @hasImportantRole, @createdAt, @now)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
`);
const read = db.prepare('SELECT * FROM targets WHERE id = ?');

const start = performance.now();
for (let index = 0; index < 10_000; index += 1) {
  upsert.run({
    id: `perf-${index}`,
    name: `Performance ${index}`,
    type: 'bot',
    hasImportantRole: 0,
    createdAt: Date.now(),
    now: Date.now(),
  });
}
const writeMs = performance.now() - start;

const readStart = performance.now();
for (let index = 0; index < 10_000; index += 1) read.get(`perf-${index}`);
const readMs = performance.now() - readStart;

console.log(JSON.stringify({ rows: 10_000, writeMs: Number(writeMs.toFixed(2)), readMs: Number(readMs.toFixed(2)) }));
closeDatabase();
