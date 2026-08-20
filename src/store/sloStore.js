import db from '../utils/db.js';

const SERVICE_TYPES = new Set(['bot', 'minecraft', 'website', 'database']);
const ID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;
const POLICY = new Set(['include', 'exclude']);

const upsertSlo = db.prepare(`
  INSERT INTO slos (service_type, service_id, target_percent, window_days, maintenance_policy, created_by, updated_at)
  VALUES (@serviceType, @serviceId, @targetPercent, @windowDays, @maintenancePolicy, @createdBy, @updatedAt)
  ON CONFLICT(service_type, service_id) DO UPDATE SET
    target_percent = excluded.target_percent,
    window_days = excluded.window_days,
    maintenance_policy = excluded.maintenance_policy,
    created_by = excluded.created_by,
    updated_at = excluded.updated_at
`);
const getSloStatement = db.prepare('SELECT id, service_type, service_id, target_percent, window_days, maintenance_policy, created_by, updated_at FROM slos WHERE service_type = @serviceType AND service_id = @serviceId');
const listSloStatement = db.prepare('SELECT id, service_type, service_id, target_percent, window_days, maintenance_policy, created_by, updated_at FROM slos ORDER BY id ASC LIMIT @limit');
const deleteSloStatement = db.prepare('DELETE FROM slos WHERE service_type = @serviceType AND service_id = @serviceId');

function normalizeType(value) { const type = String(value ?? '').trim().toLowerCase(); return SERVICE_TYPES.has(type) ? type : null; }
function normalizeId(value) { const id = String(value ?? '').trim(); return ID_PATTERN.test(id) ? id : null; }

export function setSlo({ serviceType, serviceId, targetPercent, windowDays = 30, maintenancePolicy = 'include', createdBy, updatedAt = Date.now() } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  const target = Number(targetPercent);
  const days = Number(windowDays);
  const actor = normalizeId(createdBy);
  if (!type || !id || !Number.isFinite(target) || target <= 0 || target > 100 || !Number.isInteger(days) || days < 1 || days > 366 || !POLICY.has(maintenancePolicy) || !actor || !Number.isInteger(updatedAt)) return null;
  upsertSlo.run({ serviceType: type, serviceId: id, targetPercent: target, windowDays: days, maintenancePolicy, createdBy: actor, updatedAt });
  return getSlo({ serviceType: type, serviceId: id });
}

export function getSlo({ serviceType, serviceId } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  return type && id ? getSloStatement.get({ serviceType: type, serviceId: id }) ?? null : null;
}

export function listSlos(limit = 100) {
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1_000) : 100;
  return listSloStatement.all({ limit: bounded });
}

export function deleteSlo({ serviceType, serviceId } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  return type && id ? deleteSloStatement.run({ serviceType: type, serviceId: id }).changes === 1 : false;
}
