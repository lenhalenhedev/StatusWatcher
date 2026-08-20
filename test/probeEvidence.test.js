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
    DB_PATH: path.join('/tmp', `statuswatcher-probe-evidence-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  }));
}

test('stores bounded probe evidence with safe status, category, and retry metadata', () => {
  const result = run(`
    import { appendLatencySample, listLatencySamples } from './src/store/latencyStore.js';
    const pending = appendLatencySample({
      serviceId: 'website_1',
      serviceType: 'website',
      observedAt: 1000,
      durationMs: 120,
      success: false,
      statusCode: 503,
      probeStatus: 'PENDING',
      errorCategory: 'HTTP_STATUS_FAILURE',
      retryIndex: 1,
    });
    const online = appendLatencySample({
      serviceId: 'website_1',
      serviceType: 'website',
      observedAt: 2000,
      durationMs: 30,
      success: true,
      statusCode: 200,
    });
    const invalidStatus = appendLatencySample({
      serviceId: 'website_1',
      serviceType: 'website',
      observedAt: 3000,
      durationMs: 30,
      success: false,
      probeStatus: 'RAW_ERROR',
    });
    const invalidRetry = appendLatencySample({
      serviceId: 'website_1',
      serviceType: 'website',
      observedAt: 4000,
      durationMs: 30,
      success: false,
      retryIndex: 101,
    });
    process.stdout.write(JSON.stringify({
      pending: pending && {
        probeStatus: pending.probeStatus,
        errorCategory: pending.errorCategory,
        retryIndex: pending.retryIndex,
      },
      online: online && {
        probeStatus: online.probeStatus,
        errorCategory: online.errorCategory,
        retryIndex: online.retryIndex,
      },
      invalidStatus,
      invalidRetry,
      rows: listLatencySamples({ serviceId: 'website_1', serviceType: 'website' }).map((row) => ({
        probe_status: row.probe_status,
        error_category: row.error_category,
        retry_index: row.retry_index,
      })),
    }));
  `);

  assert.deepEqual(result.pending, {
    probeStatus: 'PENDING',
    errorCategory: 'HTTP_STATUS_FAILURE',
    retryIndex: 1,
  });
  assert.deepEqual(result.online, {
    probeStatus: 'ONLINE',
    errorCategory: null,
    retryIndex: 0,
  });
  assert.equal(result.invalidStatus, null);
  assert.equal(result.invalidRetry, null);
  assert.deepEqual(result.rows, [
    { probe_status: 'PENDING', error_category: 'HTTP_STATUS_FAILURE', retry_index: 1 },
    { probe_status: 'ONLINE', error_category: null, retry_index: 0 },
  ]);
});

test('rejects unsafe or unbounded probe evidence identifiers and categories', () => {
  const result = run(`
    import { appendLatencySample } from './src/store/latencyStore.js';
    const longId = 'x'.repeat(201);
    const rawCategory = appendLatencySample({
      serviceId: 'website_1',
      serviceType: 'website',
      observedAt: 1000,
      durationMs: 20,
      success: false,
      errorCategory: 'https://secret.example/path',
    });
    const invalidId = appendLatencySample({
      serviceId: longId,
      serviceType: 'website',
      observedAt: 1000,
      durationMs: 20,
      success: true,
    });
    process.stdout.write(JSON.stringify({ rawCategory, invalidId }));
  `);

  assert.equal(result.rawCategory, null);
  assert.equal(result.invalidId, null);
});

test('maps shared adapter transitions without exposing raw errors', () => {
  const result = run(`
    import { recordProbeEvidence } from './src/services/probeEvidenceService.js';
    import { listLatencySamples } from './src/store/latencyStore.js';
    recordProbeEvidence({
      serviceId: 'database_1',
      serviceType: 'database',
      observedAt: 1000,
      durationMs: 250,
      success: false,
      errorCategory: 'DATABASE_TIMEOUT',
      retryIndex: 2,
    });
    recordProbeEvidence({
      serviceId: 'database_1',
      serviceType: 'database',
      observedAt: 2000,
      durationMs: 300,
      success: false,
      eventType: 'DOWN',
      errorCategory: 'DATABASE_CONNECTION_FAILED',
    });
    recordProbeEvidence({
      serviceId: 'database_1',
      serviceType: 'database',
      observedAt: 3000,
      durationMs: 40,
      success: true,
      eventType: 'UP',
    });
    process.stdout.write(JSON.stringify(listLatencySamples({
      serviceId: 'database_1',
      serviceType: 'database',
    }).map((row) => ({
      probe_status: row.probe_status,
      error_category: row.error_category,
      retry_index: row.retry_index,
    }))));
  `);

  assert.deepEqual(result, [
    { probe_status: 'PENDING', error_category: 'DATABASE_TIMEOUT', retry_index: 2 },
    { probe_status: 'DOWN', error_category: 'DATABASE_CONNECTION_FAILED', retry_index: 0 },
    { probe_status: 'UP', error_category: null, retry_index: 0 },
  ]);
});
