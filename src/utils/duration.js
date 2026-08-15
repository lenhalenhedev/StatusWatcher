// Milliseconds per supported duration unit.
const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a human duration such as "30m", "2h", "1d", "90s", or a bare number
 * (interpreted as minutes) into milliseconds.
 *
 * @param {string|number} input
 * @returns {number|null} milliseconds, or null when the input is invalid.
 */
export function parseDuration(input) {
  if (input == null) return null;
  const str = String(input).trim().toLowerCase();
  const match = str.match(/^(\d+)\s*([smhd]?)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2] || 'm';
  return value * UNIT_MS[unit];
}

/**
 * Format a millisecond duration into a compact human string (e.g. "1d 2h 5m").
 * Always renders at least minutes.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0m';

  let remaining = ms;
  const days = Math.floor(remaining / UNIT_MS.d);
  remaining -= days * UNIT_MS.d;
  const hours = Math.floor(remaining / UNIT_MS.h);
  remaining -= hours * UNIT_MS.h;
  const minutes = Math.floor(remaining / UNIT_MS.m);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}
