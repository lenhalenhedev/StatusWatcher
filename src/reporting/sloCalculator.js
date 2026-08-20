function overlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

export function calculateSlo({ windowStart, windowEnd, targetPercent, incidents = [], maintenanceWindows = [], maintenancePolicy = 'include' } = {}) {
  const start = Number(windowStart);
  const end = Number(windowEnd);
  const target = Number(targetPercent);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || !Number.isFinite(target) || target <= 0 || target > 100) {
    return { noData: true, reason: 'INVALID_WINDOW', downtimeMs: 0, uptimePercent: null, errorBudgetMs: null, errorBudgetRemainingMs: null };
  }
  const maintenance = maintenancePolicy === 'exclude'
    ? mergeIntervals(maintenanceWindows.map((window) => [Math.max(start, Number(window.starts_at)), Math.min(end, Number(window.ends_at))]))
    : [];
  const outages = mergeIntervals(incidents.map((incident) => {
    const outageStart = Math.max(start, Number(incident.opened_at ?? incident.openedAt));
    const outageEnd = Math.min(end, Number(incident.resolved_at ?? incident.resolvedAt ?? end));
    const fragments = [[outageStart, outageEnd]];
    for (const [maintenanceStart, maintenanceEnd] of maintenance) {
      const current = fragments.pop();
      if (!current) break;
      if (current[0] < maintenanceStart) fragments.push([current[0], Math.min(current[1], maintenanceStart)]);
      if (current[1] > maintenanceEnd) fragments.push([Math.max(current[0], maintenanceEnd), current[1]]);
    }
    return fragments;
  }).flat());
  const effectiveWindowMs = end - start - maintenance.reduce((total, [windowStartValue, windowEndValue]) => total + (windowEndValue - windowStartValue), 0);
  const downtimeMs = outages.reduce((total, [outageStart, outageEnd]) => total + (outageEnd - outageStart), 0);
  const uptimePercent = effectiveWindowMs > 0 ? ((effectiveWindowMs - downtimeMs) / effectiveWindowMs) * 100 : null;
  const errorBudgetMs = effectiveWindowMs * ((100 - target) / 100);
  return {
    noData: false,
    effectiveWindowMs,
    downtimeMs,
    uptimePercent,
    targetPercent: target,
    errorBudgetMs,
    errorBudgetRemainingMs: errorBudgetMs - downtimeMs,
    errorBudgetConsumedPercent: errorBudgetMs > 0 ? (downtimeMs / errorBudgetMs) * 100 : 0,
  };
}
