import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statuswatcher-website-embed-')), 'uptime.db');
process.env.TOKEN ??= 'test-token';
process.env.CLIENT_ID ??= '123456789012345678';
process.env.GUILD_ID ??= '123456789012345678';
process.env.ADMIN_USER_ID ??= '123456789012345678';

const { buildStatusEmbed } = await import('../src/handlers/embedBuilder.js');
const { registerTarget } = await import('../src/utils/uptimeTracker.js');
const { createIncident, updateIncident } = await import('../src/store/incidentStore.js');

function fieldsOf(embed) {
  return embed.toJSON().fields ?? [];
}

test('renders Websites before Databases and includes the HTTP response status', () => {
  registerTarget('website_embed_test', 'Status Website', { type: 'website' });
  const websiteStates = new Map([['website_embed_test', {
    id: 'website_embed_test',
    name: 'Status Website',
    url: 'https://example.com/health?token=do-not-show-this',
    isConfirmedDown: false,
    lastHealthyAt: Date.now(),
    lastStatus: 204,
    lastError: null,
  }]]);
  const databaseStates = new Map([['database_embed_test', {
    id: 'database_embed_test',
    name: 'Database',
    engine: 'postgres',
    isConfirmedDown: false,
    lastHealthyAt: Date.now(),
  }]]);

  const fields = fieldsOf(buildStatusEmbed(new Map(), new Map(), 0, databaseStates, websiteStates));
  assert.equal(fields[0].name, '🌐 Websites');
  assert.equal(fields[1].name, '🗄️ Databases');
  assert.match(fields[0].value, /HTTP 204/);
  assert.match(fields[0].value, /https:\/\/example\.com\/health/);
  assert.equal(fields[0].value.includes('do-not-show-this'), false);
});

test('renders confirmed website failures with safe status and bounded field length', () => {
  registerTarget('website_embed_down', 'Down Website', { type: 'website' });
  const incident = createIncident({
    incidentKey: 'website:website_embed_down',
    serviceId: 'website_embed_down',
    serviceType: 'website',
    name: 'Down Website',
    status: 'OPEN',
    openedAt: Date.now(),
    updatedAt: Date.now(),
    resolvedAt: null,
    errorCategory: 'HTTP_STATUS_FAILURE',
    statusCode: 503,
    downSince: Date.now(),
  });
  const websiteStates = new Map([['website_embed_down', {
    id: 'website_embed_down',
    name: 'Down Website',
    url: 'https://example.com/health',
    isConfirmedDown: true,
    confirmedDownAt: Date.now(),
    lastHealthyAt: null,
    lastStatus: 503,
    lastError: 'HTTP status 503',
  }]]);

  const fields = fieldsOf(buildStatusEmbed(new Map(), new Map(), 0, null, websiteStates));
  assert.equal(fields[0].name, '🌐 Websites');
  assert.match(fields[0].value, /DOWN/);
  assert.match(fields[0].value, /HTTP 503/);
  assert.ok(fields[0].value.includes(`Incident ID: \`${incident.id}\``));
  updateIncident(incident.id, { status: 'ACKNOWLEDGED', acknowledgedBy: '123456789012345678', acknowledgedAt: Date.now() });
  const acknowledgedFields = fieldsOf(buildStatusEmbed(new Map(), new Map(), 0, null, websiteStates));
  assert.ok(acknowledgedFields[0].value.includes(`Incident ID: \`${incident.id}\``));
  assert.ok(acknowledgedFields[0].value.length <= 1024);
});
