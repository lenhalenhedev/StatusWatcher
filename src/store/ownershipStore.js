import db from '../utils/db.js';

const SERVICE_TYPES = new Set(['bot', 'minecraft', 'website', 'database']);
const ID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;
const upsertOwnership = db.prepare(`
  INSERT INTO service_ownership (service_type, service_id, role_id, updated_by, updated_at)
  VALUES (@serviceType, @serviceId, @roleId, @updatedBy, @updatedAt)
  ON CONFLICT(service_type, service_id) DO UPDATE SET
    role_id = excluded.role_id,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
`);
const selectOwnership = db.prepare('SELECT id, service_type, service_id, role_id, updated_by, updated_at FROM service_ownership WHERE service_type = @serviceType AND service_id = @serviceId');
const deleteOwnership = db.prepare('DELETE FROM service_ownership WHERE service_type = @serviceType AND service_id = @serviceId');

function normalizeType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return SERVICE_TYPES.has(type) ? type : null;
}
function normalizeId(value) {
  const id = String(value ?? '').trim();
  return ID_PATTERN.test(id) ? id : null;
}
function normalizeRole(value) {
  const role = String(value ?? '').trim();
  return /^\d{17,20}$/.test(role) ? role : null;
}

export function getOwnership({ serviceType, serviceId } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  return type && id ? selectOwnership.get({ serviceType: type, serviceId: id }) ?? null : null;
}

export function setOwnership({ serviceType, serviceId, roleId, updatedBy, updatedAt = Date.now() } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  const role = normalizeRole(roleId);
  const actor = normalizeId(updatedBy);
  if (!type || !id || !role || !actor || !Number.isInteger(updatedAt)) return null;
  upsertOwnership.run({ serviceType: type, serviceId: id, roleId: role, updatedBy: actor, updatedAt });
  return getOwnership({ serviceType: type, serviceId: id });
}

export function deleteOwnershipRecord({ serviceType, serviceId } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  return type && id ? deleteOwnership.run({ serviceType: type, serviceId: id }).changes === 1 : false;
}
