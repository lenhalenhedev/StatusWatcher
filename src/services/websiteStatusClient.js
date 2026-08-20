import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { isForbiddenAddress } from '../utils/checkNetworkInput.js';

export const WEBSITE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_URL_LENGTH = 2_048;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeIpHost(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export function normalizeWebsiteUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw createError('INVALID_URL', 'Website URL is invalid.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw createError('INVALID_URL', 'Website URL is invalid.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
    throw createError('INVALID_URL', 'Website URL is invalid.');
  }

  const hostname = normalizeIpHost(url.hostname);
  if (net.isIP(hostname) && isForbiddenAddress(hostname)) {
    throw createError('FORBIDDEN_ADDRESS', 'Website address is not allowed.');
  }

  return url.toString();
}

export async function assertPublicDestination(urlString, lookupImpl = dnsLookup) {
  const url = new URL(urlString);
  const hostname = normalizeIpHost(url.hostname);
  if (net.isIP(hostname)) return;

  let addresses;
  try {
    addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw createError('DNS_ERROR', 'Website DNS lookup failed.');
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw createError('DNS_ERROR', 'Website DNS lookup failed.');
  }
  if (addresses.some((entry) => !entry || isForbiddenAddress(String(entry.address ?? '')))) {
    throw createError('FORBIDDEN_ADDRESS', 'Website address is not allowed.');
  }
}

function isTimeoutError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'TIMEOUT';
}

async function cancelBody(response) {
  try {
    const result = response?.body?.cancel?.();
    if (result && typeof result.then === 'function') await result;
  } catch {
    // The response is already bounded by status-only processing; ignore cancel errors.
  }
}

/**
 * Probe one administrator-configured website without reading its response body.
 * Validation errors are thrown for the caller to reject before persistence or monitoring.
 * Network and HTTP outcomes are returned as safe, category-only results.
 */
export async function validateWebsiteTarget(target, { lookupImpl = dnsLookup } = {}) {
  const url = normalizeWebsiteUrl(target?.url);
  await assertPublicDestination(url, lookupImpl);
  return url;
}

export async function checkWebsite(target, { lookupImpl = dnsLookup, fetchImpl = globalThis.fetch } = {}) {
  const startedAt = performance.now();
  const withDuration = (result) => ({
    ...result,
    durationMs: Math.min(WEBSITE_REQUEST_TIMEOUT_MS, Math.max(0, Math.round(performance.now() - startedAt))),
  });
  const url = await validateWebsiteTarget(target, { lookupImpl });

  if (typeof fetchImpl !== 'function') {
    return withDuration({ ok: false, status: null, code: 'NETWORK_ERROR', error: 'Network request failed' });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(WEBSITE_REQUEST_TIMEOUT_MS),
    });

    const status = Number(response?.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return withDuration({ ok: false, status: null, code: 'INVALID_RESPONSE', error: 'Invalid HTTP response' });
    }
    if (status >= 200 && status < 400) {
      return withDuration({ ok: true, status, code: 'HTTP_OK', error: null });
    }
    return withDuration({ ok: false, status, code: 'HTTP_ERROR', error: `HTTP status ${status}` });
  } catch (error) {
    if (isTimeoutError(error)) {
      return withDuration({ ok: false, status: null, code: 'TIMEOUT', error: 'Request timed out' });
    }
    return withDuration({ ok: false, status: null, code: 'NETWORK_ERROR', error: 'Network request failed' });
  } finally {
    await cancelBody(response);
  }
}
