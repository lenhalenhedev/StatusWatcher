import db from './db.js';
import { logInfo, logError } from './logger.js';

// Supported reporting windows, expressed in milliseconds.
const PERIOD = {
  DAY:   24 * 60 * 60 * 1_000,
  WEEK:  7 * 24 * 60 * 60 * 1_000,
  MONTH: 30 * 24 * 60 * 60 * 1_000,
  YEAR:  365 * 24 * 60 * 60 * 1_000,
};

// Prepared statements (compiled once for performance).
const stmtUpsertTarget = db.prepare(`
  INSERT INTO targets (id, name, type, has_important_role, status, created_at, updated_at)
  VALUES (@id, @name, @type, @hasImportantRole, 'active', @now, @now)
  ON CONFLICT (id) DO UPDATE SET
    name               = excluded.name,
    type               = excluded.type,
    has_important_role = excluded.has_important_role,
    status             = 'active',
    updated_at         = excluded.updated_at
`);

const stmtGetTarget   = db.prepare(`SELECT * FROM targets WHERE id = ?`);
const stmtListTargets = db.prepare(`SELECT * FROM targets ORDER BY type, name`);
const stmtListActive  = db.prepare(`SELECT * FROM targets WHERE status = 'active' ORDER BY type, name`);
const stmtSetStatus   = db.prepare(`UPDATE targets SET status = @status, updated_at = @now WHERE id = @id`);
const stmtDeleteMute   = db.prepare(`DELETE FROM mutes WHERE target_id = ?`);
const stmtDeleteSubs   = db.prepare(`DELETE FROM subscriptions WHERE target_id = ?`);
const stmtDeleteTarget = db.prepare(`DELETE FROM targets WHERE id = ?`);

const stmtOpenSession = db.prepare(`
  SELECT * FROM downtime_sessions
  WHERE target_id = ? AND up_end IS NULL
  ORDER BY down_start DESC
  LIMIT 1
`);

const stmtInsertSession = db.prepare(`
  INSERT INTO downtime_sessions (target_id, down_start, up_end)
  VALUES (@id, @downStart, NULL)
`);

const stmtCloseSession = db.prepare(`
  UPDATE downtime_sessions SET up_end = @upEnd WHERE id = @sessionId
`);

const stmtRecentSessions = db.prepare(`
  SELECT down_start, up_end FROM downtime_sessions
  WHERE target_id = ?
  ORDER BY down_start DESC
  LIMIT ?
`);

// Sum of downtime (ms) overlapping the window [windowStart, now].
const stmtTotalDowntime = db.prepare(`
  SELECT COALESCE(SUM(
    MIN(COALESCE(up_end, @now), @now) - MAX(down_start, @windowStart)
  ), 0) AS total_down
  FROM downtime_sessions
  WHERE target_id = @id
    AND down_start < @now
    AND COALESCE(up_end, @now) > @windowStart
`);

/**
 * Register a target or refresh its metadata. Re-registering an archived target
 * reactivates it while preserving history.
 * @param {string} id
 * @param {string} name
 * @param {object} [options]
 * @param {string} [options.type='bot'] - 'bot' or 'minecraft'.
 * @param {boolean} [options.hasImportantRole=false]
 */
export function registerTarget(id, name, options = {}) {
  const { type = 'bot', hasImportantRole = false } = options;
  try {
    stmtUpsertTarget.run({ id, name, type, hasImportantRole: hasImportantRole ? 1 : 0, now: Date.now() });
  } catch (err) {
    logError('UptimeTracker.registerTarget', err);
  }
}

/**
 * Record the moment a target started being DOWN. No-op when the target is
 * unknown or already has an open downtime session.
 * @param {string} id
 * @param {number} [timestamp]
 */
export function recordDown(id, timestamp = Date.now()) {
  try {
    if (!stmtGetTarget.get(id)) return;
    if (stmtOpenSession.get(id)) return;
    stmtInsertSession.run({ id, downStart: timestamp });
  } catch (err) {
    logError('UptimeTracker.recordDown', err);
  }
}

/**
 * Close a target's open downtime session (recovery to UP). No-op when none open.
 * @param {string} id
 * @param {number} [timestamp]
 */
export function recordUp(id, timestamp = Date.now()) {
  try {
    const open = stmtOpenSession.get(id);
    if (!open) return;
    stmtCloseSession.run({ sessionId: open.id, upEnd: timestamp });
  } catch (err) {
    logError('UptimeTracker.recordUp', err);
  }
}

/**
 * Whether the target currently has an open (ongoing) downtime session.
 * @param {string} id
 * @returns {boolean}
 */
