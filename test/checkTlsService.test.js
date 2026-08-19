import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { checkTlsCertificate } from '../src/services/tlsCheckService.js';

class FakeSocket extends EventEmitter {
  constructor(certificate = {}) {
    super();
    this.certificate = certificate;
    this.authorized = true;
    this.authorizationError = undefined;
    this.destroyed = false;
    this.destroyCalls = 0;
    this.alpnProtocol = 'http/1.1';
    this.getProtocol = () => 'TLSv1.3';
    this.getCipher = () => ({ name: 'TLS_AES_128_GCM_SHA256', version: 'TLSv1.3' });
  }

  getPeerCertificate() {
    return this.certificate;
  }

  destroy() {
    this.destroyCalls += 1;
    this.destroyed = true;
    return this;
  }
}

function validCertificate(overrides = {}) {
  return {
    subject: { CN: 'example.com' },
    issuer: { O: 'Example CA' },
    valid_from: 'Aug 1 00:00:00 2026 GMT',
    valid_to: 'Aug 1 00:00:00 2027 GMT',
    fingerprint256: 'AA:BB',
    subjectaltname: 'DNS:example.com',
    ...overrides,
  };
}

test('resolves a verified certificate after secureConnect and always destroys the socket', async () => {
  const socket = new FakeSocket(validCertificate());
  const resultPromise = checkTlsCertificate('example.com', { now: Date.parse('2026-08-19T00:00:00Z'), lookup: async () => [{ address: '93.184.216.34', family: 4 }], connect: () => socket });
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('secureConnect');
  const result = await resultPromise;
  assert.equal(result.authorized, true);
  assert.equal(result.subject, 'example.com');
  assert.equal(result.issuer, 'Example CA');
  assert.equal(result.protocol, 'TLSv1.3');
  assert.equal(result.cipher, 'TLS_AES_128_GCM_SHA256');
  assert.equal(result.remainingDays, 347);
  assert.equal(socket.destroyCalls, 1);
});

test('returns authorization failure safely without exposing raw error details', async () => {
  const socket = new FakeSocket(validCertificate());
  socket.authorized = false;
  socket.authorizationError = 'CERT_HAS_EXPIRED';
  const pending = checkTlsCertificate('example.com', { now: Date.parse('2026-08-19T00:00:00Z'), lookup: async () => [{ address: '93.184.216.34', family: 4 }], connect: () => socket });
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('secureConnect');
  const result = await pending;
  assert.equal(result.authorized, false);
  assert.equal(result.authorizationError, 'CERTIFICATE_AUTHORIZATION_FAILED');
  assert.equal(result.rawError, undefined);
});

test('handles absent or incomplete peer certificate as a safe failure', async () => {
  const socket = new FakeSocket({});
  const pending = checkTlsCertificate('example.com', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], connect: () => socket });
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('secureConnect');
  await assert.rejects(pending, (error) => error.code === 'CERTIFICATE_UNAVAILABLE');
  assert.equal(socket.destroyCalls, 1);
});

test('maps socket errors and destroys the socket exactly once', async () => {
  const socket = new FakeSocket(validCertificate());
  const pending = checkTlsCertificate('example.com', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], connect: () => socket });
  const error = new Error('secret endpoint:password');
  error.code = 'ECONNREFUSED';
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('error', error);
  await assert.rejects(pending, (caught) => caught.code === 'CONNECTION_REFUSED' && !caught.message.includes('secret'));
  assert.equal(socket.destroyCalls, 1);
});

test('maps timeout and cleans up', async () => {
  const socket = new FakeSocket(validCertificate());
  const pending = checkTlsCertificate('example.com', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], connect: () => socket });
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('timeout');
  await assert.rejects(pending, (error) => error.code === 'TIMEOUT');
  assert.equal(socket.destroyCalls, 1);
});

test('rejects malformed certificate dates rather than reporting fake expiry', async () => {
  const socket = new FakeSocket(validCertificate({ valid_to: 'not-a-date' }));
  const pending = checkTlsCertificate('example.com', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], connect: () => socket });
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('secureConnect');
  await assert.rejects(pending, (error) => error.code === 'CERTIFICATE_INVALID');
  assert.equal(socket.destroyCalls, 1);
});

test('rejects private addresses returned by DNS before opening a TLS socket', async () => {
  let connectCalls = 0;
  await assert.rejects(
    checkTlsCertificate('public.example', { lookup: async () => [{ address: '127.0.0.1', family: 4 }], connect: () => { connectCalls += 1; } }),
    (error) => error.code === 'FORBIDDEN_ADDRESS',
  );
  assert.equal(connectCalls, 0);
});

test('maps DNS resolution failures without exposing resolver details', async () => {
  const error = new Error('secret.internal.address');
  error.code = 'ENOTFOUND';
  await assert.rejects(
    checkTlsCertificate('public.example', { lookup: async () => { throw error; } }),
    (caught) => caught.code === 'DNS_LOOKUP_FAILED' && !caught.message.includes('secret.internal.address'),
  );
});

test('pins the selected public address through the TLS lookup callback', async () => {
  const socket = new FakeSocket(validCertificate());
  let tlsOptions;
  const pending = checkTlsCertificate('example.com', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: (options) => { tlsOptions = options; return socket; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const callbackResult = await new Promise((resolve, reject) => tlsOptions.lookup('example.com', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(callbackResult, { address: '93.184.216.34', family: 4 });
  socket.emit('secureConnect');
  await pending;
});
