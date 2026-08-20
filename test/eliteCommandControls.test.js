import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { MessageFlags } from 'discord.js';

const ROOT = new URL('..', import.meta.url);
const NODE = process.execPath;

function run(script) {
  return JSON.parse(execFileSync(NODE, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    env: {
      ...process.env,
      TOKEN: 'test-token',
      CLIENT_ID: '123456789012345678',
      GUILD_ID: '123456789012345678',
      ADMIN_USER_ID: '123456789012345678',
      DB_PATH: `/tmp/statuswatcher-elite-command-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    },
    encoding: 'utf8',
  }));
}

test('registers SLO, audit, and ownership commands with unique names', () => {
  const result = run(`
    import { commandModules } from './src/commands/index.js';
    const names = commandModules.map((module) => module.data.name);
    process.stdout.write(JSON.stringify({ names, unique: new Set(names).size === names.length }));
  `);
  assert.equal(result.unique, true);
  assert.deepEqual(result.names.slice(-5), ['slo', 'audit', 'ownership', 'help', 'ping']);
});

test('denies the three elite control commands to non-admin users', () => {
  const result = run(`
    import * as slo from './src/commands/slo.js';
    import * as audit from './src/commands/audit.js';
    import * as ownership from './src/commands/ownership.js';
    const replies = [];
    const interaction = { user: { id: '999999999999999999' }, options: { getSubcommand: () => 'list', getInteger: () => null }, async reply(payload) { replies.push(payload); } };
    await slo.execute(interaction); await audit.execute(interaction); await ownership.execute(interaction);
    process.stdout.write(JSON.stringify(replies.map((reply) => ({ content: reply.content, flags: reply.flags }))));
  `);
  assert.equal(result.length, 3);
  for (const reply of result) {
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(reply.content, /configured administrator/i);
  }
});

test('uses injected persistence and redacted output for SLO, audit, and ownership actions', () => {
  const result = run(`
    import * as slo from './src/commands/slo.js';
    import * as audit from './src/commands/audit.js';
    import * as ownership from './src/commands/ownership.js';
    const replies = [];
    const makeInteraction = (subcommand, values) => ({
      user: { id: '123456789012345678' },
      options: {
        getSubcommand: () => subcommand,
        getString: (name) => values[name] ?? null,
        getNumber: () => values.target_percent ?? null,
        getInteger: () => values.limit ?? values.window_days ?? null,
        getRole: () => ({ id: values.role_id }),
      },
      async reply(payload) { replies.push(payload.content); },
    });
    await slo.execute(makeInteraction('set', { service_type: 'website', service_id: 'website_1', target_percent: 99.9, window_days: 30 }), {
      setSlo: (input) => ({ target_percent: input.targetPercent, window_days: input.windowDays, maintenance_policy: input.maintenancePolicy }),
    });
    await audit.execute(makeInteraction('list', { limit: 1 }), { listAudit: () => [{ created_at: 0, action: 'SET_SLO', target_type: 'website', target_id: 'website_1', value_hash: 'hash-only' }] });
    await ownership.execute(makeInteraction('set', { service_type: 'website', service_id: 'website_1', role_id: '123456789012345678' }), {
      setOwnership: () => ({ service_type: 'website', service_id: 'website_1', role_id: '123456789012345678' }),
    });
    process.stdout.write(JSON.stringify(replies));
  `);
  assert.equal(result.length, 3);
  assert.match(result[0], /99\.9%/);
  assert.match(result[1], /hash-only/);
  assert.doesNotMatch(result[1], /secret|password|token/i);
  assert.match(result[2], /Ownership saved/);
});