export function hasOpenSession(id) {
  try {
    return Boolean(stmtOpenSession.get(id));
  } catch (err) {
    logError('UptimeTracker.hasOpenSession', err);
    return false;
  }
}

/**
 * Return the start time (epoch ms) of the target's open downtime session, or
 * null when it is not currently down. This is the persisted source of truth for
 * "real" downtime, surviving process restarts.
 * @param {string} id
 * @returns {number|null}
 */
export function getOpenSessionStart(id) {
  try {
    return stmtOpenSession.get(id)?.down_start ?? null;
  } catch (err) {
    logError('UptimeTracker.getOpenSessionStart', err);
    return null;
  }
}

/**
 * Return the most recent downtime sessions for a target, newest first.
 * @param {string} id
 * @param {number} [limit=10]
 * @returns {Array<{ down_start: number, up_end: number|null }>}
 */
export function getRecentSessions(id, limit = 10) {
  try {
    return stmtRecentSessions.all(id, limit);
  } catch (err) {
    logError('UptimeTracker.getRecentSessions', err);
    return [];
  }
}

/**
 * Archive a target so active checks are skipped while statistics are preserved.
 * Any open downtime session is closed first to keep totals consistent.
 * @param {string} id
 * @param {number} [timestamp]
 */
export function archiveTarget(id, timestamp = Date.now()) {
  try {
    if (!stmtGetTarget.get(id)) return;
    recordUp(id, timestamp);
    stmtSetStatus.run({ id, status: 'archived', now: timestamp });
  } catch (err) {
    logError('UptimeTracker.archiveTarget', err);
  }
}

/**
 * Permanently remove a target and its target-scoped metadata. SQLite foreign
 * keys cascade the dependent downtime sessions, so a departed bot is absent
 * from both active monitoring and the database as requested.
 * @param {string} id
 */
export function deleteTarget(id) {
  try {
    const transaction = db.transaction(() => {
      stmtDeleteMute.run(id);
      stmtDeleteSubs.run(id);
      stmtDeleteTarget.run(id);
    });
    transaction();
  } catch (err) {
    logError('UptimeTracker.deleteTarget', err);
  }
}

/**
 * Fetch a single target row, or null when it does not exist.
 * @param {string} id
 */
export function getTarget(id) {
  try {
    return stmtGetTarget.get(id) ?? null;
  } catch (err) {
    logError('UptimeTracker.getTarget', err);
    return null;
  }
}

/**
 * List targets, optionally restricting to active ones.
 * @param {object} [options]
 * @param {boolean} [options.activeOnly=false]
 */
export function listTargets(options = {}) {
  const { activeOnly = false } = options;
  try {
    return activeOnly ? stmtListActive.all() : stmtListTargets.all();
  } catch (err) {
    logError('UptimeTracker.listTargets', err);
    return [];
  }
}

/**
 * Compute the uptime percentage of a target over the given period.
 * @param {string} id
 * @param {number} periodMs
 * @returns {string} e.g. "99.72", or "N/A" when the target is unknown.
 */
function computeUptime(id, periodMs) {
  try {
    if (!stmtGetTarget.get(id)) return 'N/A';
    const now = Date.now();
    const windowStart = now - periodMs;
    const row = stmtTotalDowntime.get({ id, now, windowStart });
    const totalDown = row?.total_down ?? 0;
    const pct = Math.max(0, ((periodMs - totalDown) / periodMs) * 100);
    return pct.toFixed(2);
  } catch (err) {
    logError('UptimeTracker.computeUptime', err);
    return 'N/A';
  }
}

export const getDailyUptime   = (id) => computeUptime(id, PERIOD.DAY);
export const getWeeklyUptime  = (id) => computeUptime(id, PERIOD.WEEK);
export const getMonthlyUptime = (id) => computeUptime(id, PERIOD.MONTH);
export const getYearlyUptime  = (id) => computeUptime(id, PERIOD.YEAR);

/** Print a full uptime report to the console (used by the daily cron job). */
export function printUptimeReport() {
  logInfo('UptimeTracker', '========== UPTIME REPORT ==========');
  for (const target of listTargets()) {
    const flag = target.status === 'archived' ? ' [ARCHIVED]' : '';
    logInfo(
      'UptimeTracker',
      `${String(target.name).padEnd(20)} | ` +
      `24h: ${getDailyUptime(target.id)}% | ` +
      `7d: ${getWeeklyUptime(target.id)}% | ` +
      `30d: ${getMonthlyUptime(target.id)}% | ` +
      `1y: ${getYearlyUptime(target.id)}%${flag}`,
    );
  }
  logInfo('UptimeTracker', '===================================');
}
