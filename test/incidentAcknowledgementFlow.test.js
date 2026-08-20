import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const { createCheckRunner } = await import('../src/core/checkCycle.js');
const { createIncidentManager, INCIDENT_STATUS } = await import('../src/incidents/incidentManager.js');
const {
  buildDownSummaryEmbed,
  buildStillDownSummaryEmbed,
  buildUpSummaryEmbed,
} = await import('../src/handlers/embedBuilder.js');

function createFakeIncidentStore() {
  let nextId = 1;
  const incidents = new Map();
  const events = [];
  return {
    incidents,
    events,
    getOpenIncident(key) {
      return [...incidents.values()].find((incident) => incident.incidentKey === key && [INCIDENT_STATUS.OPEN, INCIDENT_STATUS.ACKNOWLEDGED].includes(incident.status)) ?? null;
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

function makeRunner({ manager, event, state, now, notifications }) {
  const target = { id: 'website:ack-test', name: 'Acknowledgment test website' };
  return createCheckRunner({
    client: {},
    getGuild: () => ({}),
    getConnected: () => true,
    checkBots: async () => [],
    checkMinecraft: async () => [],
    checkWebsites: async () => [{ target, state, event }],
    checkDatabases: async () => [],
    incident: manager,
    now: () => now,
    muteCheck: () => false,
    maintenanceCheck: () => false,
    notifyDown: async (_client, items) => { if (items.length) notifications.push(['DOWN', items]); },
    notifyStillDown: async (_client, items) => { if (items.length) notifications.push(['STILL_DOWN', items]); },
    notifyUp: async (_client, items) => { if (items.length) notifications.push(['UP', items]); },
  });
}

test('acknowledgment suppresses repeated STILL_DOWN communication but preserves the active health incident', async () => {
  const store = createFakeIncidentStore();
  const manager = createIncidentManager({ store, now: () => 1_000 });
  const notifications = [];
  const state = {
    name: 'Acknowledgment test website',
    lastStatus: 503,
    lastStillDownNotifiedAt: 0,
    stillDownRemindersSent: 0,
  };

  await makeRunner({
    manager,
    event: { type: 'DOWN', error: 'HTTP status 503', downSince: 900 },
    state,
    now: 1_000,
    notifications,
  }).run();
  const incident = store.incidents.values().next().value;
  store.updateIncident(incident.id, {
    status: INCIDENT_STATUS.ACKNOWLEDGED,
    acknowledgedBy: '123456789012345678',
    acknowledgedAt: 1_100,
  });

  await makeRunner({
    manager,
    event: { type: 'STILL_DOWN', error: 'HTTP status 503', downSince: 900 },
    state,
    now: 2_000,
    notifications,
  }).run();

  assert.equal(store.incidents.values().next().value.status, INCIDENT_STATUS.ACKNOWLEDGED);
  assert.equal(notifications.filter(([type]) => type === 'STILL_DOWN').length, 0);
  assert.equal(store.events.at(-1).eventType, 'UPDATE');
});

test('DOWN, STILL_DOWN, and UP alert items carry the durable SQLite incident ID', async () => {
  const store = createFakeIncidentStore();
  const manager = createIncidentManager({ store, now: () => 1_000 });
  const notifications = [];
  const state = {
    name: 'Acknowledgment test website',
    lastStatus: 503,
    lastStillDownNotifiedAt: 0,
    stillDownRemindersSent: 0,
  };

  await makeRunner({
    manager,
    event: { type: 'DOWN', error: 'HTTP status 503', downSince: 900 },
    state,
    now: 1_000,
    notifications,
  }).run();
  const incidentId = store.incidents.values().next().value.id;
  assert.equal(notifications[0][1][0].incidentId, incidentId);

  await makeRunner({
    manager,
    event: { type: 'UP', downSince: 900 },
    state,
    now: 2_000,
    notifications,
  }).run();
  assert.equal(notifications.at(-1)[0], 'UP');
  assert.equal(notifications.at(-1)[1][0].incidentId, incidentId);
  assert.equal(store.incidents.values().next().value.status, INCIDENT_STATUS.RESOLVED);
});

test('incident embeds render the same incident ID so /acknowledge can target the logged outage', () => {
  const item = {
    incidentId: 42,
    name: 'Example service',
    type: 'website',
    downSince: 1,
    error: 'HTTP status 503',
  };
  for (const embed of [
    buildDownSummaryEmbed([item]),
    buildStillDownSummaryEmbed([item]),
    buildUpSummaryEmbed([item]),
  ]) {
    const fieldText = embed.toJSON().fields[0].value;
    assert.match(fieldText, /Incident ID: `42`/);
  }
});
