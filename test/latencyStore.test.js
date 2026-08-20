import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);

function run(script) {
  const env = {
    ...process.env,
    TOKEN: 'test-token',
    CLIENT_ID: '123456789012345678',
    GUILD_ID: '123456789012345678',
    ADMIN_USER_ID: '123456789012345678',
    DB_PATH: path.join('/tmp', `statuswatcher-latency-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  }));
}

test('persists bounded latency samples and filters them by UTC window', () => {
  const result = run(`
    import { appendLatencySample, listLatencySamples, pruneLatencySamples } from './src/store/latencyStore.js';
    const invalidType = appendLatencySample({ serviceId: 'website_1', serviceType: 'unknown', observedAt: 1000, durationMs: 20, success: true });
    const invalidDuration = appendLatencySample({ serviceId: 'website_1', serviceType: 'website', observedAt: 1000, durationMs: -1, success: true });
    const first = appendLatencySample({ serviceId: 'website_1', serviceType: 'website', observedAt: 1000, durationMs: 20, success: true, statusCode: 200 });
    const second = appendLatencySample({ serviceId: 'website_1', serviceType: 'website', observedAt: 2000, durationMs: 40, success: false, statusCode: 503 });
    appendLatencySample({ serviceId: 'website_2', serviceType: 'website', observedAt: 2000, durationMs: 60, success: true, statusCode: 200 });
    process.stdout.write(JSON.stringify({
      invalidType,
      invalidDuration,
      ids: [first.id, second.id],
      window: listLatencySamples({ serviceId: 'website_1', serviceType: 'website', startAt: 1000, endAt: 2000 }).map(({ duration_ms, success, status_code }) => ({ duration_ms, success, status_code })),
      pruned: pruneLatencySamples({ before: 1500 }),
      remaining: listLatencySamples({ serviceId: 'website_1', serviceType: 'website' }).map(({ duration_ms }) => duration_ms),
    }));
  `);

  assert.equal(result.invalidType, null);
  assert.equal(result.invalidDuration, null);
  assert.deepEqual(result.ids, [1, 2]);
  assert.deepEqual(result.window, [{ duration_ms: 20, success: 1, status_code: 200 }]);
  assert.equal(result.pruned, 1);
  assert.deepEqual(result.remaining, [40]);
});
