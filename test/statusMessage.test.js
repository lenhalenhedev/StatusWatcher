import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageFlags } from 'discord.js';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-')), 'uptime.db');
const testIds = {
  CLIENT_ID: '12345678901234567',
  GUILD_ID: '12345678901234568',
  MONITOR_CHANNEL_ID: '12345678901234569',
  LOG_CHANNEL_ID: '12345678901234570',
  IMPORTANT_ROLE_ID: '12345678901234571',
  ADMIN_USER_ID: '12345678901234572',
};
process.env.TOKEN ??= 'test-token';
for (const [key, value] of Object.entries(testIds)) process.env[key] ??= value;
process.env.MC_SERVER_IP ??= '127.0.0.1';
process.env.MC_SERVER_PORT = '25565';
process.env.MC_SERVER_NAME ??= 'Test Minecraft';
process.env.CHECK_INTERVAL = '30';

const {
  updateStatusComponent,
  getStatusMessagePayload,
  refreshStatusMessage,
} = await import('../src/services/statusMessage.js');

function interaction(customId) {
  return {
    customId,
    replyPayload: null,
    updatePayload: null,
    async reply(payload) { this.replyPayload = payload; },
    async update(payload) { this.updatePayload = payload; },
  };
}

const mcState = { isConfirmedDown: false, lastPingData: null };

test('builds a status payload for the one-shot status command', () => {
  const payload = getStatusMessagePayload(new Map(), mcState);

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.embeds[0].data.title, '📊 System Status Monitor');
});

test('recovers the refresh queue after a failed operation', async () => {
  let fetchCalls = 0;
  const message = { id: 'status-message', async edit() {} };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async () => { throw new Error('missing tracked message'); } },
    async send() { return message; },
  };
  const client = {
    channels: {
      fetch: async () => {
        fetchCalls++;
        if (fetchCalls === 1) throw new Error('temporary channel failure');
        return channel;
      },
    },
  };
  const dependencies = {
    channelId: 'monitor-channel',
    getBotStates: () => new Map(),
    getMcState: () => mcState,
  };

  await assert.rejects(refreshStatusMessage(client, dependencies), /temporary channel failure/);
  const result = await refreshStatusMessage(client, dependencies);

  assert.equal(result, message);
  assert.equal(fetchCalls, 2);
});

test('returns the exact ephemeral error for an invalid previous page', async () => {
  const currentInteraction = interaction('status-page:prev:0');
  await updateStatusComponent(currentInteraction, {
    getBotStates: () => new Map(),
    getMcState: () => mcState,
  });

  assert.deepEqual(currentInteraction.replyPayload, {
    content: 'error: No previous page exists',
    flags: MessageFlags.Ephemeral,
  });
});

test('updates the embed and indicator when navigating to a valid next page', async () => {
  const bots = new Map(Array.from({ length: 11 }, (_, index) => [
    `bot-${index}`,
    { name: `Bot ${index}`, isConfirmedDown: false, hasImportantRole: false },
  ]));
  const currentInteraction = interaction('status-page:next:0');

  await updateStatusComponent(currentInteraction, {
    getBotStates: () => bots,
    getMcState: () => mcState,
  });

  assert.equal(currentInteraction.updatePayload.components[0].components[1].data.label, '2/2');
  assert.equal(currentInteraction.replyPayload, null);
});
