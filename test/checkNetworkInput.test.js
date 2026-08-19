import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DNS_RECORD_TYPES,
  normalizeDomain,
  normalizeDnsType,
  normalizeNameserver,
  parsePort,
} from '../src/utils/checkNetworkInput.js';

test('normalizes valid DNS names, trailing dots, and IDNs', () => {
  assert.equal(normalizeDomain(' Example.COM. '), 'example.com');
  assert.equal(normalizeDomain('bücher.example'), 'xn--bcher-kva.example');
});

test('accepts valid IPv4 and IPv6 literals', () => {
  assert.equal(normalizeDomain('8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeDomain('[2001:4860:4860::8888]'), '2001:4860:4860::8888');
});

test('rejects empty, whitespace, URL, port-bearing, malformed, and overlong domains', () => {
  for (const value of ['', '   ', 'https://example.com', 'example.com:443', 'example.com/path', 'a b.example', '.example.com', 'example..com']) {
    assert.throws(() => normalizeDomain(value));
  }
  assert.throws(() => normalizeDomain(`${'a'.repeat(64)}.example`));
  assert.throws(() => normalizeDomain('a'.repeat(254)));
});

test('rejects private, loopback, link-local, multicast, and unspecified IP literals', () => {
  for (const value of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '224.0.0.1', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1']) {
    assert.throws(() => normalizeDomain(value));
  }
});

test('normalizes and validates strict port boundaries', () => {
  assert.equal(parsePort(undefined, 443), 443);
  assert.equal(parsePort('1', 443), 1);
  assert.equal(parsePort('65535', 443), 65535);
  for (const value of ['', '0', '-1', '65536', '1.5', '1e3', 'abc', ' 22 ']) {
    assert.throws(() => parsePort(value, 443));
  }
});

test('normalizes supported record types and rejects unsupported values', () => {
  assert.deepEqual(DNS_RECORD_TYPES, ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME']);
  for (const type of DNS_RECORD_TYPES) assert.equal(normalizeDnsType(type.toLowerCase()), type);
  for (const value of ['', 'ANY', 'SOA', 'a ', 'A\n']) assert.throws(() => normalizeDnsType(value));
});

test('accepts only public IPv4 and IPv6 nameservers', () => {
  assert.equal(normalizeNameserver(undefined), '1.1.1.1');
  assert.equal(normalizeNameserver('8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeNameserver('2001:4860:4860::8888'), '2001:4860:4860::8888');
  for (const value of ['localhost', 'dns.google', '8.8.8.8:53', 'https://1.1.1.1', '127.0.0.1', '10.0.0.1', '::1', '']) {
    assert.throws(() => normalizeNameserver(value));
  }
});
