import db from '../utils/db.js';
import { logError } from '../utils/logger.js';

// 'user' or 'role' subscriptions that should be pinged on important outages.
const VALID_KINDS = new Set(['user', 'role']);

const stmtUpsert = db.prepare(`
  INSERT INTO subscriptions (kind, target_id, created_at)
  VALUES (@kind, @id, @now)
  ON CONFLICT (kind, target_id) DO NOTHING
`);
const stmtDelete = db.prepare(`DELETE FROM subscriptions WHERE kind = @kind AND target_id = @id`);
const stmtList = db.prepare(`SELECT kind, target_id FROM subscriptions`);

/**
 * Add a subscription. Idempotent.
 * @param {'user'|'role'} kind
 * @param {string} id - Discord user or role id.
 * @returns {boolean} true on success.
 */
export function addSubscription(kind, id) {
  if (!VALID_KINDS.has(kind) || !id) return false;
  try {
    stmtUpsert.run({ kind, id, now: Date.now() });
    return true;
  } catch (err) {
    logError('SubscriptionStore.addSubscription', err);
    return false;
  }
}

/**
 * Remove a subscription. Returns true when one existed and was removed.
 * @param {'user'|'role'} kind
 * @param {string} id
 */
export function removeSubscription(kind, id) {
  if (!VALID_KINDS.has(kind) || !id) return false;
  try {
    return stmtDelete.run({ kind, id }).changes > 0;
  } catch (err) {
    logError('SubscriptionStore.removeSubscription', err);
    return false;
  }
}

/**
 * List all subscriptions.
 * @returns {Array<{ kind: string, target_id: string }>}
 */
export function listSubscriptions() {
  try {
    return stmtList.all();
  } catch (err) {
    logError('SubscriptionStore.listSubscriptions', err);
    return [];
  }
}
