import db from '../utils/db.js';

// The monitor channel has one canonical status message at a time.
db.exec(`
  CREATE TABLE IF NOT EXISTS monitor_messages (
    channel_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export function getTrackedMessageId(channelId) {
  const row = db
    .prepare('SELECT message_id FROM monitor_messages WHERE channel_id = ?')
    .get(channelId);
  return row?.message_id ?? null;
}

export function saveTrackedMessageId(channelId, messageId, updatedAt = Date.now()) {
  db.prepare(`
    INSERT INTO monitor_messages (channel_id, message_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      message_id = excluded.message_id,
      updated_at = excluded.updated_at
  `).run(channelId, messageId, updatedAt);
}

export function clearTrackedMessageId(channelId) {
  db.prepare('DELETE FROM monitor_messages WHERE channel_id = ?').run(channelId);
}
