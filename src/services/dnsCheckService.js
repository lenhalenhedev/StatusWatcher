import DNS from 'dns2';
import { normalizeDnsType, normalizeDomain, normalizeNameserver } from '../utils/checkNetworkInput.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_ANSWERS = 50;
const MAX_VALUE_LENGTH = 512;

function safeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeValue(value) {
  const normalized = String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
  if (!normalized || normalized.length > MAX_VALUE_LENGTH) throw safeError('DNS_RESPONSE_INVALID', 'The DNS response contained an invalid record.');
  return normalized;
}

function normalizeAnswer(type, answer) {
  if (!answer || typeof answer !== 'object') throw safeError('DNS_RESPONSE_INVALID', 'The DNS response contained an invalid record.');
  if (type === 'A' || type === 'AAAA') return safeValue(answer.address);
  if (type === 'MX') {
    const exchange = safeValue(answer.exchange);
    const priority = Number(answer.priority);
    if (!Number.isSafeInteger(priority) || priority < 0 || priority > 65_535) throw safeError('DNS_RESPONSE_INVALID', 'The DNS response contained an invalid mail-exchange priority.');
    return { exchange, priority };
  }
  if (type === 'TXT') {
    const data = Array.isArray(answer.data) ? answer.data.join('') : answer.data;
    return safeValue(data);
  }
  return safeValue(answer.domain || answer.exchange || answer.name);
}

function mapDnsError() {
  return safeError('DNS_QUERY_FAILED', 'The DNS query failed or timed out.');
}

function queryMethod(client, domain, type) {
  if (type === 'A' && typeof client.resolveA === 'function') return client.resolveA(domain);
  if (type === 'AAAA' && typeof client.resolveAAAA === 'function') return client.resolveAAAA(domain);
  if (type === 'MX' && typeof client.resolveMX === 'function') return client.resolveMX(domain);
  if (type === 'CNAME' && typeof client.resolveCNAME === 'function') return client.resolveCNAME(domain);
  if (typeof client.resolve === 'function') return client.resolve(domain, type);
  throw safeError('DNS_CLIENT_INVALID', 'The DNS client does not support the requested record type.');
}

export async function queryDnsRecords(domain, {
  type = 'A',
  nameserver = '1.1.1.1',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  DnsClient = DNS,
} = {}) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedType = normalizeDnsType(type);
  const normalizedNameserver = normalizeNameserver(nameserver);
  let client;
  try {
    client = new DnsClient({
      nameServers: [normalizedNameserver],
      port: 53,
      recursive: true,
      timeout: timeoutMs,
    });
    let timeoutHandle;
    try {
      const response = await Promise.race([
        queryMethod(client, normalizedDomain, normalizedType),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(safeError('DNS_TIMEOUT', 'The DNS query timed out.')), timeoutMs);
        }),
      ]);
      if (!response || !Array.isArray(response.answers) || response.answers.length > MAX_ANSWERS) {
        throw safeError('DNS_RESPONSE_INVALID', 'The DNS response was invalid.');
      }
      return {
        type: normalizedType,
        nameserver: normalizedNameserver,
        answers: response.answers.map((answer) => normalizeAnswer(normalizedType, answer)),
        answerCount: response.answers.length,
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

  } catch (error) {
    if (['INVALID_DOMAIN', 'FORBIDDEN_ADDRESS', 'INVALID_NAMESERVER', 'INVALID_DNS_TYPE', 'DNS_RESPONSE_INVALID', 'DNS_CLIENT_INVALID'].includes(error?.code)) throw error;
    if (error?.code === 'DNS_TIMEOUT') throw error;
    throw mapDnsError();
  }
}

export const DNS_CHECK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
