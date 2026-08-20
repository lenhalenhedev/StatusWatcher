import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-alert-integration-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';
process.env.LOG_CHANNEL_ID = '123456789012345679';
process.env.CHECK_INTERVAL ??= '30';

const { createCheckRunner } = await import('../src/core/checkCycle.js');
const { createIncidentManager } = await import('../src/incidents/incidentManager.js');
const store = await import('../src/store/incidentStore.js');
const { notifyDownBatch, notifyStillDownBatch } = await import('../src/handlers/notifier.js');
const { buildDownSummaryEmbed, buildStillDownSummaryEmbed } = await import('../src/handlers/embedBuilder.js');

function makeClient(sent) {
  const channel = {
    isTextBased: () => true,
    async send(payload) {
      sent.push(payload);
      return payload;
    },
  };
  return { channels: { async fetch() { return channel; } } };
}

function makeBotEvent(type, state) {
  return {
    type,
    botId: '20000000000000001',
    state,
    downSince: 1_700_000_000_000,
  };
}

function makeRunner({ event, state, manager, sent }) {
  return createCheckRunner({
    client: makeClient(sent),
    getGuild: () => ({ id: process.env.GUILD_ID }),
    getConnected: () => true,
    checkBots: async () => [makeBotEvent(event.type, state)],
    checkMinecraft: async () => [],
    checkWebsites: async () => [],
    checkDatabases: async () => [],
    incident: manager,
    muteCheck: () => false,
    maintenanceCheck: () => false,
    notifyDown: notifyDownBatch,
    notifyStillDown: notifyStillDownBatch,
    notifyUp: async () => undefined,
    now: () => event.occurredAt ?? Date.now(),
  });
}

test('real bot DOWN and STILL_DOWN notifier embeds include the SQLite incident ID', async () => {
  const manager = createIncidentManager({ store, now: () => 1_700_000_000_000 });
  const sent = [];
  const state = {
    name: 'EternalGhost',
    hasImportantRole: true,
    lastStillDownNotifiedAt: null,
    stillDownRemindersSent: 0,
    isConfirmedDown: true,
    confirmedDownAt: 1_700_000_000_000,
  };

  await makeRunner({ event: { type: 'DOWN', occurredAt: 1_700_000_000_000 }, state, manager, sent }).run();
  assert.equal(sent.length, 1);
  const incident = store.listRecentIncidents(1)[0];
  assert.ok(Number.isSafeInteger(incident?.id));
  assert.ok(sent[0].embeds[0].toJSON().fields[0].value.includes(`Incident ID: \`${incident.id}\``));

  await makeRunner({ event: { type: 'STILL_DOWN', occurredAt: 1_700_000_060_000 }, state, manager, sent }).run();
  assert.equal(sent.length, 2);
  assert.ok(sent[1].embeds[0].toJSON().fields[0].value.includes(`Incident ID: \`${incident.id}\``));

  const fallbackItem = { id: '20000000000000001', name: 'EternalGhost', type: 'bot', downSince: 1_700_000_000_000, error: null };
  assert.ok(buildDownSummaryEmbed([fallbackItem]).toJSON().fields[0].value.includes(`Incident ID: \`${incident.id}\``));
  assert.ok(buildStillDownSummaryEmbed([fallbackItem]).toJSON().fields[0].value.includes(`Incident ID: \`${incident.id}\``));
});
