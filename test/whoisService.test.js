import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupWhois, WHOIS_CHECK_TIMEOUT_MS } from '../src/services/whoisService.js';

function fakeLookup(payload, error = null) {
  const calls = [];
  const lookup = (domain, options, callback) => {
    calls.push({ domain, options });
    setImmediate(() => callback(error, payload));
  };
  lookup.calls = calls;
  return lookup;
}

test('parses useful WHOIS fields case-insensitively and bounds normalized output', async () => {
  const lookup = fakeLookup([
    {
      server: 'whois.registry.example',
      data: [
        'Domain Name: EXAMPLE.COM',
        'Registry Domain ID: D123',
        'Registrar: Example Registrar',
        'Registrar IANA ID: 999',
        'Registrar URL: https://registrar.example',
        'Creation Date: 1995-08-14T04:00:00Z',
        'Updated Date: 2026-08-01T04:00:00Z',
        'Registry Expiry Date: 2030-08-14T04:00:00Z',
        'Domain Status: clientTransferProhibited',
        'Domain Status: clientTransferProhibited',
        'Name Server: NS1.EXAMPLE.COM',
        'name server: ns2.example.com',
        'Whois Server: whois.registry.example',
        'DNSSEC: signedDelegation',
        'Registrant Country: US',
        'Registrant Name: Private Person',
        'Registrant Email: private@example.com',
      ].join('\r\n'),
    },
  ]);

  const result = await lookupWhois(' Example.COM. ', { WhoisLookup: lookup });

  assert.equal(result.domainName, 'EXAMPLE.COM');
  assert.equal(result.registryDomainId, 'D123');
  assert.deepEqual(result.registrar, ['Example Registrar']);
  assert.deepEqual(result.registrarIanaId, ['999']);
  assert.deepEqual(result.registrarUrl, ['https://registrar.example']);
  assert.deepEqual(result.creationDate, ['1995-08-14T04:00:00Z']);
  assert.deepEqual(result.updatedDate, ['2026-08-01T04:00:00Z']);
  assert.deepEqual(result.registryExpiryDate, ['2030-08-14T04:00:00Z']);
  assert.deepEqual(result.domainStatus, ['clientTransferProhibited']);
  assert.deepEqual(result.nameServer, ['NS1.EXAMPLE.COM', 'ns2.example.com']);
  assert.deepEqual(result.whoisServer, ['whois.registry.example']);
  assert.deepEqual(result.dnssec, ['signedDelegation']);
  assert.deepEqual(result.registrantCountry, ['US']);
  assert.doesNotMatch(JSON.stringify(result), /private@example\.com|Private Person/);
  assert.deepEqual(lookup.calls[0], {
    domain: 'example.com',
    options: { follow: 0, timeout: WHOIS_CHECK_TIMEOUT_MS, verbose: false },
  });
});

test('accepts raw string responses and normalizes common registry label variants', async () => {
  const lookup = fakeLookup([
    'Domain: example.net',
    'Registrar WHOIS Server: whois.example.net',
    'Registrar Registration Expiration Date: 2031-01-01',
    'Created On: 2020-01-01',
    'Updated On: 2025-01-01',
    'Expiration Date: 2032-01-01',
  ].join('\n'));

  const result = await lookupWhois('example.net', { WhoisLookup: lookup });

  assert.equal(result.domainName, 'example.net');
  assert.deepEqual(result.whoisServer, ['whois.example.net']);
  assert.deepEqual(result.creationDate, ['2020-01-01']);
  assert.deepEqual(result.updatedDate, ['2025-01-01']);
  assert.deepEqual(result.registrarRegistrationExpirationDate, ['2031-01-01']);
  assert.deepEqual(result.registryExpiryDate, ['2032-01-01']);
});

test('deduplicates values, caps each field at ten values, and neutralizes control characters and mentions', async () => {
  const lines = [
    'Name Server: ns1.example.com',
    'Name Server: ns1.example.com',
    ...Array.from({ length: 12 }, (_, index) => `Name Server: ns${index + 2}.example.com`),
    'Domain Status: @everyone `alert`\u0000',
  ];
  const result = await lookupWhois('example.com', { WhoisLookup: fakeLookup(lines.join('\n')) });

  assert.equal(result.nameServer.length, 10);
  assert.equal(new Set(result.nameServer).size, 10);
  assert.doesNotMatch(result.domainStatus[0], /@everyone|`|\u0000/);
});

test('truncates oversized field values instead of returning unbounded WHOIS text', async () => {
  const result = await lookupWhois('example.com', {
    WhoisLookup: fakeLookup(`Registrar: ${'R'.repeat(2_000)}`),
  });

  assert.equal(result.registrar.length, 1);
  assert.ok(result.registrar[0].length <= 512);
});

test('rejects malformed client payloads without exposing upstream details', async () => {
  await assert.rejects(
    lookupWhois('example.com', { WhoisLookup: fakeLookup({ raw: 'unexpected' }) }),
    (error) => error.code === 'WHOIS_RESPONSE_INVALID' && !error.message.includes('unexpected'),
  );
});

test('maps upstream errors to a safe WHOIS category without raw message or domain details', async () => {
  const upstream = new Error('password=secret endpoint=example.com');
  upstream.code = 'ECONNRESET';
  await assert.rejects(
    lookupWhois('example.com', { WhoisLookup: fakeLookup(null, upstream) }),
    (error) => error.code === 'WHOIS_LOOKUP_FAILED'
      && !error.message.includes('secret')
      && !error.message.includes('example.com'),
  );
});

test('maps a hanging lookup to WHOIS_TIMEOUT and clears the pending timer', async () => {
  const started = Date.now();
  const lookup = () => undefined;
  await assert.rejects(
    lookupWhois('example.com', { WhoisLookup: lookup, timeoutMs: 20 }),
    (error) => error.code === 'WHOIS_TIMEOUT',
  );
  assert.ok(Date.now() - started >= 15);
});

test('validates the domain before constructing or calling the WHOIS client', async () => {
  let called = false;
  await assert.rejects(
    lookupWhois('http://127.0.0.1/admin', { WhoisLookup: () => { called = true; } }),
    (error) => error.code === 'INVALID_DOMAIN',
  );
  assert.equal(called, false);
});

test('rejects private and reserved address targets before network access', async () => {
  let called = false;
  await assert.rejects(
    lookupWhois('127.0.0.1', { WhoisLookup: () => { called = true; } }),
    (error) => error.code === 'FORBIDDEN_ADDRESS',
  );
  assert.equal(called, false);
});

test('uses the documented package callback API through the injected boundary', async () => {
  const lookup = fakeLookup('Domain Name: example.org');
  const result = await lookupWhois('example.org', { WhoisLookup: lookup });
  assert.equal(result.domainName, 'example.org');
  assert.equal(lookup.calls.length, 1);
});
