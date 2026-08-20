import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { checkWebsite } from '../src/services/websiteStatusClient.js';
import { queryDnsRecords } from '../src/services/dnsCheckService.js';
import { checkTlsCertificate } from '../src/services/tlsCheckService.js';

const PUBLIC_ADDRESS = { address: '93.184.216.34', family: 4 };

function response(status, body = null) {
  return { status, body };
}

function makeSocket({ certificate, authorized = true } = {}) {
  const socket = new EventEmitter();
  let destroyCount = 0;
  let timeoutValue;
  socket.authorized = authorized;
  socket.alpnProtocol = 'http/1.1';
  socket.getPeerCertificate = () => certificate;
  socket.getProtocol = () => 'TLSv1.3';
  socket.getCipher = () => ({ name: 'TLS_AES_128_GCM_SHA256' });
  socket.setTimeout = (value) => { timeoutValue = value; };
  socket.destroy = () => { destroyCount += 1; };
  socket.removeAllListeners = (...args) => EventEmitter.prototype.removeAllListeners.apply(socket, args);
  Object.defineProperties(socket, {
    destroyCount: { get: () => destroyCount },
    timeoutValue: { get: () => timeoutValue },
  });
  return socket;
}

function validCertificate(overrides = {}) {
  return {
    subject: { CN: 'status.example.test' },
    issuer: { O: 'Example CA' },
    valid_from: 'Aug 19 00:00:00 2026 GMT',
    valid_to: 'Aug 19 00:00:00 2027 GMT',
    fingerprint256: 'fingerprint-that-is-safe-to-return',
    subjectaltname: 'DNS:status.example.test',
    ...overrides,
  };
}

async function successfulTls(options = {}) {
  const socket = makeSocket({ certificate: validCertificate(), ...options });
  const promise = checkTlsCertificate('status.example.test', {
    lookup: async () => [PUBLIC_ADDRESS],
    connect: () => socket,
    now: Date.parse('Aug 20 00:00:00 2026 GMT'),
    timeoutMs: 100,
  });
  queueMicrotask(() => socket.emit('secureConnect'));
  return { socket, result: await promise };
}

test('HTTP maps a TIMEOUT error code even when the error name is generic', async () => {
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    {
      lookupImpl: async () => [PUBLIC_ADDRESS],
      fetchImpl: async () => { throw Object.assign(new Error('secret timeout endpoint'), { code: 'TIMEOUT' }); },
    },
  );
  assert.deepEqual({ ok: result.ok, status: result.status, code: result.code, error: result.error }, {
    ok: false,
    status: null,
    code: 'TIMEOUT',
    error: 'Request timed out',
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('HTTP rejects empty and malformed DNS answers before fetch', async () => {
  for (const lookupImpl of [
    async () => [],
    async () => { throw Object.assign(new Error('private host leaked'), { code: 'EAI_AGAIN' }); },
    async () => ({ address: PUBLIC_ADDRESS.address }),
  ]) {
    let fetchCalled = false;
    await assert.rejects(
      checkWebsite(
        { url: 'https://status.example.test/health' },
        { lookupImpl, fetchImpl: async () => { fetchCalled = true; return response(200); } },
      ),
      (error) => error.code === 'DNS_ERROR',
    );
    assert.equal(fetchCalled, false);
  }
});

test('HTTP rejects an IPv6 forbidden literal before DNS resolution', async () => {
  let lookupCalled = false;
  await assert.rejects(
    checkWebsite(
      { url: 'https://[::1]/health' },
      { lookupImpl: async () => { lookupCalled = true; return [PUBLIC_ADDRESS]; }, fetchImpl: async () => response(200) },
    ),
    (error) => error.code === 'FORBIDDEN_ADDRESS',
  );
  assert.equal(lookupCalled, false);
});

test('HTTP accepts exactly 2048 URL characters and rejects 2049 characters', async () => {
  const prefix = 'https://status.example.test/';
  const accepted = `${prefix}${'x'.repeat(2048 - prefix.length)}`;
  const rejected = `${prefix}${'x'.repeat(2049 - prefix.length)}`;
  const acceptedResult = await checkWebsite(
    { url: accepted },
    { lookupImpl: async () => [PUBLIC_ADDRESS], fetchImpl: async () => response(204) },
  );
  assert.equal(acceptedResult.code, 'HTTP_OK');
  await assert.rejects(
    checkWebsite({ url: rejected }, { lookupImpl: async () => [PUBLIC_ADDRESS], fetchImpl: async () => response(204) }),
    (error) => error.code === 'INVALID_URL',
  );
});

test('HTTP returns INVALID_RESPONSE for status values outside the HTTP range', async () => {
  for (const status of [99, 600, Number.NaN, 'not-a-status']) {
    const result = await checkWebsite(
      { url: 'https://status.example.test/health' },
      { lookupImpl: async () => [PUBLIC_ADDRESS], fetchImpl: async () => response(status) },
    );
    assert.equal(result.code, 'INVALID_RESPONSE');
    assert.equal(result.status, null);
  }
});

test('HTTP returns a result even when response-body cancellation fails', async () => {
  const body = { cancel: async () => { throw new Error('body secret should not escape'); } };
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    { lookupImpl: async () => [PUBLIC_ADDRESS], fetchImpl: async () => response(503, body) },
  );
  assert.equal(result.code, 'HTTP_ERROR');
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result).includes('body secret'), false);
});

