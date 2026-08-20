import { buildIncidentKey } from './incidentKey.js';

export const INCIDENT_STATUS = Object.freeze({
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
});

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

const EVENT_TYPES = new Set(['ONLINE', 'DOWN', 'STILL_DOWN', 'UP']);
const TIMELINE_TYPES = Object.freeze({
  DETECTED: 'DETECTED',
  NOTIFIED: 'NOTIFIED',
  UPDATE: 'UPDATE',
  RESOLVED: 'RESOLVED',
});

function safeErrorCategory(value) {
  return SAFE_ERROR_CATEGORIES.has(value) ? value : 'UNKNOWN';
}

function normalizeEvent(input) {
  const eventType = EVENT_TYPES.has(input?.eventType) ? input.eventType : null;
  return {
    serviceId: String(input?.serviceId ?? 'unknown').slice(0, 200),
    serviceType: String(input?.serviceType ?? 'unknown').slice(0, 32),
    name: String(input?.name ?? 'Unknown service').replace(/[\r\n]/g, ' ').slice(0, 200),
    eventType,
    occurredAt: Number.isFinite(input?.occurredAt) ? input.occurredAt : Date.now(),
    confirmedDownAt: Number.isFinite(input?.confirmedDownAt) ? input.confirmedDownAt : null,
    downSince: Number.isFinite(input?.downSince) ? input.downSince : null,
    errorCategory: input?.errorCategory ? safeErrorCategory(input.errorCategory) : null,
    statusCode: Number.isInteger(input?.statusCode) ? input.statusCode : null,
    durationMs: Number.isFinite(input?.durationMs) ? Math.max(0, Math.min(input.durationMs, 86_400_000)) : null,
    dependencyGroupId: null,
  };
}

function incidentPatchFromEvent(event, status) {
  return {
    status,
    updatedAt: event.occurredAt,
    lastEventType: event.eventType,
    errorCategory: event.errorCategory,
    statusCode: event.statusCode,
    downSince: event.downSince,
  };
}

function timelinePayload(incident, event, eventType, extra = {}) {
  return {
    incidentId: incident.id,
    incidentKey: incident.incidentKey,
    eventType,
    occurredAt: event.occurredAt,
    serviceType: event.serviceType,
    serviceId: event.serviceId,
    errorCategory: event.errorCategory,
    statusCode: event.statusCode,
    durationMs: event.durationMs,
    ...extra,
  };
}

/**
 * Incident orchestration stays independent from Discord and network clients.
 * The store boundary is deliberately injected for deterministic tests and for
 * future transaction-backed implementations.
 */
export function createIncidentManager({ store, now = () => Date.now() }) {
  if (!store || typeof store.getOpenIncident !== 'function') {
    throw new TypeError('Incident store is required.');
  }

  function handleTransition(input) {
    const event = normalizeEvent(input);
    if (!event.eventType || event.eventType === 'ONLINE') {
      return { incident: null, shouldNotify: false, event };
    }

    const incidentKey = buildIncidentKey(event);
    let incident = store.getOpenIncident(incidentKey);

    if (event.eventType === 'DOWN') {
      if (!incident) {
        incident = store.createIncident({
          incidentKey,
          serviceId: event.serviceId,
          serviceType: event.serviceType,
          name: event.name,
          status: INCIDENT_STATUS.OPEN,
          openedAt: event.occurredAt || now(),
          updatedAt: event.occurredAt || now(),
          resolvedAt: null,
          errorCategory: event.errorCategory,
          statusCode: event.statusCode,
          downSince: event.downSince,
          lastEventType: event.eventType,
        });
        store.appendIncidentEvent(timelinePayload(incident, event, TIMELINE_TYPES.DETECTED));
        store.appendIncidentEvent(timelinePayload(incident, event, TIMELINE_TYPES.NOTIFIED));
        return { incident, shouldNotify: true, event };
      }

      store.updateIncident(incident.id, incidentPatchFromEvent(event, INCIDENT_STATUS.OPEN));
      return { incident: { ...incident, ...incidentPatchFromEvent(event, INCIDENT_STATUS.OPEN) }, shouldNotify: false, event };
    }

    if (event.eventType === 'STILL_DOWN') {
      if (!incident) return { incident: null, shouldNotify: false, event };
      const patch = incidentPatchFromEvent(event, incident.status === INCIDENT_STATUS.ACKNOWLEDGED
        ? INCIDENT_STATUS.ACKNOWLEDGED
        : INCIDENT_STATUS.OPEN);
      store.updateIncident(incident.id, patch);
      const updated = { ...incident, ...patch };
      store.appendIncidentEvent(timelinePayload(updated, event, TIMELINE_TYPES.UPDATE));
      return { incident: updated, shouldNotify: false, event };
    }

    if (event.eventType === 'UP') {
      if (!incident) return { incident: null, shouldNotify: false, event };
      const patch = {
        ...incidentPatchFromEvent(event, INCIDENT_STATUS.RESOLVED),
        resolvedAt: event.occurredAt || now(),
      };
      store.updateIncident(incident.id, patch);
      const resolved = { ...incident, ...patch };
      store.appendIncidentEvent(timelinePayload(resolved, event, TIMELINE_TYPES.RESOLVED, { reason: 'HEALTH_RECOVERY' }));
      return { incident: resolved, shouldNotify: true, event };
    }

    return { incident, shouldNotify: false, event };
  }

  return { handleTransition };
}

export { SAFE_ERROR_CATEGORIES, safeErrorCategory };
