import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMcStatus } from '../src/services/mcStatusClient.js';

const BASE = { ip: '1.2.3.4', port: 25565, baseDelayMs: 1, maxRetries: 2 };

test('returns online with normalized data', async () => {
  const statusFn = async () => ({
    online: true,
    players: { online: 3, max: 20 },
    version: { name_clean: 'Paper 1.20.4' },
  });
  const result = await fetchMcStatus({ ...BASE, statusFn });
  assert.deepEqual(result, {
    ok: true,
    online: true,
    data: { players: 3, maxPlayers: 20, version: 'Paper 1.20.4' },
  });
});

test('returns offline (authoritative) without retrying', async () => {
  let calls = 0;
  const statusFn = async () => { calls++; return { online: false }; };
  const result = await fetchMcStatus({ ...BASE, statusFn });
  assert.deepEqual(result, { ok: true, online: false });
  assert.equal(calls, 1);
});

test('retries on service error then succeeds', async () => {
  let calls = 0;
  const statusFn = async () => {
    calls++;
    if (calls < 3) throw new Error('network down');
    return { online: true, players: { online: 0, max: 10 }, version: { name_clean: 'Spigot' } };
  };
  const result = await fetchMcStatus({ ...BASE, statusFn });
  assert.equal(result.ok, true);
  assert.equal(result.online, true);
  assert.equal(calls, 3);
});

test('reports service failure (not server down) after exhausting retries', async () => {
  let calls = 0;
  const statusFn = async () => { calls++; throw new Error('timeout'); };
  const result = await fetchMcStatus({ ...BASE, maxRetries: 2, statusFn });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
  assert.equal(calls, 3); // initial + 2 retries
});

test('bounds a hanging status provider and classifies it as a service failure', async () => {
  let calls = 0;
  const result = await fetchMcStatus({
    ...BASE,
    maxRetries: 1,
    baseDelayMs: 1,
    timeoutMs: 5,
    statusFn: () => {
      calls++;
      return new Promise(() => {});
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/i);
  assert.equal(calls, 2);
});

test('fills sensible defaults for missing player/version fields', async () => {
  const statusFn = async () => ({ online: true });
  const result = await fetchMcStatus({ ...BASE, statusFn });
  assert.deepEqual(result.data, { players: 0, maxPlayers: 0, version: 'Unknown' });
});
