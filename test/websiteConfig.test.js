import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-website-config-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const { default: config, reloadRuntimeConfig } = await import('../src/config.js');
const {
  deleteWebsiteTarget,
  listWebsiteTargets,
  saveWebsiteTarget,
} = await import('../src/store/runtimeConfigStore.js');
const { RUNTIME_CONFIG_DEFINITIONS, parseRuntimeConfigValue } = await import('../src/config/runtimeConfigSchema.js');

test('stores and lists website targets with stable metadata', () => {
  saveWebsiteTarget({ id: 'website_test', name: 'Example Health', url: 'https://example.com/health' });
  const entries = listWebsiteTargets();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'website_test');
  assert.equal(entries[0].name, 'Example Health');
  assert.equal(entries[0].url, 'https://example.com/health');
  assert.equal(typeof entries[0].created_at, 'number');
  assert.equal(typeof entries[0].updated_at, 'number');
});

test('reloads website targets into the runtime snapshot', () => {
  reloadRuntimeConfig();
  assert.equal(config.websiteEnabled, true);
  assert.equal(config.websiteTargets.length, 1);
  assert.equal(config.websiteTargets[0].url, 'https://example.com/health');
});

test('removes website target and clears runtime state after reload', () => {
  deleteWebsiteTarget('website_test');
  reloadRuntimeConfig();
  assert.equal(config.websiteEnabled, false);
  assert.deepEqual(config.websiteTargets, []);
});

test('does not expose obsolete Minecraft retry settings in runtime config schema', () => {
  assert.equal(Object.hasOwn(RUNTIME_CONFIG_DEFINITIONS, 'mcRetryBaseMs'), false);
  assert.equal(Object.hasOwn(RUNTIME_CONFIG_DEFINITIONS, 'mcMaxRetries'), false);
  assert.throws(() => parseRuntimeConfigValue('mcRetryBaseMs', '500'), /Unknown runtime config key/);
  assert.throws(() => parseRuntimeConfigValue('mcMaxRetries', '3'), /Unknown runtime config key/);
});
