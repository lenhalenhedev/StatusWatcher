import assert from 'node:assert/strict';
import test from 'node:test';

const { createInteractionHandler } = await import('../src/handlers/interactionRouter.js');

function baseInteraction(overrides = {}) {
  return {
    isAutocomplete: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    isChatInputCommand: () => false,
    isRepliable: () => true,
    deferred: false,
    replied: false,
    async reply(payload) { this.replyPayload = payload; },
    async editReply(payload) { this.editPayload = payload; },
    ...overrides,
  };
}

test('dispatches chat commands through the command map', async () => {
  let executed = false;
  const handler = createInteractionHandler({
    commandMap: new Map([['status', { execute: async () => { executed = true; } }]]),
    updateStatusComponent: async () => {},
    getBotStates: () => new Map(),
    getMcState: () => ({}),
  });

  await handler(baseInteraction({
    commandName: 'status',
    isChatInputCommand: () => true,
  }));

  assert.equal(executed, true);
});

test('contains failures from the error reporter while replying to command errors', async () => {
  const handler = createInteractionHandler({
    commandMap: new Map([['status', { execute: async () => { throw new Error('command failure'); } }]]),
    updateStatusComponent: async () => {},
    getBotStates: () => new Map(),
    getMcState: () => ({}),
    reportError: async () => { throw new Error('reporting failure'); },
  });
  const currentInteraction = baseInteraction({
    commandName: 'status',
    isChatInputCommand: () => true,
  });

  await handler(currentInteraction);

  assert.equal(currentInteraction.replyPayload.content, 'An error occurred while processing the command.');
});

test('routes unclaimed buttons to the status component handler', async () => {
  let updated = false;
  const handler = createInteractionHandler({
    commandMap: new Map(),
    updateStatusComponent: async () => { updated = true; },
    getBotStates: () => new Map(),
    getMcState: () => ({}),
  });

  await handler(baseInteraction({
    customId: 'status-page:next:0',
    isButton: () => true,
  }));

  assert.equal(updated, true);
});

test('routes config buttons, selects and modals to the config handler', async () => {
  const routed = [];
  const configCommand = {
    handlesInteraction: (interaction) => String(interaction.customId).startsWith('config:'),
    handleInteraction: async (interaction) => routed.push(interaction.customId),
  };
  const handler = createInteractionHandler({
    commandMap: new Map([['config', configCommand]]),
    updateStatusComponent: async () => { throw new Error('should not route config component to status'); },
    getBotStates: () => new Map(),
    getMcState: () => ({}),
  });

  await handler(baseInteraction({
    customId: 'config:open:add_mc',
    isButton: () => true,
  }));
  await handler(baseInteraction({
    customId: 'config:remove_mc:select:0',
    isStringSelectMenu: () => true,
  }));
  await handler(baseInteraction({
    customId: 'config:modal:monitorChannelId',
    isModalSubmit: () => true,
  }));

  assert.deepEqual(routed, [
    'config:open:add_mc',
    'config:remove_mc:select:0',
    'config:modal:monitorChannelId',
  ]);
});
