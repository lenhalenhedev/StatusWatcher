import { createHash } from 'node:crypto';
import db from '../utils/db.js';

const SERVICE_TYPES = new Set(['website', 'database']);
const ID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;
const insertSnapshot = db.prepare(`
  INSERT INTO tls_certificate_snapshots (service_type, service_id, observed_at, expires_at, fingerprint_hash, warning_mask)
  VALUES (@serviceType, @serviceId, @observedAt, @expiresAt, @fingerprintHash, @warningMask)
`);
const latestSnapshot = db.prepare(`
  SELECT id, service_type, service_id, observed_at, expires_at, fingerprint_hash, warning_mask
  FROM tls_certificate_snapshots
  WHERE service_type = @serviceType AND service_id = @serviceId
  ORDER BY observed_at DESC, id DESC LIMIT 1
`);
const updateMask = db.prepare('UPDATE tls_certificate_snapshots SET warning_mask = @warningMask WHERE id = @id');

function normalizeType(value) { const type = String(value ?? '').trim().toLowerCase(); return SERVICE_TYPES.has(type) ? type : null; }
function normalizeId(value) { const id = String(value ?? '').trim(); return ID_PATTERN.test(id) ? id : null; }

export function hashFingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function saveTlsSnapshot({ serviceType, serviceId, observedAt = Date.now(), expiresAt, fingerprint, warningMask = 0 } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  const expiry = Number(expiresAt);
  const mask = Number(warningMask);
  if (!type || !id || !Number.isInteger(observedAt) || !Number.isInteger(expiry) || expiry <= 0 || typeof fingerprint !== 'string' || fingerprint.length === 0 || !Number.isInteger(mask) || mask < 0) return null;
  const result = insertSnapshot.run({ serviceType: type, serviceId: id, observedAt, expiresAt: expiry, fingerprintHash: hashFingerprint(fingerprint), warningMask: mask });
  return { id: result.lastInsertRowid, service_type: type, service_id: id, observed_at: observedAt, expires_at: expiry, fingerprint_hash: hashFingerprint(fingerprint), warning_mask: mask };
}

export function getLatestTlsSnapshot({ serviceType, serviceId } = {}) {
  const type = normalizeType(serviceType);
  const id = normalizeId(serviceId);
  return type && id ? latestSnapshot.get({ serviceType: type, serviceId: id }) ?? null : null;
}

export function updateTlsWarningMask(id, warningMask) {
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(warningMask) || warningMask < 0) return false;
  return updateMask.run({ id, warningMask }).changes === 1;
}
