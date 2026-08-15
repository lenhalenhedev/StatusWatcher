import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBackoffIntervalMs, shouldRemindStillDown } from '../src/utils/stillDownBackoff.js';

const STEPS = [90_000, 300_000, 1_800_000]; // 90s, 5m, 30m

test('getBackoffIntervalMs returns the step for each reminder count', () => {
  assert.equal(getBackoffIntervalMs(0, STEPS), 90_000);
  assert.equal(getBackoffIntervalMs(1, STEPS), 300_000);
  assert.equal(getBackoffIntervalMs(2, STEPS), 1_800_000);
});

test('getBackoffIntervalMs repeats the final step once exhausted', () => {
  assert.equal(getBackoffIntervalMs(3, STEPS), 1_800_000);
  assert.equal(getBackoffIntervalMs(99, STEPS), 1_800_000);
});

test('getBackoffIntervalMs clamps negative / invalid counts', () => {
  assert.equal(getBackoffIntervalMs(-5, STEPS), 90_000);
  assert.equal(getBackoffIntervalMs(NaN, STEPS), 90_000);
});

test('getBackoffIntervalMs returns 0 for empty schedule', () => {
  assert.equal(getBackoffIntervalMs(0, []), 0);
  assert.equal(getBackoffIntervalMs(0, null), 0);
});

test('shouldRemindStillDown always reminds when never notified', () => {
  assert.equal(shouldRemindStillDown(null, 0, STEPS), true);
});

test('shouldRemindStillDown respects the current backoff step', () => {
  const now = 1_000_000_000;
  // First reminder uses the 90s step.
  assert.equal(shouldRemindStillDown(now - 89_000, 0, STEPS, now), false);
  assert.equal(shouldRemindStillDown(now - 90_000, 0, STEPS, now), true);
  // Second reminder uses the 5m step.
  assert.equal(shouldRemindStillDown(now - 299_000, 1, STEPS, now), false);
  assert.equal(shouldRemindStillDown(now - 300_000, 1, STEPS, now), true);
});

test('shouldRemindStillDown always reminds with empty schedule', () => {
  assert.equal(shouldRemindStillDown(Date.now(), 5, [], Date.now()), true);
});
