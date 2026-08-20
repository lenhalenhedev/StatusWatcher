import db from '../utils/db.js';

const SERVICE_TYPES = new Set(['bot', 'minecraft', 'website', 'database']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_REASON_LENGTH = 500;
const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;

const stmtActive = db.prepare(`
  SELECT * FROM maintenance_windows
  WHERE service_id = ? AND service_type = ? AND starts_at <= ? AND ends_at > ?
  ORDER BY ends_at DESC, id DESC LIMIT 1
`);
const stmtList = db.prepare(`
  SELECT * FROM maintenance_windows
  WHERE (? = 1 OR ends_at > ?)
  ORDER BY starts_at ASC, id ASC LIMIT ?
`);
const stmtInsert = db.prepare(`
  INSERT INTO maintenance_windows
    (service_id, service_type, starts_at, ends_at, reason, created_by, created_at)
  VALUES (@serviceId, @serviceType, @startsAt, @endsAt, @reason, @createdBy, @createdAt)
`);
const stmtDelete = db.prepare('DELETE FROM maintenance_windows WHERE id = ?');

function normalizeService(serviceId, serviceType) {
  const id = String(serviceId ?? '').trim();
  const type = String(serviceType ?? '').trim();
  if (!SAFE_IDENTIFIER.test(id) || !SERVICE_TYPES.has(type)) return null;
  return { id, type };
}

export function isInMaintenance(serviceId, serviceType, at = Date.now()) {
  const service = normalizeService(serviceId, serviceType);
  if (!service || !Number.isFinite(at)) return false;
  return Boolean(stmtActive.get(service.id, service.type, at, at));
}

export function scheduleWindow({ serviceId, serviceType, startsAt, endsAt, reason, createdBy, createdAt = Date.now() }) {
  const service = normalizeService(serviceId, serviceType);
  const start = Number(startsAt);
  const end = Number(endsAt);
  const text = String(reason ?? '').replace(/[\r\n]/g, ' ').trim();
  const actor = String(createdBy ?? '').trim();
  if (!service || !Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  if (end - start > MAX_WINDOW_MS || !text || text.length > MAX_REASON_LENGTH || !SAFE_IDENTIFIER.test(actor)) return null;
  const result = stmtInsert.run({
    serviceId: service.id,
    serviceType: service.type,
    startsAt: start,
    endsAt: end,
    reason: text,
    createdBy: actor,
    createdAt: Number.isInteger(createdAt) ? createdAt : Date.now(),
  });
  return db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(result.lastInsertRowid);
}

export function cancelWindow(id) {
  const result = stmtDelete.run(Number(id));
  return result.changes === 1;
}

export function listMaintenanceWindows({ includeExpired = false, now = Date.now(), limit = 100 } = {}) {
  const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 100;
  return stmtList.all(includeExpired ? 1 : 0, now, boundedLimit);
}

export { MAX_REASON_LENGTH, MAX_WINDOW_MS, SERVICE_TYPES };
