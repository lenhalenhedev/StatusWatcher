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
