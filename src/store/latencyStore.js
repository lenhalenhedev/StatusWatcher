import db from '../utils/db.js';

const SERVICE_TYPES = new Set(['bot', 'minecraft', 'website', 'database']);
export const PROBE_STATUSES = Object.freeze(['ONLINE', 'PENDING', 'DOWN', 'STILL_DOWN', 'UP', 'ERROR']);
const PROBE_STATUS_SET = new Set(PROBE_STATUSES);
const SAFE_ERROR_CATEGORIES = new Set([
  'HTTP_STATUS_FAILURE',
  'HTTP_TIMEOUT',
  'DNS_FAILURE',
  'TLS_HANDSHAKE_FAILED',
  'TLS_CERTIFICATE_ERROR',
  'DATABASE_CONNECTION_FAILED',
  'DATABASE_TIMEOUT',
  'MINECRAFT_CONNECTION_FAILED',
  'WHOIS_LOOKUP_FAILED',
  'UNKNOWN',
]);
const MAX_ID_LENGTH = 200;
const MAX_DURATION_MS = 600_000;
const MAX_SAMPLES_PER_SERVICE = 5_000;
const MAX_RETRY_INDEX = 100;

function safeServiceType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return SERVICE_TYPES.has(type) ? type : null;
}

function safeServiceId(value) {
  const id = String(value ?? '').trim();
  return id && id.length <= MAX_ID_LENGTH ? id : null;
}

function safeTimestamp(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeStatusCode(value) {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeProbeStatus(value, success) {
  if (value === null || value === undefined) return success ? 'ONLINE' : 'ERROR';
  return typeof value === 'string' && PROBE_STATUS_SET.has(value) ? value : null;
}

function safeErrorCategory(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && SAFE_ERROR_CATEGORIES.has(value) ? value : undefined;
}

function safeRetryIndex(value) {
  if (value === null || value === undefined) return 0;
  return Number.isInteger(value) && value >= 0 && value <= MAX_RETRY_INDEX ? value : null;
}

const insertSample = db.prepare(`
  INSERT INTO latency_samples (
    service_id, service_type, observed_at, duration_ms, success, status_code,
    probe_status, error_category, retry_index
  )
  VALUES (@serviceId, @serviceType, @observedAt, @durationMs, @success, @statusCode,
    @probeStatus, @errorCategory, @retryIndex)
`);
const selectSamples = db.prepare(`
  SELECT id, service_id, service_type, observed_at, duration_ms, success, status_code,
         probe_status, error_category, retry_index
  FROM latency_samples
  WHERE service_id = @serviceId AND service_type = @serviceType
    AND (@startAt IS NULL OR observed_at >= @startAt)
    AND (@endAt IS NULL OR observed_at < @endAt)
  ORDER BY observed_at ASC, id ASC
  LIMIT @limit
`);
const deleteBefore = db.prepare('DELETE FROM latency_samples WHERE observed_at < @before');
const selectAllSamples = db.prepare(`
  SELECT id, service_id, service_type, observed_at, duration_ms, success, status_code,
         probe_status, error_category, retry_index
  FROM latency_samples
  WHERE observed_at >= @startAt AND observed_at < @endAt
  ORDER BY observed_at ASC, id ASC
  LIMIT @limit
`);
const trimServiceSamples = db.prepare(`
  DELETE FROM latency_samples
  WHERE service_id = @serviceId AND service_type = @serviceType
    AND id NOT IN (
      SELECT id FROM latency_samples
      WHERE service_id = @serviceId AND service_type = @serviceType
      ORDER BY observed_at DESC, id DESC LIMIT @cap
    )
`);

export function appendLatencySample({
  serviceId,
  serviceType,
  observedAt = Date.now(),
  durationMs,
  success,
  statusCode = null,
  probeStatus = null,
  errorCategory = null,
  retryIndex = 0,
}) {
  const id = safeServiceId(serviceId);
  const type = safeServiceType(serviceType);
  const timestamp = safeTimestamp(observedAt);
  const duration = Number(durationMs);
  const normalizedStatus = safeProbeStatus(probeStatus, success);
  const normalizedCategory = safeErrorCategory(errorCategory);
  const normalizedRetryIndex = safeRetryIndex(retryIndex);

  if (!id || !type || timestamp === null || !Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_MS) return null;
  if (typeof success !== 'boolean' || normalizedStatus === null || normalizedCategory === undefined || normalizedRetryIndex === null) return null;
  if (success && normalizedStatus !== 'ONLINE' && normalizedStatus !== 'UP') return null;
  if (!success && normalizedStatus === 'ONLINE') return null;

  const write = db.transaction(() => {
    const result = insertSample.run({
      serviceId: id,
      serviceType: type,
      observedAt: timestamp,
      durationMs: Math.round(duration),
      success: success ? 1 : 0,
      statusCode: safeStatusCode(statusCode),
      probeStatus: normalizedStatus,
      errorCategory: normalizedCategory,
      retryIndex: normalizedRetryIndex,
    });
    trimServiceSamples.run({ serviceId: id, serviceType: type, cap: MAX_SAMPLES_PER_SERVICE });
    return result;
  });
  const result = write();
  return {
    id: result.lastInsertRowid,
    serviceId: id,
    serviceType: type,
    observedAt: timestamp,
    durationMs: Math.round(duration),
    success: Boolean(success),
    statusCode: safeStatusCode(statusCode),
    probeStatus: normalizedStatus,
    errorCategory: normalizedCategory,
    retryIndex: normalizedRetryIndex,
  };
}

export function listLatencySamples({ serviceId, serviceType, startAt = null, endAt = null, limit = 1000 } = {}) {
  const id = safeServiceId(serviceId);
  const type = safeServiceType(serviceType);
  if (!id || !type) return [];
  const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 5000) : 1000;
  return selectSamples.all({ serviceId: id, serviceType: type, startAt: safeTimestamp(startAt), endAt: safeTimestamp(endAt), limit: boundedLimit });
}

export function listLatencySamplesInWindow({ startAt, endAt, limit = 5000 } = {}) {
  if (safeTimestamp(startAt) === null || safeTimestamp(endAt) === null || startAt >= endAt) return [];
  const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 10_000) : 5000;
  return selectAllSamples.all({ startAt, endAt, limit: boundedLimit });
}

export function pruneLatencySamples({ before = Date.now() } = {}) {
  const timestamp = safeTimestamp(before);
  if (timestamp === null) return 0;
  return deleteBefore.run({ before: timestamp }).changes;
}
