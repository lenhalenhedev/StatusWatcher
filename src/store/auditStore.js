import { createHash } from 'node:crypto';
import db from '../utils/db.js';

const MAX_FIELD_LENGTH = 200;
const ACTION_PATTERN = /^[A-Za-z0-9:_-]{1,80}$/;
const TYPE_PATTERN = /^[A-Za-z0-9:_-]{1,80}$/;
const ID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;

const insertAudit = db.prepare(`
  INSERT INTO config_audit_log (action, actor_id, target_type, target_id, value_hash, created_at)
  VALUES (@action, @actorId, @targetType, @targetId, @valueHash, @createdAt)
`);
const selectAudit = db.prepare(`
  SELECT id, action, actor_id, target_type, target_id, value_hash, created_at
  FROM config_audit_log ORDER BY id DESC LIMIT @limit
`);

function bounded(value, pattern) {
  const text = String(value ?? '').trim();
  return text.length <= MAX_FIELD_LENGTH && pattern.test(text) ? text : null;
}

export function hashAuditValue(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export function recordAudit({ action, actorId, targetType, targetId = null, value = null, createdAt = Date.now() } = {}) {
  const safeAction = bounded(action, ACTION_PATTERN);
  const safeActor = bounded(actorId, ID_PATTERN);
  const safeType = bounded(targetType, TYPE_PATTERN);
  const safeTarget = targetId === null || targetId === undefined ? null : bounded(targetId, ID_PATTERN);
  if (!safeAction || !safeActor || !safeType || (targetId !== null && targetId !== undefined && !safeTarget) || !Number.isInteger(createdAt)) return null;
  const result = insertAudit.run({ action: safeAction, actorId: safeActor, targetType: safeType, targetId: safeTarget, valueHash: hashAuditValue(value), createdAt });
  return selectAudit.get({ limit: 1, id: result.lastInsertRowid }) ?? { id: result.lastInsertRowid, action: safeAction, actor_id: safeActor, target_type: safeType, target_id: safeTarget, value_hash: hashAuditValue(value), created_at: createdAt };
}

export function listAudit(limit = 100) {
  const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1_000) : 100;
  return selectAudit.all({ limit: boundedLimit });
}
