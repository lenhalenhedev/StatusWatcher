import { lookup as defaultWhoisLookup } from 'whois';
import { normalizeDomain } from '../utils/checkNetworkInput.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_VALUE_LENGTH = 512;
const MAX_VALUES_PER_FIELD = 10;
const SAFE_ERROR_CODES = new Set([
  'INVALID_DOMAIN',
  'FORBIDDEN_ADDRESS',
  'WHOIS_RESPONSE_INVALID',
  'WHOIS_TIMEOUT',
]);

const FIELD_DEFINITIONS = new Map([
  ['domain', ['domainName', false]],
  ['domain name', ['domainName', false]],
  ['registry domain id', ['registryDomainId', false]],
  ['registrar', ['registrar', true]],
  ['registrar iana id', ['registrarIanaId', true]],
  ['registrar url', ['registrarUrl', true]],
  ['whois server', ['whoisServer', true]],
  ['registrar whois server', ['whoisServer', true]],
  ['creation date', ['creationDate', true]],
  ['created date', ['creationDate', true]],
  ['created on', ['creationDate', true]],
  ['updated date', ['updatedDate', true]],
  ['updated on', ['updatedDate', true]],
  ['registry expiry date', ['registryExpiryDate', true]],
  ['expiration date', ['registryExpiryDate', true]],
  ['expiry date', ['registryExpiryDate', true]],
  ['registrar registration expiration date', ['registrarRegistrationExpirationDate', true]],
  ['registrar registration expiry date', ['registrarRegistrationExpirationDate', true]],
  ['domain status', ['domainStatus', true]],
  ['name server', ['nameServer', true]],
  ['nameserver', ['nameServer', true]],
  ['dnssec', ['dnssec', true]],
  ['registrant country', ['registrantCountry', true]],
]);

function safeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeValue(value) {
  const normalized = String(value ?? '')
    .replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`*_~|<>]/g, '')
    .replace(/@/g, '＠')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > MAX_VALUE_LENGTH
    ? `${normalized.slice(0, MAX_VALUE_LENGTH - 3)}...`
    : normalized;
}

function normalizePayload(payload) {
  if (typeof payload === 'string') return [payload];
  if (!Array.isArray(payload) || payload.length === 0) {
    throw safeError('WHOIS_RESPONSE_INVALID', 'The WHOIS response was invalid.');
  }
  if (payload.some((part) => !part || typeof part !== 'object' || typeof part.data !== 'string')) {
    throw safeError('WHOIS_RESPONSE_INVALID', 'The WHOIS response was invalid.');
  }
  return payload.map((part) => part.data);
}

function addFieldValue(fields, key, value) {
  if (!value) return;
  if (!fields[key]) fields[key] = [];
  if (fields[key].includes(value) || fields[key].length >= MAX_VALUES_PER_FIELD) return;
  fields[key].push(value);
}

function parseResponse(payload) {
  const fields = {};
  for (const response of normalizePayload(payload)) {
    for (const line of response.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator <= 0) continue;
      const label = line.slice(0, separator).replace(/\s+/g, ' ').trim().toLowerCase();
      const definition = FIELD_DEFINITIONS.get(label);
      if (!definition) continue;
      const [key, isArray] = definition;
      const value = safeValue(line.slice(separator + 1));
      if (!value) continue;
      if (isArray) addFieldValue(fields, key, value);
      else if (!fields[key]) fields[key] = value;
    }
  }
  return fields;
}

function requestWhois(lookup, domain, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(safeError('WHOIS_TIMEOUT', 'The WHOIS lookup timed out.'));
    }, timeoutMs);

    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(payload);
    };

    try {
      lookup(domain, { follow: 0, timeout: timeoutMs, verbose: false }, finish);
    } catch (error) {
      finish(error);
    }
  });
}

export async function lookupWhois(domain, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  WhoisLookup = defaultWhoisLookup,
} = {}) {
  const normalizedDomain = normalizeDomain(domain);
  const safeTimeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;

  try {
    const payload = await requestWhois(WhoisLookup, normalizedDomain, safeTimeout);
    return parseResponse(payload);
  } catch (error) {
    if (SAFE_ERROR_CODES.has(error?.code)) throw error;
    throw safeError('WHOIS_LOOKUP_FAILED', 'The WHOIS lookup failed.');
  }
}

export const WHOIS_CHECK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export const WHOIS_MAX_VALUE_LENGTH = MAX_VALUE_LENGTH;
export const WHOIS_MAX_VALUES_PER_FIELD = MAX_VALUES_PER_FIELD;
