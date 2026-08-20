import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-website-monitor-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const { default: config } = await import('../src/config.js');
const { saveWebsiteTarget, deleteWebsiteTarget } = await import('../src/store/runtimeConfigStore.js');
const { listLatencySamples } = await import('../src/store/latencyStore.js');
const {
  checkWebsiteTargets,
  getWebsiteStates,
  initWebsiteMonitor,
  removeWebsiteState,
} = await import('../src/monitors/websiteMonitor.js');

saveWebsiteTarget({ id: 'website_monitor_test', name: 'Monitor Test', url: 'https://example.com/health' });
config.websiteTargets = [{ id: 'website_monitor_test', name: 'Monitor Test', url: 'https://example.com/health' }];
config.websiteEnabled = true;
config.confirmDownThresholdMs = 1_000;

 test.after(() => {
  removeWebsiteState('website_monitor_test');
  deleteWebsiteTarget('website_monitor_test');
});

test('initializes website state from configured SQLite targets', () => {
  initWebsiteMonitor();
  const state = getWebsiteStates().get('website_monitor_test');
  assert.equal(state.name, 'Monitor Test');
  assert.equal(state.url, 'https://example.com/health');
  assert.equal(state.isConfirmedDown, false);
});

test('checks each website once per cycle and reports online status code', async () => {
  let calls = 0;
  const results = await checkWebsiteTargets(true, {
    checkWebsiteImpl: async () => {
      calls += 1;
      return { ok: true, status: 204, code: 'HTTP_OK', error: null };
    },
  });

  assert.equal(calls, 1);
  assert.equal(results[0].event.type, 'ONLINE');
  assert.equal(results[0].state.lastStatus, 204);
  assert.equal(results[0].state.lastHealthyAt !== null, true);
});

test('uses the shared confirmation threshold and emits DOWN, STILL_DOWN, then UP', async () => {
  const failing = async () => ({ ok: false, status: 503, code: 'HTTP_ERROR', error: 'HTTP status 503' });
  const first = await checkWebsiteTargets(true, { checkWebsiteImpl: failing });
  assert.equal(first[0].event.type, null);
  let samples = listLatencySamples({ serviceId: 'website_monitor_test', serviceType: 'website' });
  assert.equal(samples.at(-1).probe_status, 'PENDING');
  assert.equal(samples.at(-1).error_category, 'HTTP_STATUS_FAILURE');

  const state = getWebsiteStates().get('website_monitor_test');
  state.firstSeenOffline = Date.now() - 2_000;
  const down = await checkWebsiteTargets(true, { checkWebsiteImpl: failing });
  assert.equal(down[0].event.type, 'DOWN');
  samples = listLatencySamples({ serviceId: 'website_monitor_test', serviceType: 'website' });
  assert.equal(samples.at(-1).probe_status, 'DOWN');
  assert.equal(down[0].event.error, 'HTTP status 503');
  assert.equal(down[0].state.lastStatus, 503);

  const still = await checkWebsiteTargets(true, { checkWebsiteImpl: failing });
  assert.equal(still[0].event.type, 'STILL_DOWN');
  samples = listLatencySamples({ serviceId: 'website_monitor_test', serviceType: 'website' });
  assert.equal(samples.at(-1).probe_status, 'STILL_DOWN');

  const up = await checkWebsiteTargets(true, {
    checkWebsiteImpl: async () => ({ ok: true, status: 200, code: 'HTTP_OK', error: null }),
  });
  assert.equal(up[0].event.type, 'UP');
  assert.equal(up[0].event.downSince !== undefined, true);
  samples = listLatencySamples({ serviceId: 'website_monitor_test', serviceType: 'website' });
  assert.equal(samples.at(-1).probe_status, 'UP');
  assert.equal(samples.at(-1).success, 1);
  assert.equal(up[0].state.isConfirmedDown, false);
});

test('does not probe while the Discord connection is unavailable', async () => {
  let calls = 0;
  const results = await checkWebsiteTargets(false, {
    checkWebsiteImpl: async () => { calls += 1; return { ok: true, status: 200, code: 'HTTP_OK', error: null }; },
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});
