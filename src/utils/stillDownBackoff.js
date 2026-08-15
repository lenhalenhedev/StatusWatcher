/**
 * Escalating backoff schedule for "Still DOWN" reminders.
 *
 * Instead of a fixed interval, reminders grow further apart the longer an
 * outage lasts (for example 90s -> 5m -> 30m). This avoids spamming the log
 * channel during a long outage while still confirming the target is still down.
 */

/**
 * Return the delay (ms) that must elapse before the next reminder, given how
 * many reminders have already been sent during the current outage.
 * Once the schedule is exhausted, the final (largest) step repeats.
 *
 * @param {number} remindersSent - reminders already emitted this outage (>= 0).
 * @param {number[]} stepsMs - ascending backoff steps in milliseconds.
 * @returns {number} delay in ms (0 means "always send").
 */
export function getBackoffIntervalMs(remindersSent, stepsMs) {
  if (!Array.isArray(stepsMs) || stepsMs.length === 0) return 0;
  const safeCount = Number.isFinite(remindersSent) ? Math.max(0, remindersSent) : 0;
  const index = Math.min(safeCount, stepsMs.length - 1);
  return stepsMs[index];
}

/**
 * Decide whether the next "Still DOWN" reminder should be sent now.
 *
 * @param {number|null} lastNotifiedAt - epoch ms of the previous reminder, or null.
 * @param {number} remindersSent - reminders already emitted this outage.
 * @param {number[]} stepsMs - ascending backoff steps in milliseconds.
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function shouldRemindStillDown(lastNotifiedAt, remindersSent, stepsMs, now = Date.now()) {
  const interval = getBackoffIntervalMs(remindersSent, stepsMs);
  if (!interval || interval <= 0) return true;
  if (!lastNotifiedAt) return true;
  return now - lastNotifiedAt >= interval;
}
