import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-'));
process.env.DB_PATH = path.join(tempDir, 'uptime.db');

const {
  clearTrackedMessageId,
  getTrackedMessageId,
  saveTrackedMessageId,
} = await import('../src/store/monitorMessageStore.js');

test('stores and replaces the canonical monitor message ID per channel', () => {
  const channelId = 'channel-1';
  clearTrackedMessageId(channelId);
  assert.equal(getTrackedMessageId(channelId), null);

  saveTrackedMessageId(channelId, 'message-1', 100);
  assert.equal(getTrackedMessageId(channelId), 'message-1');

  saveTrackedMessageId(channelId, 'message-2', 200);
  assert.equal(getTrackedMessageId(channelId), 'message-2');

  clearTrackedMessageId(channelId);
  assert.equal(getTrackedMessageId(channelId), null);
});
