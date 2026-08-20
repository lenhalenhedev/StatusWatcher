import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WEBSITE_REQUEST_TIMEOUT_MS,
  checkWebsite,
} from '../src/services/websiteStatusClient.js';

function response(status, extra = {}) {
  return {
    status,
    statusText: extra.statusText ?? '',
    body: extra.body ?? null,
    ...extra,
  };
}

test('returns UP for a successful HTTP status and does not consume the response body', async () => {
  let bodyRead = false;
  let request;
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async (_url, options) => {
        request = options;
        return response(204, { body: { async cancel() { bodyRead = true; } } });
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(result.code, 'HTTP_OK');
  assert.equal(bodyRead, true);
  assert.equal(request.method, 'GET');
  assert.equal(request.redirect, 'error');
  assert.ok(request.signal);
});

test('uses Response.status and treats 4xx/5xx as a bounded HTTP failure', async () => {
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => response(503, { statusText: 'Service Unavailable' }),
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 503,
    code: 'HTTP_ERROR',
    error: 'HTTP status 503',
  });
});

test('rejects redirect responses without following a second destination', async () => {
  let requestCount = 0;
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async (_url, options) => {
        requestCount += 1;
        assert.equal(options.redirect, 'error');
        return response(302);
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 302);
  assert.equal(requestCount, 1);
});

test('maps AbortError and TimeoutError to a safe timeout category', async () => {
  for (const name of ['AbortError', 'TimeoutError']) {
    const result = await checkWebsite(
      { url: 'https://status.example.test/health' },
      {
        lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchImpl: async () => { throw Object.assign(new Error('secret raw endpoint'), { name }); },
      },
    );
    assert.deepEqual(result, { ok: false, status: null, code: 'TIMEOUT', error: 'Request timed out' });
  }
});

test('maps arbitrary network errors without forwarding raw error text', async () => {
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => { throw new Error('password=secret host=10.0.0.1'); },
    },
  );

  assert.deepEqual(result, { ok: false, status: null, code: 'NETWORK_ERROR', error: 'Network request failed' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('10.0.0.1'), false);
});

test('rejects forbidden resolved addresses before any fetch call', async () => {
  let fetchCalled = false;
  await assert.rejects(
    checkWebsite(
      { url: 'http://metadata.example.test/' },
      {
        lookupImpl: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ],
        fetchImpl: async () => { fetchCalled = true; return response(200); },
      },
    ),
    (error) => error.code === 'FORBIDDEN_ADDRESS',
  );
  assert.equal(fetchCalled, false);
});

test('rejects invalid URL input before DNS resolution', async () => {
  let lookupCalled = false;
  for (const url of [
    'ftp://status.example.test',
    'https://user:password@status.example.test',
    'https://127.0.0.1/health',
    'https://status.example.test/#secret',
    `https://status.example.test/${'x'.repeat(2_050)}`,
  ]) {
    await assert.rejects(
      checkWebsite(
        { url },
        {
          lookupImpl: async () => { lookupCalled = true; return [{ address: '93.184.216.34', family: 4 }]; },
          fetchImpl: async () => response(200),
        },
      ),
      (error) => ['INVALID_URL', 'FORBIDDEN_ADDRESS'].includes(error.code),
    );
  }
  assert.equal(lookupCalled, false);
});

test('uses the bounded default request timeout', async () => {
  let receivedSignal;
  await checkWebsite(
    { url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async (_url, options) => {
        receivedSignal = options.signal;
        return response(200);
      },
    },
  );
  assert.equal(WEBSITE_REQUEST_TIMEOUT_MS, 15_000);
  assert.equal(receivedSignal.aborted, false);
});
