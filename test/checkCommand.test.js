import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import config from '../src/config.js';
import * as checkTls from '../src/commands/checkTls.js';
import * as checkDns from '../src/commands/checkDns.js';
import * as whois from '../src/commands/whois.js';
import { buildDnsCheckEmbed, buildTlsCheckEmbed, buildWhoisEmbed, diagnosticErrorMessage } from '../src/handlers/checkEmbeds.js';

function optionBag(values) {
  return {
    getString(name, required = false) {
      const value = values[name];
      if (required && value === undefined) throw new Error(`missing ${name}`);
      return value;
    },
    getInteger(name) { return values[name]; },
  };
}

function interaction(values, userId = config.adminUserId) {
  return {
    user: { id: userId },
    options: optionBag(values),
    deferred: false,
    replied: false,
    replies: [],
    edits: [],
    async reply(payload) { this.replied = true; this.replies.push(payload); },
    async deferReply(payload) { this.deferred = true; this.replies.push(payload); },
    async editReply(payload) { this.edits.push(payload); },
  };
}

const tlsResult = {
  subject: 'example.com', issuer: 'Example CA', validFrom: 'Aug 1 2026 GMT', validTo: 'Aug 1 2027 GMT',
  remainingDays: 347, expired: false, authorized: true, protocol: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256', fingerprint256: 'AA:BB',
};

const whoisResult = {
  domainName: 'example.com',
  registrar: ['Example Registrar'],
  creationDate: ['1995-08-14T04:00:00Z'],
  registryExpiryDate: ['2030-08-14T04:00:00Z'],
  domainStatus: ['clientTransferProhibited'],
  nameServer: ['ns1.example.com', 'ns2.example.com'],
};

