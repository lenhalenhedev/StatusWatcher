import assert from 'node:assert/strict';
import test from 'node:test';
import { previewWebsite } from '../src/services/dryRunService.js';

test('dry-run rejects forbidden website destinations before any probe', async () => {
  let called = false;
  await assert.rejects(
    previewWebsite({ name: 'Preview', url: 'http://metadata.example.test/' }, {
      lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }],
      checkWebsiteImpl: async () => { called = true; return { ok: true, status: 200, durationMs: 1 }; },
    }),
    (error) => error.code === 'FORBIDDEN_ADDRESS',
  );
  assert.equal(called, false);
});

test('dry-run returns a safe preview and never creates a monitor record', async () => {
  const result = await previewWebsite(
    { id: 'website:preview', name: 'Preview', url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      checkWebsiteImpl: async () => ({ ok: true, status: 204, code: 'HTTP_OK', durationMs: 12 }),
    },
  );
  assert.deepEqual(result, {
    valid: true,
    persisted: false,
    serviceType: 'website',
    name: 'Preview',
    status: 'ONLINE',
    statusCode: 204,
    durationMs: 12,
  });
  assert.equal(JSON.stringify(result).includes('status.example.test'), false);
});

test('dry-run rejects malformed monitor names and URLs with safe categories', async () => {
  await assert.rejects(previewWebsite({ name: '', url: 'https://status.example.test/' }), /name/i);
  await assert.rejects(previewWebsite({ name: 'Valid', url: 'ftp://status.example.test/' }), /invalid/i);
});
