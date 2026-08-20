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

test('registers exact incident command names, removes the incident_id option, and validates administrator-only execution', () => {
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

test('renders open incidents as service dropdown options and acknowledges the selected service', () => {
  const result = run(`
    import * as acknowledge from './src/commands/acknowledge.js';
    import { createIncident, getIncident } from './src/store/incidentStore.js';
    const website = createIncident({ incidentKey: 'website:status-page', serviceId: 'status-page', serviceType: 'website', name: 'Status page', status: 'OPEN', openedAt: 1000, updatedAt: 1000, errorCategory: 'HTTP_STATUS_FAILURE', statusCode: 503, downSince: 1000 });
    const database = createIncident({ incidentKey: 'database:primary', serviceId: 'primary', serviceType: 'database', name: 'Primary database', status: 'OPEN', openedAt: 1100, updatedAt: 1100, errorCategory: 'CONNECTION_FAILURE', downSince: 1100 });
    createIncident({ incidentKey: 'bot:status-bot', serviceId: 'status-bot', serviceType: 'bot', name: 'Status bot', status: 'OPEN', openedAt: 1200, updatedAt: 1200, errorCategory: 'BOT_OFFLINE', downSince: 1200 });
    createIncident({ incidentKey: 'minecraft:survival', serviceId: 'survival', serviceType: 'minecraft', name: 'Survival server', status: 'OPEN', openedAt: 1300, updatedAt: 1300, errorCategory: 'MC_OFFLINE', downSince: 1300 });
    const commandInteraction = {
      user: { id: '123456789012345678' },
      replies: [],
      async reply(payload) { this.replies.push(payload); },
    };
    await acknowledge.execute(commandInteraction);
    const menu = commandInteraction.replies[0].components[0].components[0].toJSON();
    const selectedValue = menu.options.find((option) => option.label.includes('Status page')).value;
    const componentInteraction = {
      user: { id: '123456789012345678' },
      customId: menu.custom_id,
      values: [selectedValue],
      replies: [],
      async reply(payload) { this.replies.push(payload); },
    };
    await acknowledge.handleInteraction(componentInteraction);
    const stored = getIncident(website.id);
    process.stdout.write(JSON.stringify({
      commandOptions: acknowledge.data.toJSON().options ?? [],
      menu,
      stored: { status: stored.status, acknowledged_by: stored.acknowledged_by },
      reply: componentInteraction.replies[0].content,
      untouchedDatabase: getIncident(database.id).status,
    }));
  `);
  assert.deepEqual(result.commandOptions, []);
  assert.equal(result.menu.custom_id, 'acknowledge:service');
  assert.equal(result.menu.options.length, 4);
  assert.ok(result.menu.options.some((option) => option.label.includes('Website') && option.label.includes('Status page')));
  assert.ok(result.menu.options.some((option) => option.label.includes('Database') && option.label.includes('Primary database')));
  assert.ok(result.menu.options.some((option) => option.label.includes('Bot') && option.label.includes('Status bot')));
  assert.ok(result.menu.options.some((option) => option.label.includes('Minecraft') && option.label.includes('Survival server')));
  assert.deepEqual(result.stored, { status: 'ACKNOWLEDGED', acknowledged_by: '123456789012345678' });
  assert.match(result.reply, /Status page/);
  assert.equal(result.untouchedDatabase, 'OPEN');
});

test('rejects stale service selections and unauthorized component interactions', () => {
  const result = run(`
    import * as acknowledge from './src/commands/acknowledge.js';
    import { createIncident } from './src/store/incidentStore.js';
    createIncident({ incidentKey: 'bot:bot-1', serviceId: 'bot-1', serviceType: 'bot', name: 'Bot one', status: 'OPEN', openedAt: 1000, updatedAt: 1000, downSince: 1000 });
    const stale = {
      user: { id: '123456789012345678' },
      customId: 'acknowledge:service',
      values: ['bot:missing'],
      replies: [],
      async reply(payload) { this.replies.push(payload); },
    };
    await acknowledge.handleInteraction(stale);
    const unauthorized = {
      user: { id: 'not-admin' },
      customId: 'acknowledge:service',
      values: ['bot:bot-1'],
      replies: [],
      async reply(payload) { this.replies.push(payload); },
    };
    await acknowledge.handleInteraction(unauthorized);
    process.stdout.write(JSON.stringify({ stale: stale.replies[0], unauthorized: unauthorized.replies[0] }));
  `);
  assert.match(result.stale.content, /does not have an open incident|invalid|no longer available/i);
  assert.equal(result.stale.flags, MessageFlags.Ephemeral);
  assert.match(result.unauthorized.content, /configured admin/i);
  assert.equal(result.unauthorized.flags, MessageFlags.Ephemeral);
});

test('acknowledges an active incident, resolves communication, and rejects repeated mutations', () => {
  const result = run(`
    import * as acknowledge from './src/commands/acknowledge.js';
    import * as resolveIncident from './src/commands/resolveIncident.js';
    import { createIncident, getIncident } from './src/store/incidentStore.js';
    const incident = createIncident({ incidentKey: 'website:website_1', serviceId: 'website_1', serviceType: 'website', name: 'Status page', status: 'OPEN', openedAt: 1000, updatedAt: 1000, errorCategory: 'HTTP_STATUS_FAILURE', statusCode: 503, downSince: 1000 });
    function interaction() {
      return {
        user: { id: '123456789012345678' },
        options: { getInteger: () => incident.id },
        replies: [],
        async reply(payload) { this.replies.push(payload); },
      };
    }
    const ackCommand = interaction();
    await acknowledge.execute(ackCommand);
    const selectedValue = ackCommand.replies[0].components[0].components[0].toJSON().options[0].value;
    const ack = { ...interaction(), customId: 'acknowledge:service', values: [selectedValue] };
    await acknowledge.handleInteraction(ack);
    const resolve = interaction();
    await resolveIncident.execute(resolve);
    const repeatedAck = { ...interaction(), customId: 'acknowledge:service', values: [selectedValue] };
    await acknowledge.handleInteraction(repeatedAck);
    const repeatedResolve = interaction();
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
  assert.match(result.replies[2], /does not have an open incident anymore/i);
  assert.match(result.replies[3], /already resolved/i);
});
