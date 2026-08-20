import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
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
    DB_PATH: path.join('/tmp', `statuswatcher-incident-command-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  }));
}

test('registers exact incident command names and validates administrator-only execution', () => {
  const result = run(`
    import { MessageFlags } from 'discord.js';
    import * as acknowledge from './src/commands/acknowledge.js';
    import * as resolveIncident from './src/commands/resolveIncident.js';
    const replies = [];
    const interaction = {
      user: { id: 'not-admin' },
      options: { getInteger: () => 1 },
      async reply(payload) { replies.push(payload); },
    };
    await acknowledge.execute(interaction);
    await resolveIncident.execute(interaction);
    process.stdout.write(JSON.stringify({
      names: [acknowledge.data.name, resolveIncident.data.name],
      flags: replies.map((reply) => reply.flags),
      content: replies.map((reply) => reply.content),
    }));
  `);

  assert.deepEqual(result.names, ['acknowledge', 'resolve-incident']);
  assert.deepEqual(result.flags, [MessageFlags.Ephemeral, MessageFlags.Ephemeral]);
  assert.ok(result.content.every((content) => /configured admin/i.test(content)));
});

test('acknowledges an active incident, resolves communication, and rejects repeated mutations', () => {
  const result = run(`
    import * as acknowledge from './src/commands/acknowledge.js';
    import * as resolveIncident from './src/commands/resolveIncident.js';
    import { createIncident, getIncident } from './src/store/incidentStore.js';
    const incident = createIncident({ incidentKey: 'website:website_1', serviceId: 'website_1', serviceType: 'website', name: 'Status page', status: 'OPEN', openedAt: 1000, updatedAt: 1000, errorCategory: 'HTTP_STATUS_FAILURE', statusCode: 503, downSince: 1000 });
    function interaction(command) {
      return {
        user: { id: '123456789012345678' },
        options: { getInteger: () => incident.id },
        replies: [],
        async reply(payload) { this.replies.push(payload); },
      };
    }
    const ack = interaction(acknowledge);
    await acknowledge.execute(ack);
    const resolve = interaction(resolveIncident);
    await resolveIncident.execute(resolve);
    const repeatedAck = interaction(acknowledge);
    await acknowledge.execute(repeatedAck);
    const repeatedResolve = interaction(resolveIncident);
    await resolveIncident.execute(repeatedResolve);
    const stored = getIncident(incident.id);
    process.stdout.write(JSON.stringify({
      stored: { status: stored.status, acknowledged_by: stored.acknowledged_by, communication_resolved_by: stored.communication_resolved_by },
      replies: [ack.replies[0].content, resolve.replies[0].content, repeatedAck.replies[0].content, repeatedResolve.replies[0].content],
    }));
  `);

  assert.deepEqual(result.stored, {
    status: 'ACKNOWLEDGED',
    acknowledged_by: '123456789012345678',
    communication_resolved_by: '123456789012345678',
  });
  assert.match(result.replies[0], /acknowledged/i);
  assert.match(result.replies[0], /STILL_DOWN reminders are suppressed/i);
  assert.match(result.replies[0], /health monitoring continues/i);
  assert.match(result.replies[0], /UP event will automatically resolve/i);
  assert.match(result.replies[1], /communication resolved/i);
  assert.match(result.replies[2], /not in an open state/i);
  assert.match(result.replies[3], /already resolved/i);
});
