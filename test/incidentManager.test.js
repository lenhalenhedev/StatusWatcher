import assert from 'node:assert/strict';
import test from 'node:test';
import { createIncidentManager, INCIDENT_STATUS } from '../src/incidents/incidentManager.js';
import { buildIncidentKey } from '../src/incidents/incidentKey.js';

function makeStore() {
  const incidents = new Map();
  const events = [];
  return {
    incidents,
    events,
    getOpenIncident: (key) => incidents.get(key) ?? null,
    createIncident: (record) => {
      const saved = { ...record, id: incidents.size + 1 };
      incidents.set(record.incidentKey, saved);
      return saved;
    },
    updateIncident: (id, patch) => {
      const current = [...incidents.values()].find((item) => item.id === id);
      Object.assign(current, patch);
      return current;
    },
    appendIncidentEvent: (event) => {
      events.push({ ...event, id: events.length + 1 });
      return events.at(-1);
    },
  };
}

function event(overrides = {}) {
  return {
    serviceId: 'website:alpha',
    serviceType: 'website',
    name: 'Alpha',
    eventType: 'DOWN',
    occurredAt: 1_700_000_000_000,
    confirmedDownAt: 1_700_000_000_000,
    downSince: 1_700_000_000_000,
    errorCategory: 'HTTP_STATUS_FAILURE',
    statusCode: 503,
    durationMs: 245,
    dependencyGroupId: null,
    ...overrides,
  };
}

test('buildIncidentKey is deterministic and does not include endpoint data', () => {
  assert.equal(buildIncidentKey(event()), 'website:website:alpha');
  assert.equal(buildIncidentKey(event({ dependencyGroupId: 'payments' })), 'website:website:alpha');
  assert.doesNotMatch(buildIncidentKey(event()), /https?:|example|password|\?/i);
});

test('creates an incident and records detected plus notified timeline events once', () => {
  const store = makeStore();
  const manager = createIncidentManager({ store });
  const result = manager.handleTransition(event());

  assert.equal(result.incident.status, INCIDENT_STATUS.OPEN);
  assert.equal(result.shouldNotify, true);
  assert.deepEqual(store.events.map((item) => item.eventType), ['DETECTED', 'NOTIFIED']);
  assert.equal(store.events[0].errorCategory, 'HTTP_STATUS_FAILURE');
  assert.equal(Object.hasOwn(store.events[0], 'rawError'), false);
});

test('suppresses duplicate DOWN transitions within the same incident', () => {
  const store = makeStore();
  const manager = createIncidentManager({ store });
  const first = manager.handleTransition(event());
  const second = manager.handleTransition(event({ occurredAt: 1_700_000_001_000 }));

  assert.equal(first.shouldNotify, true);
  assert.equal(second.shouldNotify, false);
  assert.equal(store.events.filter((item) => item.eventType === 'DETECTED').length, 1);
  assert.equal(store.events.filter((item) => item.eventType === 'NOTIFIED').length, 1);
});

test('records STILL_DOWN without changing open incident identity', () => {
  const store = makeStore();
  const manager = createIncidentManager({ store });
  const first = manager.handleTransition(event());
  const still = manager.handleTransition(event({
    eventType: 'STILL_DOWN',
    occurredAt: 1_700_000_060_000,
  }));

  assert.equal(still.incident.id, first.incident.id);
  assert.equal(still.shouldNotify, false);
  assert.equal(store.events.at(-1).eventType, 'UPDATE');
});

test('UP closes the incident as health recovery and does not require communication resolve', () => {
  const store = makeStore();
  const manager = createIncidentManager({ store });
  manager.handleTransition(event());
  const recovered = manager.handleTransition(event({
    eventType: 'UP',
    occurredAt: 1_700_000_120_000,
    errorCategory: null,
    statusCode: 200,
  }));

  assert.equal(recovered.incident.status, INCIDENT_STATUS.RESOLVED);
  assert.equal(recovered.shouldNotify, true);
  assert.equal(store.events.at(-1).eventType, 'RESOLVED');
});

test('normalizes unknown errors to an allowlisted category and never stores raw text', () => {
  const store = makeStore();
  const manager = createIncidentManager({ store });
  const result = manager.handleTransition(event({
    errorCategory: 'https://secret.example/?token=abc',
    rawError: 'password=secret certificate=PRIVATE',
  }));

  assert.equal(result.incident.errorCategory, 'UNKNOWN');
  assert.equal(store.events[0].errorCategory, 'UNKNOWN');
  assert.equal(Object.hasOwn(store.events[0], 'rawError'), false);
});
