import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const { createCheckRunner } = await import('../src/core/checkCycle.js');
const { createIncidentManager } = await import('../src/incidents/incidentManager.js');

function createFakeIncidentStore() {
  let nextId = 1;
  const incidents = new Map();
  const events = [];
  return {
    incidents,
    events,
    getOpenIncident(key) {
      return [...incidents.values()].find((incident) => incident.incidentKey === key && ['OPEN', 'ACKNOWLEDGED'].includes(incident.status)) ?? null;
    },
    createIncident(record) {
      const incident = { id: nextId++, ...record };
      incidents.set(incident.id, incident);
      return incident;
    },
    updateIncident(id, patch) {
      const incident = incidents.get(id);
      if (!incident) return null;
      Object.assign(incident, patch);
      return incident;
    },
    appendIncidentEvent(event) {
      events.push(event);
      return event;
    },
  };
}

function createRunner({ event, incident, now = 1_000, muted = false, maintenance = false, notified = [] }) {
  const target = { id: 'website:alpha', name: 'Alpha website' };
  const state = { name: target.name, lastStatus: 503 };
  return {
    runner: createCheckRunner({
      client: {},
      getGuild: () => ({}),
      getConnected: () => true,
      checkBots: async () => [],
      checkMinecraft: async () => [],
      checkWebsites: async () => [{ target, state, event }],
      checkDatabases: async () => [],
      muteCheck: () => muted,
      maintenanceCheck: () => maintenance,
      incident,
      now: () => now,
      notifyDown: async (_client, items) => { if (items.length) notified.push(['DOWN', items]); },
      notifyStillDown: async (_client, items) => { if (items.length) notified.push(['STILL_DOWN', items]); },
      notifyUp: async (_client, items) => { if (items.length) notified.push(['UP', items]); },
    }),
    notified,
  };
}

test('creates one incident for DOWN, deduplicates repeated DOWN, and resolves on UP', async () => {
  const store = createFakeIncidentStore();
  const manager = createIncidentManager({ store, now: () => 1_000 });
  const notified = [];
  const context = createRunner({
    event: { type: 'DOWN', error: 'HTTP status 503', downSince: 900 },
    incident: manager,
    notified,
  });

  assert.equal(await context.runner.run(), true);
  assert.equal(await context.runner.run(), true);
  assert.equal(store.incidents.size, 1);
  assert.equal(store.events.length, 2);
  assert.deepEqual(store.events.map(({ eventType }) => eventType), ['DETECTED', 'NOTIFIED']);
  assert.equal(store.incidents.values().next().value.errorCategory, 'HTTP_STATUS_FAILURE');

  const recovery = createRunner({
    event: { type: 'UP', downSince: 900 },
    incident: manager,
    now: 2_000,
    notified,
  });
  assert.equal(await recovery.runner.run(), true);
  assert.equal(store.incidents.values().next().value.status, 'RESOLVED');
  assert.equal(store.events.at(-1).eventType, 'RESOLVED');
  assert.equal(store.events.at(-1).reason, 'HEALTH_RECOVERY');
  assert.equal(notified.filter(([type]) => type === 'DOWN').length, 2);
  assert.equal(notified.filter(([type]) => type === 'UP').length, 1);
});

test('records an incident even when the corresponding alert is muted', async () => {
  const store = createFakeIncidentStore();
  const manager = createIncidentManager({ store });
  const context = createRunner({
    event: { type: 'DOWN', error: 'Request timed out', downSince: 500 },
    incident: manager,
    muted: true,
  });

  await context.runner.run();
  assert.equal(store.incidents.size, 1);
  assert.equal(context.notified.length, 0);
  assert.equal(store.incidents.values().next().value.errorCategory, 'HTTP_TIMEOUT');
});

test('records an incident but suppresses alert delivery during maintenance', async () => {
  const store = createFakeIncidentStore();
  const manager = createIncidentManager({ store });
  const context = createRunner({
    event: { type: 'DOWN', error: 'HTTP status 503', downSince: 500 },
    incident: manager,
    maintenance: true,
  });

  await context.runner.run();
  assert.equal(store.incidents.size, 1);
  assert.equal(context.notified.length, 0);
});
