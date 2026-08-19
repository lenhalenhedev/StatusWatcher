import net from 'node:net';
import { domainToASCII } from 'node:url';

export const DNS_RECORD_TYPES = Object.freeze(['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME']);
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function ipv4ToNumber(value) {
  return value.split('.').reduce((result, octet) => result * 256 + Number(octet), 0);
}

function ipv4InRange(value, start, end) {
  const number = ipv4ToNumber(value);
  return number >= start && number <= end;
}

function parseIpv6(value) {
  if (value.includes('%')) return null;
  const normalized = value.toLowerCase();
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const expand = halves.length === 2;
  const all = [...left, ...right];
  if (all.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if ((!expand && all.length !== 8) || (expand && all.length >= 8)) return null;
  const words = expand ? [...left, ...Array(8 - all.length).fill('0'), ...right] : all;
  return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}

function ipv6InRange(value, prefix, bits) {
  return (value >> BigInt(128 - prefix)) === (bits >> BigInt(128 - prefix));
}

export function isForbiddenAddress(value) {
  const kind = net.isIP(value);
  if (kind === 4) {
    return [
      [0x00000000, 0x00ffffff],
      [0x0a000000, 0x0affffff],
      [0x64400000, 0x647fffff],
      [0x7f000000, 0x7fffffff],
      [0xa9fe0000, 0xa9feffff],
      [0xac100000, 0xac1fffff],
      [0xc0000000, 0xc00000ff],
      [0xc0000200, 0xc00002ff],
      [0xc0a80000, 0xc0a8ffff],
      [0xc6120000, 0xc613ffff],
      [0xc6336400, 0xc63364ff],
      [0xcb007100, 0xcb0071ff],
      [0xe0000000, 0xffffffff],
    ].some(([start, end]) => ipv4InRange(value, start, end));
  }
  if (kind !== 6) return false;
  const parsed = parseIpv6(value);
  if (parsed === null) return true;
  const mapped = parsed >> 32n;
  if (mapped === 0xffffn) {
    const mappedIpv4 = [24n, 16n, 8n, 0n].map((shift) => Number((parsed >> shift) & 255n)).join('.');
    return isForbiddenAddress(mappedIpv4);
  }
  return [
    [128, 0n],
    [128, 1n],
    [7, 0xfc000000000000000000000000000000n],
    [10, 0xfe800000000000000000000000000000n],
    [8, 0xff000000000000000000000000000000n],
    [32, 0x20010db8000000000000000000000000n],
  ].some(([prefix, bits]) => ipv6InRange(parsed, prefix, bits));
}

export function normalizeDomain(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > MAX_DOMAIN_LENGTH + 1) {
    fail('INVALID_DOMAIN', 'Domain must be a trimmed hostname or IP address.');
  }
  const candidate = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const unbracketed = candidate;
  if (net.isIP(unbracketed)) {
    if (isForbiddenAddress(unbracketed)) fail('FORBIDDEN_ADDRESS', 'Private or reserved addresses are not allowed.');
    return unbracketed;
  }
  if (/\s|[\u0000-\u001f\u007f]|[/:?#@]/.test(candidate)) {
    fail('INVALID_DOMAIN', 'Domain must not contain whitespace, a URL scheme, a path, a port, or credentials.');
  }
  const withoutRootDot = value.endsWith('.') ? value.slice(0, -1) : value;
  const ascii = domainToASCII(withoutRootDot).toLowerCase();
  if (!ascii || ascii.length > MAX_DOMAIN_LENGTH || isForbiddenAddress(ascii)) {
    fail('INVALID_DOMAIN', 'Domain must be a valid public hostname.');
  }
  const labels = ascii.split('.');
  if (labels.some((label) => label.length === 0 || label.length > MAX_LABEL_LENGTH || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    fail('INVALID_DOMAIN', 'Domain must be a valid public hostname.');
  }
  return ascii;
}

export function parsePort(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw);
  if (!/^\d+$/.test(value)) fail('INVALID_PORT', 'Port must be an integer between 1 and 65535.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail('INVALID_PORT', 'Port must be an integer between 1 and 65535.');
  return port;
}

export function normalizeDnsType(raw) {
  const value = String(raw ?? '').toUpperCase();
  if (!DNS_RECORD_TYPES.includes(value) || value !== String(raw ?? '').toUpperCase() || String(raw ?? '').trim() !== String(raw ?? '')) {
    fail('INVALID_DNS_TYPE', `Record type must be one of: ${DNS_RECORD_TYPES.join(', ')}.`);
  }
  return value;
}

export function normalizeNameserver(raw) {
  const value = raw === undefined || raw === null ? '1.1.1.1' : String(raw);
  const unbracketed = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (!net.isIP(unbracketed) || isForbiddenAddress(unbracketed)) {
    fail('INVALID_NAMESERVER', 'Nameserver must be a public IPv4 or IPv6 address.');
  }
  return unbracketed;
}
