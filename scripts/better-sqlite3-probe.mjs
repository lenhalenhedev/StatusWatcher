import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-better-sqlite3-'));
const databasePath = path.join(directory, 'probe.db');
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
const insert = db.prepare('INSERT INTO probe (value) VALUES (?)');
const read = db.prepare('SELECT value FROM probe WHERE id = ?');
const transaction = db.transaction((values) => {
  for (const value of values) insert.run(value);
});
transaction(['node24', 'native-addon']);
const result = read.get(2);
console.log(JSON.stringify({
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  betterSqlite3: (await import('better-sqlite3/package.json', { with: { type: 'json' } })).default.version,
  result,
}));
db.close();
