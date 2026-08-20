import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-service-dropdown-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const {
  CONFIG_ITEMS,
  buildConfigEmbed,
  buildServiceTypeComponents,
  buildRuntimeConfigComponents,
} = await import('../src/commands/configView.js');

function serializedComponents(rows) {
  return rows.flatMap((row) => row.components ?? []).map((component) => component.toJSON());
}

test('renders only grouped service and config controls at the top level', () => {
  assert.deepEqual(CONFIG_ITEMS.map((item) => item.id), ['add_service', 'remove_service', 'config']);
  const labels = buildConfigEmbed(0).components
    .flatMap((row) => row.components ?? [])
    .map((component) => component.data?.label);
  assert.deepEqual(labels, ['Add Service', 'Remove Service', 'Config']);
});

test('builds the Add Service dropdown with exactly the three supported services', () => {
  const components = serializedComponents(buildServiceTypeComponents('add_service'));
  assert.equal(components.length, 2);
  assert.equal(components[0].type, 3);
  assert.equal(components[0].custom_id, 'config:add_service:select');
  assert.deepEqual(components[0].options.map((option) => option.value), ['mc', 'website', 'database']);
  assert.deepEqual(components[0].options.map((option) => option.label), ['MC', 'Website', 'Database']);
});

test('builds the Remove Service dropdown with exactly the three supported services', () => {
  const components = serializedComponents(buildServiceTypeComponents('remove_service'));
  assert.equal(components[0].custom_id, 'config:remove_service:select');
  assert.deepEqual(components[0].options.map((option) => option.value), ['mc', 'website', 'database']);
});

test('builds the Config dropdown from the nine runtime schema definitions', () => {
  const components = serializedComponents(buildRuntimeConfigComponents());
  assert.equal(components[0].custom_id, 'config:runtime:select');
  assert.deepEqual(components[0].options.map((option) => option.value), [
    'importantRoleId',
    'monitorChannelId',
    'logChannelId',
    'checkIntervalSec',
    'confirmDownThresholdSec',
    'checkIntervalDisplayLogSec',
    'stillDownBackoffSec',
    'mcStatusTimeoutMs',
    'dailyDigestCron',
  ]);
});
