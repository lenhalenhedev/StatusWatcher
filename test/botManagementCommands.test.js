import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const addBot = await import('../src/commands/addBot.js');
const removeBot = await import('../src/commands/removeBot.js');
const botMonitor = await import('../src/monitors/botMonitor.js');

const adminId = process.env.ADMIN_USER_ID;
const addedId = '12345678901234573';
const nonBotId = '12345678901234574';
const missingId = '12345678901234575';
const guildBot = {
  id: addedId,
  user: { bot: true, username: 'Dyno', globalName: 'Dyno' },
  displayName: 'Dyno',
  roles: { cache: { has: () => false } },
};
guildBot.guild = { client: { user: { id: '12345678901234576' } } };

function commandInteraction(value, members) {
  return {
    user: { id: adminId },
    guild: { members },
    options: { getString: () => value },
    response: null,
    async reply(payload) { this.response = payload; },
  };
}

test('add-bot validates each comma-separated target and reports outcomes', async () => {
  const members = {
    async fetch(id) {
      if (id === addedId) return guildBot;
      if (id === nonBotId) return { id, user: { bot: false, username: 'Human' }, displayName: 'Human' };
      throw new Error('unknown member');
    },
  };
  const interaction = commandInteraction(
    `${addedId},${nonBotId},${missingId},bad-id,<@!${addedId}>`,
    members,
  );

  await addBot.execute(interaction);

  assert.match(interaction.response.content, /Added:.*Dyno/);
  assert.match(interaction.response.content, /Not Discord bots/);
  assert.match(interaction.response.content, /Not found in this guild/);
  assert.match(interaction.response.content, /Invalid IDs/);
  assert.match(interaction.response.content, /Duplicate input/);
  assert.equal(interaction.response.ephemeral, true);
});

test('remove-bot archives selected targets and edits the original response', async () => {
  const interaction = {
    customId: `remove-bot:${adminId}:0`,
    user: { id: adminId },
    values: [addedId],
    isStringSelectMenu: () => true,
    response: null,
    async update(payload) { this.response = payload; },
  };

  await removeBot.handleInteraction(interaction);

  assert.match(interaction.response.content, /Removed \*\*Dyno\*\*/);
  assert.deepEqual(interaction.response.components, []);
  assert.equal(botMonitor.addBotToMonitor(guildBot), false);
});

test('remove-bot menu exposes stable IDs and supports all tracked options up to Discord’s limit', () => {
  const targets = Array.from({ length: 25 }, (_, index) => ({
    id: String(12345678901234000 + index),
    name: `Bot ${index}`,
  }));
  const row = removeBot.buildRemoveBotMenu(targets, adminId).toJSON();
  const menu = row.components[0];

  assert.equal(menu.type, 3);
  assert.equal(menu.options.length, 25);
  assert.equal(menu.min_values, 1);
  assert.equal(menu.max_values, 25);
  assert.equal(menu.options[0].value, targets[0].id);
});

test('remove-bot paginates registries larger than Discord’s 25-option limit', () => {
  const targets = Array.from({ length: 26 }, (_, index) => ({
    id: String(12345678901234000 + index),
    name: `Bot ${index}`,
  }));
  const firstPage = removeBot.buildRemoveBotComponents(targets, adminId, 0).map((row) => row.toJSON());
  const secondPage = removeBot.buildRemoveBotComponents(targets, adminId, 1).map((row) => row.toJSON());

  assert.equal(firstPage[0].components[0].options.length, 25);
  assert.equal(firstPage[1].components[0].disabled, true);
  assert.equal(firstPage[1].components[2].disabled, false);
  assert.equal(secondPage[0].components[0].options.length, 1);
  assert.equal(secondPage[1].components[0].disabled, false);
  assert.equal(secondPage[1].components[2].disabled, true);
});
