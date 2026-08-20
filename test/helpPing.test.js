import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import * as ping from '../src/commands/ping.js';
import * as help from '../src/commands/help.js';
import { commandMap, commandModules } from '../src/commands/index.js';
import { createInteractionHandler } from '../src/handlers/interactionRouter.js';
import {
  HELP_PAGE_SIZE,
  buildHelpComponents,
  buildHelpEntries,
  getHelpPage,
  parseHelpComponentId,
} from '../src/handlers/helpPagination.js';

function commandModule(name, description, options = []) {
  return {
    data: {
      name,
      toJSON: () => ({ name, description, options }),
    },
  };
}

function interaction(overrides = {}) {
  return {
    createdTimestamp: Date.now() - 37,
    client: { ws: { ping: 82 } },
    customId: undefined,
    replies: [],
    updates: [],
    async reply(payload) { this.replies.push(payload); this.replied = true; },
    async update(payload) { this.updates.push(payload); },
    isAutocomplete: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    isChatInputCommand: () => false,
    isRepliable: () => true,
    ...overrides,
  };
}

test('registers public `/ping` and `/help` slash commands with English descriptions', () => {
  assert.equal(ping.data.toJSON().name, 'ping');
  assert.equal(help.data.toJSON().name, 'help');
  assert.match(ping.data.toJSON().description, /latency/i);
  assert.match(help.data.toJSON().description, /commands|help/i);
  assert.equal(commandModules.filter((module) => module.data.name === 'help').length, 1);
  assert.equal(commandModules.filter((module) => module.data.name === 'ping').length, 1);
  assert.strictEqual(commandMap.get('help'), help);
  assert.strictEqual(commandMap.get('ping'), ping);
});

test('returns one plain-text ping response with Pong, local latency, and API latency', async () => {
  const testInteraction = interaction();
  await ping.execute(testInteraction);
  assert.equal(testInteraction.replies.length, 1);
  const response = testInteraction.replies[0];
  assert.equal(typeof response, 'object');
  assert.equal(Object.hasOwn(response, 'embeds'), false);
  assert.equal(Object.hasOwn(response, 'components'), false);
  assert.equal(Object.hasOwn(response, 'flags'), false);
  assert.match(response.content, /^Pong!\nLatency: \s+\d+ms\nAPI Latency: \s+\d+ms$/);
});

test('formats unavailable gateway latency safely without throwing', async () => {
  const testInteraction = interaction({ client: { ws: { ping: Infinity } } });
  await ping.execute(testInteraction);
  assert.equal(testInteraction.replies.length, 1);
  assert.match(testInteraction.replies[0].content, /API Latency:\s+N\/A/);
});

test('builds bounded help entries from the registered command metadata and documents parameters', () => {
  const entries = buildHelpEntries([
    commandModule('alpha', 'Alpha command', [{ name: 'target', description: 'Target name', required: true }]),
  ]);
  assert.deepEqual(entries, [{
    name: '/alpha',
    value: 'Alpha command\nUsage: `/alpha <target>`\nParameters: `target` (required) — Target name',
  }]);
});

test('paginates all command entries with one-based labels and disabled boundary controls', () => {
  const entries = Array.from({ length: HELP_PAGE_SIZE * 2 + 1 }, (_, index) => ({ name: `/cmd-${index}`, value: 'Description' }));
  const first = getHelpPage(entries, 0);
  assert.equal(first.totalPages, 3);
  assert.equal(first.currentPage, 0);
  assert.equal(first.entries.length, HELP_PAGE_SIZE);
  const last = getHelpPage(entries, 99);
  assert.equal(last.currentPage, 2);
  assert.equal(last.entries.length, 1);
  const rows = buildHelpComponents(0, 3);
  const buttons = rows[0].components.map((component) => component.toJSON());
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].label, '1/3');
  assert.equal(buttons[2].disabled, false);
});

test('parses only strict help component identifiers', () => {
  assert.deepEqual(parseHelpComponentId('help:next:2'), { action: 'next', page: 2 });
  assert.deepEqual(parseHelpComponentId('help:prev:0'), { action: 'prev', page: 0 });
  assert.equal(parseHelpComponentId('help:next:-1'), null);
  assert.equal(parseHelpComponentId('help:next:2:extra'), null);
  assert.equal(parseHelpComponentId('status-page:next:2'), null);
});

test('serves a public help page with all entries and pagination controls when needed', async () => {
  const modules = Array.from({ length: HELP_PAGE_SIZE + 1 }, (_, index) => commandModule(`cmd-${index}`, `Command ${index}`));
  const testInteraction = interaction();
  await help.execute(testInteraction, { commandModules: modules });
  const response = testInteraction.replies[0];
  assert.equal(response.embeds.length, 1);
  assert.equal(response.embeds[0].data.fields.length, HELP_PAGE_SIZE);
  assert.equal(response.components.length, 1);
  assert.match(response.embeds[0].data.footer.text, /Page 1 of 2/);
});

test('updates a help page through the existing interaction-router component contract', async () => {
  const modules = Array.from({ length: HELP_PAGE_SIZE + 1 }, (_, index) => commandModule(`cmd-${index}`, `Command ${index}`));
  const testInteraction = interaction({
    customId: 'help:next:0',
    isButton: () => true,
  });
  assert.equal(help.handlesInteraction(testInteraction), true);
  await help.handleInteraction(testInteraction, { commandModules: modules });
  assert.equal(testInteraction.updates.length, 1);
  assert.match(testInteraction.updates[0].embeds[0].data.footer.text, /Page 2 of 2/);
});

test('routes help buttons through the central interaction handler and updates the page', async () => {
  const modules = Array.from({ length: HELP_PAGE_SIZE + 1 }, (_, index) => commandModule(`cmd-${index}`, `Command ${index}`));
  const testInteraction = interaction({
    customId: 'help:next:0',
    isButton: () => true,
  });
  const handler = createInteractionHandler({
    commandMap: new Map([['help', { ...help, handlesInteraction: help.handlesInteraction, handleInteraction: (item) => help.handleInteraction(item, { commandModules: modules }) }]]),
    updateStatusComponent: async () => { throw new Error('status fallback should not run'); },
    getBotStates: () => new Map(),
    getMcState: () => null,
    getMcStates: () => new Map(),
    getDatabaseStates: () => new Map(),
    reportError: () => { throw new Error('router should not report an error'); },
  });
  await handler(testInteraction);
  assert.equal(testInteraction.updates.length, 1);
  assert.match(testInteraction.updates[0].embeds[0].data.footer.text, /Page 2 of 2/);
});

test('rejects malformed help component ids with a private safe response', async () => {
  const testInteraction = interaction({
    customId: 'help:unexpected:0',
    isButton: () => true,
  });
  assert.equal(help.handlesInteraction(testInteraction), true);
  await help.handleInteraction(testInteraction, { commandModules: [] });
  assert.equal(testInteraction.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(testInteraction.replies[0].content, /invalid|expired/i);
});