test('HTTP fails closed when fetchImpl is not callable', async () => {
  const result = await checkWebsite(
    { url: 'https://status.example.test/health' },
    { lookupImpl: async () => [PUBLIC_ADDRESS], fetchImpl: null },
  );
  assert.deepEqual({ code: result.code, status: result.status, error: result.error }, {
    code: 'NETWORK_ERROR',
    status: null,
    error: 'Network request failed',
  });
});

test('DNS rejects a client with no generic or type-specific resolver', async () => {
  class InvalidClient {
    constructor() {}
  }
  await assert.rejects(
    queryDnsRecords('status.example.test', { DnsClient: InvalidClient }),
    (error) => error.code === 'DNS_CLIENT_INVALID',
  );
});

test('DNS rejects null, non-array, and oversized answer collections', async () => {
  for (const answers of [null, {}, Array.from({ length: 51 }, () => ({ address: '93.184.216.34' }))]) {
    class FixtureClient {
      constructor() {}
      resolveA() { return Promise.resolve(answers === null ? null : { answers }); }
    }
    await assert.rejects(
      queryDnsRecords('status.example.test', { DnsClient: FixtureClient }),
      (error) => error.code === 'DNS_RESPONSE_INVALID',
    );
  }
});

test('DNS validates MX priority boundaries and numeric shape', async () => {
  for (const priority of [-1, 65_536, 1.5, 'not-a-number']) {
    class FixtureClient {
      constructor() {}
      resolveMX() { return Promise.resolve({ answers: [{ exchange: 'mail.example.test', priority }] }); }
    }
    await assert.rejects(
      queryDnsRecords('status.example.test', { type: 'MX', DnsClient: FixtureClient }),
      (error) => error.code === 'DNS_RESPONSE_INVALID',
    );
  }
});

test('DNS joins TXT chunks and rejects empty, malformed, or overlong record values', async () => {
  class TxtClient {
    constructor() {}
    resolve(_domain, type) {
      assert.equal(type, 'TXT');
      return Promise.resolve({ answers: [{ data: ['part-one', 'part-two'] }] });
    }
  }
  const result = await queryDnsRecords('status.example.test', { type: 'TXT', DnsClient: TxtClient });
  assert.deepEqual(result.answers, ['part-onepart-two']);

  for (const answer of [{ data: [] }, { data: 'x'.repeat(513) }, { data: null }]) {
    class InvalidTxtClient {
      constructor() {}
      resolve() { return Promise.resolve({ answers: [answer] }); }
    }
    await assert.rejects(
      queryDnsRecords('status.example.test', { type: 'TXT', DnsClient: InvalidTxtClient }),
      (error) => error.code === 'DNS_RESPONSE_INVALID',
    );
  }
});

test('DNS preserves timeout and input/client validation categories', async () => {
  class HangingClient {
    constructor() {}
    resolveA() { return new Promise(() => {}); }
  }
  await assert.rejects(
    queryDnsRecords('status.example.test', { DnsClient: HangingClient, timeoutMs: 5 }),
    (error) => error.code === 'DNS_TIMEOUT',
  );

  class FailingClient {
    constructor() {}
    resolveA() { return Promise.reject(Object.assign(new Error('upstream secret'), { code: 'ECONNRESET' })); }
  }
  await assert.rejects(
    queryDnsRecords('status.example.test', { DnsClient: FailingClient }),
    (error) => error.code === 'DNS_QUERY_FAILED' && !error.message.includes('upstream secret'),
  );

  for (const [options, code] of [
    [{ type: 'INVALID' }, 'INVALID_DNS_TYPE'],
    [{ nameserver: '127.0.0.1' }, 'INVALID_NAMESERVER'],
    [{ domain: '' }, 'INVALID_DOMAIN'],
  ]) {
    await assert.rejects(
      queryDnsRecords(options.domain ?? 'status.example.test', options),
      (error) => error.code === code,
    );
  }
});

