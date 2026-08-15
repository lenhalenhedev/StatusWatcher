import db from '../utils/db.js';
import { logError } from '../utils/logger.js';

// Prepared statements (compiled once).
const stmtUpsert = db.prepare(`
  INSERT INTO mutes (target_id, muted_until, created_at)
  VALUES (@id, @until, @now)
  ON CONFLICT (target_id) DO UPDATE SET muted_until = excluded.muted_until
`);
const stmtGet = db.prepare(`SELECT * FROM mutes WHERE target_id = ?`);
const stmtDelete = db.prepare(`DELETE FROM mutes WHERE target_id = ?`);
const stmtListActive = db.prepare(`SELECT * FROM mutes WHERE muted_until > ? ORDER BY muted_until`);

/**
 * Mute a target until the given epoch-ms timestamp.
 * @param {string} id
 * @param {number} untilMs
 */
export function muteTarget(id, untilMs) {
  try {
    stmtUpsert.run({ id, until: untilMs, now: Date.now() });
    return true;
  } catch (err) {
    logError('MuteStore.muteTarget', err);
    return false;
  }
}

/**
 * Remove a mute. Returns true when a mute existed and was removed.
 * @param {string} id
 */
export function unmuteTarget(id) {
  try {
    return stmtDelete.run(id).changes > 0;
  } catch (err) {
    logError('MuteStore.unmuteTarget', err);
    return false;
  }
}

/**
 * Whether a target is currently muted. Expired mutes are lazily deleted.
 * @param {string} id
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function isMuted(id, now = Date.now()) {
  try {
    const row = stmtGet.get(id);
    if (!row) return false;
    if (row.muted_until <= now) {
      stmtDelete.run(id);
      return false;
    }
    return true;
  } catch (err) {
    logError('MuteStore.isMuted', err);
    return false;
  }
}

/**
 * Return the mute row for a target, or null.
 * @param {string} id
 */
export function getMute(id) {
  try {
    return stmtGet.get(id) ?? null;
  } catch (err) {
    logError('MuteStore.getMute', err);
    return null;
  }
}

/**
 * List all currently active (non-expired) mutes.
 * @param {number} [now=Date.now()]
 */
export function listActiveMutes(now = Date.now()) {
  try {
    return stmtListActive.all(now);
  } catch (err) {
    logError('MuteStore.listActiveMutes', err);
    return [];
  }
}
