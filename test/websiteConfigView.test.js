import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-config-view-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const { CONFIG_ITEMS, buildConfigEmbed, buildRemoveWebsiteComponents } = await import('../src/commands/configView.js');

function buttonLabels(view) {
  return view.components.flatMap((row) => row.components ?? []).map((component) => component.data?.label);
}

test('places website controls before database controls and removes Minecraft retry controls', () => {
  const ids = CONFIG_ITEMS.map((item) => item.id);
  assert.ok(ids.indexOf('add_website') < ids.indexOf('add_database'));
  assert.ok(ids.indexOf('remove_website') < ids.indexOf('remove_database'));
  assert.equal(ids.includes('mcRetryBaseMs'), false);
  assert.equal(ids.includes('mcMaxRetries'), false);

  const labels = buttonLabels(buildConfigEmbed(0));
  assert.ok(labels.includes('Add Website'));
  assert.ok(labels.includes('Remove Website'));
});

test('builds a bounded website removal selector with pagination controls', () => {
  const targets = Array.from({ length: 26 }, (_, index) => ({
    id: `website_${index}`,
    name: `Website ${index}`,
    url: `https://example.com/${index}?secret=hidden`,
  }));
  const rows = buildRemoveWebsiteComponents(targets, 0);
  const serialized = rows.flatMap((row) => row.components ?? []).map((component) => component.toJSON());
  const select = serialized.find((component) => component.type === 3);
  assert.ok(select);
  assert.equal(select.options.length, 25);
  assert.ok(select.options[0].description.includes('https://example.com/0'));
  assert.equal(select.options[0].description.includes('secret=hidden'), false);
  assert.ok(serialized.some((component) => component.label === 'NEXT'));
});