test('TLS maps lookup failures, connection failures, and forbidden destinations safely', async () => {
  await assert.rejects(
    checkTlsCertificate('status.example.test', { lookup: async () => { throw Object.assign(new Error('secret dns'), { code: 'ENOTFOUND' }); } }),
    (error) => error.code === 'DNS_LOOKUP_FAILED' && !error.message.includes('secret'),
  );
  await assert.rejects(
    checkTlsCertificate('status.example.test', { lookup: async () => [] }),
    (error) => error.code === 'FORBIDDEN_ADDRESS',
  );
  await assert.rejects(
    checkTlsCertificate('status.example.test', {
      lookup: async () => [PUBLIC_ADDRESS],
      connect: () => { throw Object.assign(new Error('secret refusal'), { code: 'ECONNREFUSED' }); },
    }),
    (error) => error.code === 'CONNECTION_REFUSED' && !error.message.includes('secret'),
  );
});

test('TLS classifies unavailable and invalid certificates after secureConnect', async () => {
  for (const certificate of [null, {}, { valid_to: 'not-a-date' }, { valid_to: 'Aug 19 00:00:00 2027 GMT', valid_from: 'not-a-date' }]) {
    const socket = makeSocket({ certificate });
    const promise = checkTlsCertificate('status.example.test', {
      lookup: async () => [PUBLIC_ADDRESS],
      connect: () => socket,
      timeoutMs: 100,
    });
    queueMicrotask(() => socket.emit('secureConnect'));
    await assert.rejects(promise, (error) => ['CERTIFICATE_UNAVAILABLE', 'CERTIFICATE_INVALID'].includes(error.code));
    assert.equal(socket.destroyCount, 1);
  }
});

test('TLS reports authorization state without enabling certificate rejection', async () => {
  const { socket, result } = await successfulTls({ authorized: false });
  assert.equal(result.authorized, false);
  assert.equal(result.authorizationError, 'CERTIFICATE_AUTHORIZATION_FAILED');
  assert.equal(socket.destroyCount, 1);

  const authorized = await successfulTls({ authorized: true });
  assert.equal(authorized.result.authorized, true);
  assert.equal(authorized.result.authorizationError, undefined);
});

test('TLS enforces socket timeout and hard timer, cleans up, and ignores later events', async () => {
  const socket = makeSocket({ certificate: validCertificate() });
  const promise = checkTlsCertificate('status.example.test', {
    lookup: async () => [PUBLIC_ADDRESS],
    connect: () => socket,
    timeoutMs: 50,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.timeoutValue, 50);
  await assert.rejects(promise, (error) => error.code === 'TIMEOUT');
  assert.equal(socket.destroyCount, 1);
  socket.on('error', () => {});
  socket.emit('error', Object.assign(new Error('late refusal'), { code: 'ECONNREFUSED' }));
  socket.emit('secureConnect');
  assert.equal(socket.destroyCount, 1);
});

test('TLS maps socket error codes and prevents double settlement after the first error', async () => {
  for (const [socketCode, expectedCode] of [
    ['ENOTFOUND', 'DNS_LOOKUP_FAILED'],
    ['ECONNREFUSED', 'CONNECTION_REFUSED'],
    ['ETIMEDOUT', 'TIMEOUT'],
    ['CERT_HAS_EXPIRED', 'CERTIFICATE_AUTHORIZATION_FAILED'],
    ['ECONNRESET', 'TLS_HANDSHAKE_FAILED'],
  ]) {
    const socket = makeSocket({ certificate: validCertificate() });
    const promise = checkTlsCertificate('status.example.test', {
      lookup: async () => [PUBLIC_ADDRESS],
      connect: () => socket,
      timeoutMs: 100,
    });
    queueMicrotask(() => socket.emit('error', Object.assign(new Error('raw secret'), { code: socketCode })));
    await assert.rejects(promise, (error) => error.code === expectedCode && !error.message.includes('raw secret'));
    assert.equal(socket.destroyCount, 1);
    socket.on('error', () => {});
    socket.emit('error', Object.assign(new Error('second error'), { code: 'ECONNREFUSED' }));
    socket.emit('secureConnect');
    assert.equal(socket.destroyCount, 1);
  }
});
