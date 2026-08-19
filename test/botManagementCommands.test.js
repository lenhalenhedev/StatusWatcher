import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageFlags } from 'discord.js';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-bot-management-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '12345678901234567';
process.env.GUILD_ID ??= '12345678901234568';
process.env.MONITOR_CHANNEL_ID ??= '12345678901234569';
process.env.LOG_CHANNEL_ID ??= '12345678901234570';
process.env.MC_SERVER_IP ??= '127.0.0.1';
process.env.MC_SERVER_PORT ??= '25565';
process.env.MC_SERVER_NAME ??= 'Test Minecraft';
process.env.IMPORTANT_ROLE_ID ??= '12345678901234571';
process.env.ADMIN_USER_ID ??= '12345678901234572';
process.env.CHECK_INTERVAL ??= '30';

const db = (await import('../src/utils/db.js')).default;
const tracker = await import('../src/utils/uptimeTracker.js');
const botMonitor = await import('../src/monitors/botMonitor.js');
const fetchService = await import('../src/services/botFetchService.js');
const commandIndex = await import('../src/commands/index.js');
const fetchBot = await import('../src/commands/fetchBot.js');

function resetDatabase() {
  db.exec('DELETE FROM downtime_sessions; DELETE FROM targets; DELETE FROM mutes; DELETE FROM subscriptions;');
  botMonitor.getBotStates().clear();
}

function makeMember(id, { name = `Bot-${id}`, important = false, status = 'online' } = {}) {
  const member = {
    id,
    user: { id, bot: true, username: name, globalName: name },
    presence: { status },
    roles: { cache: { has: roleId => important && roleId === process.env.IMPORTANT_ROLE_ID } },
  };
  member.guild = { client: { user: { id: process.env.CLIENT_ID } } };
  return member;
}

function makeGuild(membersById = new Map()) {
  return {
    id: process.env.GUILD_ID,
    client: { user: { id: process.env.CLIENT_ID } },
    members: {
      cache: { get: id => membersById.get(id) },
      async fetch(id) {
        if (id === undefined) throw new Error('startup must not perform a full member fetch');
        const member = membersById.get(id);
        if (!member) throw new Error('member not found');
        return member;
      },
    },
  };
}

test('startup restores active SQLite bots and removes bots absent from the guild', async () => {
  resetDatabase();
  const presentId = '20000000000000001';
  const missingId = '20000000000000002';
  tracker.registerTarget(presentId, 'Present Bot', { type: 'bot', hasImportantRole: true });
  tracker.registerTarget(missingId, 'Missing Bot', { type: 'bot', hasImportantRole: false });

  const present = makeMember(presentId, { name: 'Present Bot', important: true });
  await botMonitor.initBotMonitor(makeGuild(new Map([[presentId, present]])));

  assert.equal(botMonitor.getBotStates().has(presentId), true);
  assert.equal(botMonitor.getBotStates().has(missingId), false);
  assert.equal(tracker.getTarget(presentId)?.status, 'active');
  assert.equal(tracker.getTarget(missingId), null);
});

test('guild member events add and physically remove bot targets', () => {
  resetDatabase();
  const id = '20000000000000003';
  const member = makeMember(id, { important: true });

  botMonitor.handleMemberAdd(member);
  assert.equal(botMonitor.getBotStates().has(id), true);
  assert.equal(tracker.getTarget(id)?.has_important_role, 1);

  botMonitor.handleMemberRemove({ id });
  assert.equal(botMonitor.getBotStates().has(id), false);
  assert.equal(tracker.getTarget(id), null);
});

test('periodic bot checks use runtime state and never full-fetch guild members', async () => {
  resetDatabase();
  const id = '20000000000000004';
  botMonitor.handleMemberAdd(makeMember(id));

  const guild = makeGuild(new Map());
  const events = await botMonitor.checkBotStatuses(guild, true);

  assert.deepEqual(events, []);
});

test('/fetch-bot processes bot records in batches of ten and reports cumulative progress', async () => {
  resetDatabase();
  const staleId = '29999999999999999';
  tracker.registerTarget(staleId, 'Stale Bot', { type: 'bot' });
  botMonitor.hydrateBotState(makeMember(staleId));

  const rawBots = Array.from({ length: 11 }, (_, index) => ({
    user: {
      id: `200000000000000${10 + index}`,
      bot: true,
      username: `Fetched-${index}`,
    },
    roles: index === 0 ? [process.env.IMPORTANT_ROLE_ID] : [],
  }));
  const pages = [rawBots, []];
  const sleeps = [];
  const progress = [];
  const guild = {
    id: process.env.GUILD_ID,
    client: { user: { id: process.env.CLIENT_ID } },
    members: {
      cache: { get: () => undefined },
      async list() {
        return pages.shift();
      },
    },
  };

  const result = await fetchService.fetchBotsInBatches(guild, {
    sleep: async ms => sleeps.push(ms),
    onProgress: count => progress.push(count),
  });

  assert.equal(result.fetchedBots, 11);
  assert.deepEqual(progress, [10, 11]);
  assert.deepEqual(sleeps, [10_000]);
  assert.equal(botMonitor.getBotStates().size, 11);
  assert.equal(tracker.listTargets({ activeOnly: true }).length, 11);
  assert.equal(botMonitor.getBotStates().has(staleId), false);
  assert.equal(tracker.getTarget(staleId), null);
});

test('/fetch-bot is admin-only and is registered while legacy commands are absent', async () => {
  assert.equal(commandIndex.commandMap.has('add-bot'), false);
  assert.equal(commandIndex.commandMap.has('remove-bot'), false);
  assert.equal(commandIndex.commandMap.has('fetch-bot'), true);
  assert.equal(fetchBot.data.name, 'fetch-bot');

  const interaction = {
    user: { id: 'not-admin' },
    async reply(payload) { this.response = payload; },
  };
  await fetchBot.execute(interaction);
  assert.equal(interaction.response.flags, MessageFlags.Ephemeral);
});
