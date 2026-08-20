import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);
function run(script) {
  const env = {
    ...process.env,
    TOKEN: 'test-token',
    CLIENT_ID: '123456789012345678',
    GUILD_ID: '123456789012345678',
    ADMIN_USER_ID: '123456789012345678',
    DB_PATH: path.join('/tmp', `statuswatcher-incident-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  }));
}

test('persists incident timeline and communication state transitions in SQLite', () => {
  const result = run(`
    import {
      acknowledgeIncident,
      appendIncidentEvent,
      createIncident,
      getIncidentTimeline,
      getOpenIncident,
      resolveIncidentCommunication,
    } from './src/store/incidentStore.js';
    const incident = createIncident({
      incidentKey: 'website:website:alpha',
      serviceId: 'website:alpha',
      serviceType: 'website',
      name: 'Alpha',
      status: 'OPEN',
      openedAt: 1000,
      updatedAt: 1000,
      resolvedAt: null,
      errorCategory: 'HTTP_STATUS_FAILURE',
      statusCode: 503,
      downSince: 1000,
    });
    appendIncidentEvent({
      incidentId: incident.id,
      incidentKey: incident.incident_key,
      eventType: 'DETECTED',
      occurredAt: 1000,
      serviceType: 'website',
      serviceId: 'website:alpha',
      errorCategory: 'HTTP_STATUS_FAILURE',
      statusCode: 503,
      durationMs: 20,
    });
    const acknowledged = acknowledgeIncident(incident.id, '123456789012345678', 2000);
    const communicated = resolveIncidentCommunication(incident.id, '123456789012345678', 3000);
    process.stdout.write(JSON.stringify({
      open: getOpenIncident('website:website:alpha'),
      status: communicated.status,
      actor: acknowledged.acknowledged_by,
      events: getIncidentTimeline(incident.id).map(({ event_type, reason, actor_id }) => ({ event_type, reason, actor_id })),
    }));
  `);

  assert.equal(result.open.status, 'ACKNOWLEDGED');
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.equal(result.actor, '123456789012345678');
  assert.deepEqual(result.events.map((item) => item.event_type), ['DETECTED', 'ACKNOWLEDGED', 'COMMUNICATION_RESOLVED']);
  assert.equal(result.events.at(-1).reason, 'COMMUNICATION_RESOLVED');
});

test('prunes old resolved incidents and timeline events while retaining recent records', () => {
  const result = run(`
    import { createIncident, appendIncidentEvent, pruneIncidentData, listRecentIncidents } from './src/store/incidentStore.js';
    const oldIncident = createIncident({ incidentKey: 'website:website:old', serviceId: 'website:old', serviceType: 'website', name: 'Old', status: 'RESOLVED', openedAt: 100, updatedAt: 100, resolvedAt: 100, errorCategory: 'UNKNOWN', statusCode: 500, downSince: 100 });
    appendIncidentEvent({ incidentId: oldIncident.id, incidentKey: oldIncident.incident_key, eventType: 'RESOLVED', occurredAt: 100, serviceType: 'website', serviceId: 'website:old', errorCategory: 'UNKNOWN', statusCode: 500 });
    const recentIncident = createIncident({ incidentKey: 'website:website:recent', serviceId: 'website:recent', serviceType: 'website', name: 'Recent', status: 'RESOLVED', openedAt: 1000, updatedAt: 1000, resolvedAt: 1000, errorCategory: null, statusCode: 200, downSince: null });
    const pruned = pruneIncidentData(500, 500);
    process.stdout.write(JSON.stringify({ pruned, incidents: listRecentIncidents().map(({ incident_key }) => incident_key) }));
  `);

  assert.equal(result.pruned.incidents, 1);
  assert.equal(result.pruned.events, 1);
  assert.deepEqual(result.incidents, ['website:website:recent']);
});
