// UTC+7 offset in milliseconds
const UTC7_OFFSET_MS = 7 * 60 * 60 * 1_000;

/**
 * Return a UTC+7 timestamp string in DD/MM/YYYY HH:mm:ss format.
 * @param {Date} [date=new Date()]
 */
export function getTimestampUTC7(date = new Date()) {
  const utc7 = new Date(date.getTime() + UTC7_OFFSET_MS);
  const p    = (n) => String(n).padStart(2, '0');
  return (
    `${p(utc7.getUTCDate())}/${p(utc7.getUTCMonth() + 1)}/${utc7.getUTCFullYear()} ` +
    `${p(utc7.getUTCHours())}:${p(utc7.getUTCMinutes())}:${p(utc7.getUTCSeconds())}`
  );
}

/**
 * Compute elapsed minutes since `fromMs` (epoch ms).
 * @param {number} fromMs
 */
export function getElapsedMinutes(fromMs) {
  return Math.floor((Date.now() - fromMs) / 60_000);
}

/**
 * Compute elapsed seconds since `fromMs`.
 * @param {number} fromMs
 */
export function getElapsedSeconds(fromMs) {
  return Math.floor((Date.now() - fromMs) / 1_000);
}