test('registers exact check command names, descriptions, required options, choices, and port bounds', () => {
  const tlsJson = checkTls.data.toJSON();
  const dnsJson = checkDns.data.toJSON();
  const whoisJson = whois.data.toJSON();
  assert.equal(tlsJson.name, 'check-tls');
  assert.equal(dnsJson.name, 'check-dns');
  assert.deepEqual(tlsJson.options.map((option) => option.name), ['domain', 'port']);
  assert.deepEqual(dnsJson.options.map((option) => option.name), ['domain', 'type', 'nameserver']);
  assert.equal(tlsJson.options[0].required, true);
  assert.equal(tlsJson.options[1].min_value, 1);
  assert.equal(tlsJson.options[1].max_value, 65_535);
  assert.deepEqual(dnsJson.options[1].choices.map((choice) => choice.value), ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME']);
  assert.equal(whoisJson.name, 'whois');
  assert.deepEqual(whoisJson.options.map((option) => option.name), ['domain']);
  assert.equal(whoisJson.options[0].required, true);
});

test('rejects unauthorized TLS, DNS, and WHOIS users with the Ephemeral flag', async () => {
  for (const command of [checkTls, checkDns, whois]) {
    const testInteraction = interaction({ domain: 'example.com' }, 'not-the-admin');
    await command.execute(testInteraction, { checkTlsCertificate: async () => tlsResult, queryDnsRecords: async () => ({ type: 'A', nameserver: '1.1.1.1', answers: [], answerCount: 0 }), lookupWhois: async () => whoisResult });
    assert.equal(testInteraction.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(testInteraction.replies[0].content, /administrator/i);
  }
});

test('runs TLS with default port, normalized domain, and private deferred response', async () => {
  const testInteraction = interaction({ domain: ' Example.COM. ' });
  let observed;
  await checkTls.execute(testInteraction, { checkTlsCertificate: async (domain, options) => { observed = { domain, options }; return tlsResult; } });
  assert.deepEqual(observed, { domain: 'example.com', options: { port: 443 } });
  assert.equal(testInteraction.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(testInteraction.edits.length, 1);
  assert.ok(testInteraction.edits[0].embeds[0]);
});

test('runs DNS with defaults and normalized explicit inputs', async () => {
  const testInteraction = interaction({ domain: ' Example.COM. ', type: 'mx', nameserver: '8.8.8.8' });
  let observed;
  await checkDns.execute(testInteraction, { queryDnsRecords: async (domain, options) => { observed = { domain, options }; return { type: 'MX', nameserver: '8.8.8.8', answers: [{ exchange: 'mail.example.com', priority: 10 }], answerCount: 1 }; } });
  assert.deepEqual(observed, { domain: 'example.com', options: { type: 'MX', nameserver: '8.8.8.8' } });
  assert.equal(testInteraction.replies[0].flags, MessageFlags.Ephemeral);
  assert.ok(testInteraction.edits[0].embeds[0]);
});

test('returns validation errors before network calls and keeps them ephemeral', async () => {
  for (const [command, values] of [[checkTls, { domain: 'http://127.0.0.1' }], [checkDns, { domain: 'example.com', nameserver: '127.0.0.1' }], [whois, { domain: 'http://127.0.0.1' }]]) {
    let called = false;
    const testInteraction = interaction(values);
    await command.execute(testInteraction, { checkTlsCertificate: async () => { called = true; }, queryDnsRecords: async () => { called = true; }, lookupWhois: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(testInteraction.replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(testInteraction.edits.length, 0);
  }
});

test('maps network failures to safe user-facing messages without raw exception text', async () => {
  const testInteraction = interaction({ domain: 'example.com' });
  await checkTls.execute(testInteraction, { checkTlsCertificate: async () => { const error = new Error('password=secret'); error.code = 'TIMEOUT'; throw error; } });
  assert.equal(testInteraction.edits[0].content, 'The check timed out.');
  assert.doesNotMatch(testInteraction.edits[0].content, /secret|password/i);
});

test('logs only a safe TLS diagnostic category and never raw service error text', async () => {
  const testInteraction = interaction({ domain: 'example.com' });
  const reports = [];
  await checkTls.execute(testInteraction, {
    checkTlsCertificate: async () => {
      const error = new Error('password=secret endpoint=example.com');
      error.code = 'TLS_HANDSHAKE_FAILED';
      throw error;
    },
    reportError: async (context, message) => reports.push({ context, message }),
  });
  assert.deepEqual(reports, [{ context: 'CheckTls.execute', message: 'category=TLS_HANDSHAKE_FAILED' }]);
  assert.doesNotMatch(reports[0].message, /secret|password|example\.com/i);
  assert.equal(testInteraction.edits[0].content, 'The check failed. Review the bot logs for a safe diagnostic category.');
});

test('normalizes unexpected diagnostic codes to UNKNOWN before logging', async () => {
  const testInteraction = interaction({ domain: 'example.com' });
  const reports = [];
  await checkTls.execute(testInteraction, {
    checkTlsCertificate: async () => {
      const error = new Error('attacker-controlled details');
      error.code = 'bad code\nwith details';
      throw error;
    },
    reportError: async (_context, message) => reports.push(message),
  });
  assert.deepEqual(reports, ['category=UNKNOWN']);
});

test('runs WHOIS with a normalized domain and private deferred response', async () => {
  const testInteraction = interaction({ domain: ' Example.COM. ' });
  let observed;
  await whois.execute(testInteraction, { lookupWhois: async (domain) => { observed = domain; return whoisResult; } });
  assert.equal(observed, 'example.com');
  assert.equal(testInteraction.replies[0].flags, MessageFlags.Ephemeral);
  assert.ok(testInteraction.edits[0].embeds[0]);
});

test('maps WHOIS failures to safe user-facing messages and safe diagnostic categories', async () => {
  const testInteraction = interaction({ domain: 'example.com' });
  const reports = [];
  await whois.execute(testInteraction, {
    lookupWhois: async () => {
      const error = new Error('password=secret endpoint=example.com');
      error.code = 'WHOIS_LOOKUP_FAILED';
      throw error;
    },
    reportError: async (context, message) => reports.push({ context, message }),
  });
  assert.deepEqual(reports, [{ context: 'Whois.execute', message: 'category=WHOIS_LOOKUP_FAILED' }]);
  assert.equal(testInteraction.edits[0].content, 'The WHOIS lookup failed. Review the bot logs for a safe diagnostic category.');
  assert.doesNotMatch(JSON.stringify(testInteraction.edits[0]), /secret|password|example\.com/);
});

test('renders bounded TLS, DNS, and WHOIS embeds with English labels and no raw errors', () => {
  const tlsEmbed = buildTlsCheckEmbed('example.com', 443, tlsResult).toJSON();
  const dnsEmbed = buildDnsCheckEmbed('example.com', { type: 'A', nameserver: '1.1.1.1', answers: ['93.184.216.34'], answerCount: 1 }).toJSON();
  const whoisEmbed = buildWhoisEmbed('example.com', { ...whoisResult, registrar: ['@everyone `unsafe`'.repeat(100)] }).toJSON();
  assert.match(tlsEmbed.title, /TLS Certificate/);
  assert.match(dnsEmbed.title, /DNS Lookup/);
  assert.match(whoisEmbed.title, /WHOIS Lookup/);
  assert.ok(tlsEmbed.fields.every((field) => field.name && field.value));
  assert.ok(dnsEmbed.fields.every((field) => field.value.length <= 1024));
  assert.ok(whoisEmbed.fields.length <= 25);
  assert.ok(whoisEmbed.fields.every((field) => field.name && field.name.length <= 256 && field.value.length <= 1024));
  assert.doesNotMatch(JSON.stringify(whoisEmbed), /@everyone|`/);
  assert.equal(diagnosticErrorMessage({ code: 'DNS_QUERY_FAILED', message: 'secret endpoint' }), 'The check failed. Review the bot logs for a safe diagnostic category.');
  assert.equal(diagnosticErrorMessage({ code: 'WHOIS_TIMEOUT' }), 'The WHOIS lookup timed out.');
  assert.equal(diagnosticErrorMessage({ code: 'WHOIS_RESPONSE_INVALID' }), 'The WHOIS response was invalid.');
});

test('central command registry exposes each diagnostic command exactly once', async () => {
  const { commandModules, commandMap } = await import('../src/commands/index.js');
  assert.equal(commandModules.filter((module) => module.data.name === 'check-tls').length, 1);
  assert.equal(commandModules.filter((module) => module.data.name === 'check-dns').length, 1);
  assert.equal(commandModules.filter((module) => module.data.name === 'whois').length, 1);
  assert.strictEqual(commandMap.get('check-tls'), checkTls);
  assert.strictEqual(commandMap.get('check-dns'), checkDns);
  assert.strictEqual(commandMap.get('whois'), whois);
});
