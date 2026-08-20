import { calculatePercentiles } from './percentiles.js';

function assertWindow(windowStart, windowEnd) {
  if (!Number.isInteger(windowStart) || !Number.isInteger(windowEnd) || windowStart >= windowEnd) {
    throw new RangeError('Reliability window must have integer start and end timestamps with start before end.');
  }
}

function boundedTimestamp(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .sort(([left], [right]) => left - right);
  const merged = [];
  for (const [start, end] of sorted) {
    const previous = merged.at(-1);
    if (!previous || start > previous[1]) merged.push([start, end]);
    else previous[1] = Math.max(previous[1], end);
  }
  return merged;
}

export function calculateReliabilityMetrics({ windowStart, windowEnd, incidents = [], samples = [] }) {
  assertWindow(windowStart, windowEnd);
  if (!Array.isArray(incidents) || !Array.isArray(samples)) throw new TypeError('Reliability inputs must be arrays.');

  const incidentRows = incidents.filter((incident) => {
    const openedAt = Number(incident?.opened_at);
    return Number.isInteger(openedAt) && openedAt >= windowStart && openedAt < windowEnd;
  });

  const outageIntervals = incidents.map((incident) => {
    const start = Math.max(windowStart, Number(incident?.down_since));
    const end = Math.min(windowEnd, boundedTimestamp(incident?.resolved_at, windowEnd));
    return [start, end];
  }).filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end));

  const mergedOutages = mergeIntervals(outageIntervals);
  const downtimeMs = mergedOutages.reduce((total, [start, end]) => total + (end - start), 0);
  const windowMs = windowEnd - windowStart;
  const uptimePercent = Number(((Math.max(0, windowMs - downtimeMs) / windowMs) * 100).toFixed(2));

  const detectionDelays = incidentRows
    .map((incident) => Number(incident.opened_at) - Number(incident.down_since))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const recoveryDurations = incidentRows
    .map((incident) => Number(incident.resolved_at) - Number(incident.opened_at))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const healthyMs = Math.max(0, windowMs - downtimeMs);

  const durations = samples
    .filter((sample) => Number.isInteger(Number(sample?.observed_at)) && Number(sample.observed_at) >= windowStart && Number(sample.observed_at) < windowEnd)
    .map((sample) => Number(sample.duration_ms));
  const percentiles = calculatePercentiles(durations);

  return {
    windowStart,
    windowEnd,
    windowMs,
    downtimeMs,
    uptimePercent,
    incidentCount: incidentRows.length,
    mttdMs: detectionDelays.length ? Math.round(detectionDelays.reduce((sum, value) => sum + value, 0) / detectionDelays.length) : null,
    mttrMs: recoveryDurations.length ? Math.round(recoveryDurations.reduce((sum, value) => sum + value, 0) / recoveryDurations.length) : null,
    mtbfMs: incidentRows.length ? Math.round(healthyMs / incidentRows.length) : null,
    latency: { count: durations.length, ...percentiles },
  };
}
