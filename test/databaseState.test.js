import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseState, markOffline, markOnline } from '../src/monitors/databaseState.js';

function target() {
  return { id: 'database_test', name: 'Test DB', engine: 'postgres', sslEnabled: true, hasCertificate: false };
}

test('does not confirm a transient failure before threshold', () => {
  const state = createDatabaseState(target());
  const first = markOffline(state, new Error('refused'), {
    now: 1_000,
    confirmDownThresholdMs: 5_000,
    classifyError: () => 'connection_failed',
  });
  const second = markOffline(state, new Error('refused'), {
    now: 5_999,
    confirmDownThresholdMs: 5_000,
    classifyError: () => 'connection_failed',
  });
  assert.equal(first.type, null);
  assert.equal(second.type, null);
  assert.equal(state.isConfirmedDown, false);
});

test('emits exactly one DOWN after threshold and records original failure time', () => {
  const state = createDatabaseState(target());
  let recordDownArgs;
  markOffline(state, new Error('timeout'), {
    now: 10_000,
    confirmDownThresholdMs: 1_000,
    classifyError: () => 'timeout',
    recordDown: (...args) => { recordDownArgs = args; },
  });
  const down = markOffline(state, new Error('timeout'), {
    now: 11_000,
    confirmDownThresholdMs: 1_000,
    classifyError: () => 'timeout',
    recordDown: (...args) => { recordDownArgs = args; },
  });
  const still = markOffline(state, new Error('timeout'), {
    now: 12_000,
    confirmDownThresholdMs: 1_000,
    classifyError: () => 'timeout',
    recordDown: (...args) => { recordDownArgs = args; },
  });
  assert.equal(down.type, 'DOWN');
  assert.equal(still.type, 'STILL_DOWN');
  assert.deepEqual(recordDownArgs, ['database_test', 10_000]);
  assert.match(down.error, /^Database probe failed \(timeout\)\.$/);
});

test('recovery closes persisted session and resets reminder state', () => {
  const state = createDatabaseState(target());
  state.isConfirmedDown = true;
  state.confirmedDownAt = 10_000;
  state.lastStillDownNotifiedAt = 11_000;
  state.stillDownRemindersSent = 3;
  let recordUpArgs;
  const up = markOnline(state, {
    now: 20_000,
    getOpenSessionStart: () => 9_500,
    recordUp: (...args) => { recordUpArgs = args; },
  });
  assert.equal(up.type, 'UP');
  assert.equal(up.downSince, 9_500);
  assert.deepEqual(recordUpArgs, ['database_test', 20_000]);
  assert.equal(state.isConfirmedDown, false);
  assert.equal(state.stillDownRemindersSent, 0);
});

test('healthy first probe resets stale transient failure state', () => {
  const state = createDatabaseState(target());
  state.firstSeenOffline = 100;
  const online = markOnline(state, { now: 200 });
  assert.equal(online.type, 'ONLINE');
  assert.equal(state.firstSeenOffline, null);
  assert.equal(state.lastHealthyAt, 200);
});
