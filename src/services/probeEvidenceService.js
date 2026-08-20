import { appendLatencySample } from '../store/latencyStore.js';

const EVENT_TYPES = new Set(['ONLINE', 'UP', 'DOWN', 'STILL_DOWN']);

function statusFor({ success, eventType }) {
  if (EVENT_TYPES.has(eventType)) return eventType;
  return success ? 'ONLINE' : 'PENDING';
}

export function recordProbeEvidence({
  serviceId,
  serviceType,
  observedAt = Date.now(),
  durationMs = 0,
  success,
  statusCode = null,
  eventType = null,
  errorCategory = null,
  retryIndex = 0,
} = {}) {
  return appendLatencySample({
    serviceId,
    serviceType,
    observedAt,
    durationMs,
    success,
    statusCode,
    probeStatus: statusFor({ success, eventType }),
    errorCategory,
    retryIndex,
  });
}
