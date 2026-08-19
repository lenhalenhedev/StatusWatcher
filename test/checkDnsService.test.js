import assert from 'node:assert/strict';
import test from 'node:test';
import { queryDnsRecords } from '../src/services/dnsCheckService.js';

function fakeDns(result, method = 'resolveA') {
  return class FakeDns {
    constructor(options) {
      this.options = options;
      this.calls = [];
    }

    async [method](...args) {
      this.calls.push(args);
      if (result instanceof Error) throw result;
      return result;
    }

    async resolve(...args) {
      this.calls.push(args);
      if (result instanceof Error) throw result;
      return result;
    }
  };
}

test('queries A using one selected nameserver and normalizes addresses', async () => {
  const result = await queryDnsRecords('example.com', { nameserver: '8.8.8.8', type: 'A', DnsClient: fakeDns({ answers: [{ address: '93.184.216.34' }] }) });
  assert.equal(result.type, 'A');
  assert.equal(result.nameserver, '8.8.8.8');
  assert.deepEqual(result.answers, ['93.184.216.34']);
});

test('queries AAAA, MX, CNAME, TXT, and NS with correct mapping and normalized answer shapes', async () => {
  const cases = [
    ['AAAA', { answers: [{ address: '2001:db8::1' }] }, ['2001:db8::1']],
    ['MX', { answers: [{ exchange: 'mail.example.com', priority: 10 }] }, [{ exchange: 'mail.example.com', priority: 10 }]],
    ['CNAME', { answers: [{ domain: 'alias.example.com' }] }, ['alias.example.com']],
    ['TXT', { answers: [{ data: ['v=spf1', 'include:example.com'] }] }, ['v=spf1include:example.com']],
    ['NS', { answers: [{ domain: 'ns1.example.com' }] }, ['ns1.example.com']],
  ];
  for (const [type, response, expected] of cases) {
    const result = await queryDnsRecords('example.com', { type, DnsClient: fakeDns(response) });
    assert.equal(result.type, type);
    assert.deepEqual(result.answers, expected);
  }
});

test('uses the generic dns2 resolver for arbitrary supported types that lack convenience helpers', async () => {
  class FakeDns {
    async resolve(...args) {
      this.args = args;
      return { answers: [{ domain: 'ns.example.com' }] };
    }
  }
  const client = new FakeDns();
  const result = await queryDnsRecords('example.com', { type: 'NS', DnsClient: class { constructor() { return client; } } });
  assert.deepEqual(client.args, ['example.com', 'NS']);
  assert.deepEqual(result.answers, ['ns.example.com']);
});

test('maps dns2 errors without exposing raw nameserver or packet details', async () => {
  const error = new Error('password=secret at 8.8.8.8');
  error.code = 'ETIMEOUT';
  await assert.rejects(
    queryDnsRecords('example.com', { DnsClient: fakeDns(error) }),
    (caught) => caught.code === 'DNS_QUERY_FAILED' && !caught.message.includes('secret') && !caught.message.includes('8.8.8.8'),
  );
});

test('rejects malformed responses instead of returning unbounded or undefined data', async () => {
  await assert.rejects(queryDnsRecords('example.com', { DnsClient: fakeDns({}) }), (error) => error.code === 'DNS_RESPONSE_INVALID');
  await assert.rejects(queryDnsRecords('example.com', { DnsClient: fakeDns({ answers: [{ address: 'a'.repeat(1000) }] }) }), (error) => error.code === 'DNS_RESPONSE_INVALID');
});

test('uses A and 1.1.1.1 defaults when optional parameters are omitted', async () => {
  const calls = [];
  class DefaultDns {
    constructor(options) { calls.push({ constructor: options }); }
    async resolveA(domain) { calls.push({ method: 'resolveA', domain }); return { answers: [{ address: '93.184.216.34' }] }; }
  }
  const result = await queryDnsRecords('example.com', { DnsClient: DefaultDns });
  assert.deepEqual(calls[0].constructor, { nameServers: ['1.1.1.1'], port: 53, recursive: true, timeout: 5_000 });
  assert.deepEqual(calls[1], { method: 'resolveA', domain: 'example.com' });
  assert.equal(result.type, 'A');
  assert.equal(result.nameserver, '1.1.1.1');
});

test('rejects forbidden nameserver before constructing a resolver', async () => {
  let constructed = false;
  class ShouldNotConstruct { constructor() { constructed = true; } }
  await assert.rejects(queryDnsRecords('example.com', { nameserver: '10.0.0.1', DnsClient: ShouldNotConstruct }), (error) => error.code === 'INVALID_NAMESERVER');
  assert.equal(constructed, false);
});
