import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const adminId = process.env.ADMIN_USER_ID || '123456789012345678';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-command-dropdown-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= adminId;
process.env.GUILD_ID ??= adminId;
process.env.ADMIN_USER_ID = adminId;

const { handleInteraction } = await import('../src/commands/configCommand.js');

function selectInteraction(customId, values, userId = adminId) {
  return {
    customId,
    values,
    user: { id: userId },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    async showModal(modal) { this.modal = modal.toJSON(); },
    async update(payload) { this.updatePayload = payload; },
    async reply(payload) { this.replyPayload = payload; },
    async editReply(payload) { this.editPayload = payload; },
  };
}

test('routes each Add Service option to its existing modal', async () => {
  for (const [service, modalId] of [
    ['mc', 'config:modal:add_mc'],
    ['website', 'config:modal:add_website'],
    ['database', 'config:modal:add_database'],
  ]) {
    const interaction = selectInteraction('config:add_service:select', [service]);
    await handleInteraction(interaction);
    assert.equal(interaction.modal.custom_id, modalId);
  }
});

test('routes each Remove Service option to a bounded existing selector or safe empty state', async () => {
  for (const service of ['mc', 'website', 'database']) {
    const interaction = selectInteraction('config:remove_service:select', [service]);
    await handleInteraction(interaction);
    assert.ok(Array.isArray(interaction.updatePayload.components));
    assert.match(interaction.updatePayload.content, /configured|remove/i);
  }
});

test('routes every runtime Config option to its validated scalar modal', async () => {
  const keys = [
    'importantRoleId',
    'monitorChannelId',
    'logChannelId',
    'checkIntervalSec',
    'confirmDownThresholdSec',
    'checkIntervalDisplayLogSec',
    'stillDownBackoffSec',
    'mcStatusTimeoutMs',
    'dailyDigestCron',
  ];
  for (const key of keys) {
    const interaction = selectInteraction('config:runtime:select', [key]);
    await handleInteraction(interaction);
    assert.equal(interaction.modal.custom_id, `config:modal:${key}`);
  }
});

test('rejects grouped configuration interactions from non-admin users', async () => {
  const interaction = selectInteraction('config:add_service:select', ['mc'], '999999999999999999');
  await handleInteraction(interaction);
  assert.equal(interaction.replyPayload.content, 'Only the configured admin can use /config.');
});

test('rejects unknown service and runtime values without invoking a modal', async () => {
  const addInteraction = selectInteraction('config:add_service:select', ['unknown']);
  await handleInteraction(addInteraction);
  assert.equal(addInteraction.modal, undefined);
  assert.match(addInteraction.updatePayload.content, /Unsupported service type/);

  const configInteraction = selectInteraction('config:runtime:select', ['unknown']);
  await handleInteraction(configInteraction);
  assert.equal(configInteraction.modal, undefined);
  assert.match(configInteraction.updatePayload.content, /Unsupported runtime setting/);
});
