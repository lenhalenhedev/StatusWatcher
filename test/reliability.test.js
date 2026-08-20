import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePercentile, calculatePercentiles } from '../src/reporting/percentiles.js';
import { calculateReliabilityMetrics } from '../src/reporting/reliabilityReport.js';

test('calculates bounded nearest-rank latency percentiles and rejects invalid inputs', () => {
  assert.equal(calculatePercentile([10, 20, 30, 40], 50), 20);
  assert.equal(calculatePercentile([10, 20, 30, 40], 95), 40);
  assert.deepEqual(calculatePercentiles([10, 20, 30, 40]), { p50: 20, p95: 40, p99: 40 });
  assert.equal(calculatePercentile([], 50), null);
  assert.throws(() => calculatePercentile([1], 0), /percentile/i);
  assert.throws(() => calculatePercentile([1], 101), /percentile/i);
  assert.throws(() => calculatePercentile([1, -1], 50), /duration/i);
});

test('calculates reliability metrics over a UTC window with explicit no-data states', () => {
  const metrics = calculateReliabilityMetrics({
    windowStart: 0,
    windowEnd: 10_000,
    incidents: [
      { opened_at: 2_000, down_since: 1_000, resolved_at: 5_000, status: 'RESOLVED' },
      { opened_at: 8_000, down_since: 7_000, resolved_at: null, status: 'OPEN' },
    ],
    samples: [
      { observed_at: 1_000, duration_ms: 100 },
      { observed_at: 2_000, duration_ms: 200 },
      { observed_at: 3_000, duration_ms: 300 },
    ],
  });

  assert.equal(metrics.windowMs, 10_000);
  assert.equal(metrics.downtimeMs, 7_000);
  assert.equal(metrics.uptimePercent, 30);
  assert.equal(metrics.incidentCount, 2);
  assert.equal(metrics.mttdMs, 1_000);
  assert.equal(metrics.mttrMs, 3_000);
  assert.equal(metrics.mtbfMs, 1_500);
  assert.deepEqual(metrics.latency, { count: 3, p50: 200, p95: 300, p99: 300 });

  const noData = calculateReliabilityMetrics({ windowStart: 0, windowEnd: 1_000, incidents: [], samples: [] });
  assert.equal(noData.uptimePercent, 100);
  assert.equal(noData.incidentCount, 0);
  assert.equal(noData.mttdMs, null);
  assert.equal(noData.mttrMs, null);
  assert.equal(noData.mtbfMs, null);
  assert.deepEqual(noData.latency, { count: 0, p50: null, p95: null, p99: null });
});
