import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration } from '../src/utils/duration.js';

test('parseDuration handles explicit units', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('30m'), 1_800_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('1d'), 86_400_000);
});

test('parseDuration defaults a bare number to minutes', () => {
  assert.equal(parseDuration('45'), 45 * 60_000);
  assert.equal(parseDuration(45), 45 * 60_000);
});

test('parseDuration tolerates whitespace and casing', () => {
  assert.equal(parseDuration('  2H '), 7_200_000);
});

test('parseDuration rejects invalid input', () => {
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('10x'), null);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration('-5m'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(null), null);
});

test('formatDuration renders compact human strings', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(90_000), '1m');
  assert.equal(formatDuration(1_800_000), '30m');
  assert.equal(formatDuration(7_320_000), '2h 2m');
  assert.equal(formatDuration(90_061_000), '1d 1h 1m');
});

test('formatDuration guards against invalid input', () => {
  assert.equal(formatDuration(-1), '0m');
  assert.equal(formatDuration(NaN), '0m');
});
