import db from '../utils/db.js';
import { INCIDENT_STATUS } from '../incidents/incidentManager.js';

const stmtGetOpen = db.prepare(`
  SELECT * FROM incidents
  WHERE incident_key = ? AND status IN ('OPEN', 'ACKNOWLEDGED')
  ORDER BY id DESC LIMIT 1
`);
const stmtInsertIncident = db.prepare(`
  INSERT INTO incidents (
    incident_key, service_id, service_type, name, status, opened_at, updated_at,
    resolved_at, error_category, status_code, down_since
  ) VALUES (@incidentKey, @serviceId, @serviceType, @name, @status, @openedAt,
    @updatedAt, @resolvedAt, @errorCategory, @statusCode, @downSince)
`);
const stmtUpdateIncident = db.prepare(`
  UPDATE incidents SET
    status = COALESCE(@status, status),
    updated_at = COALESCE(@updatedAt, updated_at),
    resolved_at = COALESCE(@resolvedAt, resolved_at),
    error_category = COALESCE(@errorCategory, error_category),
    status_code = COALESCE(@statusCode, status_code),
    down_since = COALESCE(@downSince, down_since),
    acknowledged_by = COALESCE(@acknowledgedBy, acknowledged_by),
    acknowledged_at = COALESCE(@acknowledgedAt, acknowledged_at),
    communication_resolved_by = COALESCE(@communicationResolvedBy, communication_resolved_by),
    communication_resolved_at = COALESCE(@communicationResolvedAt, communication_resolved_at)
  WHERE id = @id
`);
const stmtInsertEvent = db.prepare(`
  INSERT INTO incident_events (
    incident_id, incident_key, event_type, occurred_at, service_type,
    service_id, error_category, status_code, duration_ms, reason, actor_id
  ) VALUES (@incidentId, @incidentKey, @eventType, @occurredAt, @serviceType,
    @serviceId, @errorCategory, @statusCode, @durationMs, @reason, @actorId)
`);
const stmtRecentEvents = db.prepare(`
  SELECT * FROM incident_events WHERE incident_id = ?
  ORDER BY occurred_at ASC, id ASC LIMIT ?
`);
const stmtRecentIncidents = db.prepare(`
  SELECT * FROM incidents ORDER BY updated_at DESC, id DESC LIMIT ?
`);
const stmtWindowIncidents = db.prepare(`
  SELECT * FROM incidents
  WHERE opened_at < @endAt AND (resolved_at IS NULL OR resolved_at >= @startAt)
  ORDER BY opened_at ASC, id ASC LIMIT @limit
`);

function nullable(value) {
  return value === undefined ? null : value;
}

export function getIncident(id) {
  return db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) ?? null;
}

export function getOpenIncident(incidentKey) {
  return stmtGetOpen.get(String(incidentKey)) ?? null;
}

export function createIncident(record) {
  const result = stmtInsertIncident.run({
    incidentKey: String(record.incidentKey),
    serviceId: String(record.serviceId),
    serviceType: String(record.serviceType),
    name: String(record.name).slice(0, 200),
    status: record.status ?? INCIDENT_STATUS.OPEN,
    openedAt: Number(record.openedAt),
    updatedAt: Number(record.updatedAt),
    resolvedAt: nullable(record.resolvedAt),
    errorCategory: nullable(record.errorCategory),
    statusCode: nullable(record.statusCode),
    downSince: nullable(record.downSince),
  });
  return db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
}

export function updateIncident(id, patch = {}) {
  stmtUpdateIncident.run({
    id,
    status: nullable(patch.status),
    updatedAt: nullable(patch.updatedAt),
    resolvedAt: nullable(patch.resolvedAt),
    errorCategory: nullable(patch.errorCategory),
    statusCode: nullable(patch.statusCode),
    downSince: nullable(patch.downSince),
    acknowledgedBy: nullable(patch.acknowledgedBy),
    acknowledgedAt: nullable(patch.acknowledgedAt),
    communicationResolvedBy: nullable(patch.communicationResolvedBy),
    communicationResolvedAt: nullable(patch.communicationResolvedAt),
  });
  return db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) ?? null;
}

export function appendIncidentEvent(event) {
  const result = stmtInsertEvent.run({
    incidentId: event.incidentId,
    incidentKey: String(event.incidentKey),
    eventType: String(event.eventType),
    occurredAt: Number(event.occurredAt),
    serviceType: String(event.serviceType),
    serviceId: String(event.serviceId),
    errorCategory: nullable(event.errorCategory),
    statusCode: nullable(event.statusCode),
    durationMs: nullable(event.durationMs),
    reason: nullable(event.reason),
    actorId: nullable(event.actorId),
  });
  return db.prepare('SELECT * FROM incident_events WHERE id = ?').get(result.lastInsertRowid);
}

export function getIncidentTimeline(incidentId, limit = 100) {
  const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 100;
  return stmtRecentEvents.all(incidentId, bounded);
}

export function listRecentIncidents(limit = 25) {
  const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 25;
  return stmtRecentIncidents.all(bounded);
}

export function listIncidentsInWindow({ startAt, endAt, limit = 1000 } = {}) {
  if (!Number.isInteger(startAt) || !Number.isInteger(endAt) || startAt >= endAt) return [];
  const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 5000)) : 1000;
  return stmtWindowIncidents.all({ startAt, endAt, limit: bounded });
}

export function acknowledgeIncident(id, actorId, occurredAt = Date.now()) {
  const incident = getIncident(id);
  if (!incident || incident.status !== INCIDENT_STATUS.OPEN) return null;
  const updated = updateIncident(id, {
    status: INCIDENT_STATUS.ACKNOWLEDGED,
    updatedAt: occurredAt,
    acknowledgedBy: String(actorId).slice(0, 64),
    acknowledgedAt: occurredAt,
  });
  appendIncidentEvent({
    incidentId: updated.id,
    incidentKey: updated.incident_key,
    eventType: 'ACKNOWLEDGED',
    occurredAt,
    serviceType: updated.service_type,
    serviceId: updated.service_id,
    errorCategory: updated.error_category,
    statusCode: updated.status_code,
    reason: 'COMMUNICATION_ACKNOWLEDGED',
    actorId: String(actorId).slice(0, 64),
  });
  return updated;
}

export function resolveIncidentCommunication(id, actorId, occurredAt = Date.now()) {
  const incident = getIncident(id);
  if (!incident || incident.status === INCIDENT_STATUS.RESOLVED || incident.communication_resolved_at) return null;
  const updated = updateIncident(id, {
    updatedAt: occurredAt,
    communicationResolvedBy: String(actorId).slice(0, 64),
    communicationResolvedAt: occurredAt,
  });
  appendIncidentEvent({
    incidentId: updated.id,
    incidentKey: updated.incident_key,
    eventType: 'COMMUNICATION_RESOLVED',
    occurredAt,
    serviceType: updated.service_type,
    serviceId: updated.service_id,
    errorCategory: updated.error_category,
    statusCode: updated.status_code,
    reason: 'COMMUNICATION_RESOLVED',
    actorId: String(actorId).slice(0, 64),
  });
  return updated;
}

export function pruneIncidentData(cutoffMs, eventCutoffMs = cutoffMs) {
  const prune = db.transaction(() => {
    const events = db.prepare('DELETE FROM incident_events WHERE occurred_at < ?').run(eventCutoffMs);
    const incidents = db.prepare("DELETE FROM incidents WHERE updated_at < ? AND status = 'RESOLVED'").run(cutoffMs);
    return { events: events.changes, incidents: incidents.changes };
  });
  return prune();
}
