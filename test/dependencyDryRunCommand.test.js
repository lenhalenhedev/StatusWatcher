import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import { commandMap } from '../src/commands/index.js';
import * as dependency from '../src/commands/dependency.js';
import * as dryRun from '../src/commands/dryRun.js';
import * as diagnose from '../src/commands/diagnose.js';

function deniedInteraction() {
  const replies = [];
  return {
    user: { id: 'not-the-admin' },
    options: { getSubcommand: () => 'list', getString: () => null, getInteger: () => null },
    replies,
    async reply(value) { replies.push(value); },
  };
}

test('registers dependency and dry-run command names and subcommands', () => {
  assert.equal(commandMap.get('dependency'), dependency);
  assert.equal(commandMap.get('dry-run'), dryRun);
  assert.equal(commandMap.get('diagnose'), diagnose);
  assert.deepEqual(dependency.data.options.map((option) => option.name), ['add', 'remove', 'list']);
});

test('denies dependency and dry-run commands to non-admin users', async () => {
  const dependencyRequest = deniedInteraction();
  await dependency.execute(dependencyRequest);
  assert.equal(dependencyRequest.replies[0].flags, MessageFlags.Ephemeral);

  const dryRunRequest = deniedInteraction();
  await dryRun.execute(dryRunRequest);
  assert.equal(dryRunRequest.replies[0].flags, MessageFlags.Ephemeral);

  const diagnoseRequest = deniedInteraction();
  await diagnose.execute(diagnoseRequest);
  assert.equal(diagnoseRequest.replies[0].flags, MessageFlags.Ephemeral);
});
