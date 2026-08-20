function normalizeDurations(values) {
  if (!Array.isArray(values)) throw new TypeError('Duration samples must be an array.');
  const durations = values.map((value) => Number(value));
  if (durations.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Duration samples must be finite and non-negative.');
  }
  return durations.sort((left, right) => left - right);
}

/**
 * Return the nearest-rank percentile from finite, non-negative durations.
 * Empty input is an explicit no-data result rather than an invented zero.
 */
export function calculatePercentile(values, percentile) {
  const rank = Number(percentile);
  if (!Number.isFinite(rank) || rank < 1 || rank > 100) {
    throw new RangeError('Percentile must be between 1 and 100.');
  }
  const durations = normalizeDurations(values);
  if (durations.length === 0) return null;
  const index = Math.max(0, Math.ceil((rank / 100) * durations.length) - 1);
  return durations[index];
}

export function calculatePercentiles(values) {
  return {
    p50: calculatePercentile(values, 50),
    p95: calculatePercentile(values, 95),
    p99: calculatePercentile(values, 99),
  };
}
