import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import config from '../src/config.js';
import { commandMap } from '../src/commands/index.js';
import * as reliability from '../src/commands/reliability.js';

function interaction(userId, window = null) {
  const replies = [];
  return {
    user: { id: userId },
    options: { getString: () => window },
    replies,
    async reply(value) { replies.push(value); },
  };
}

test('registers the reliability command with selectable bounded windows', () => {
  assert.equal(commandMap.get('reliability'), reliability);
  const option = reliability.data.options[0];
  assert.equal(option.name, 'window');
  assert.deepEqual(option.choices.map((choice) => choice.value), ['24h', '7d', '30d']);
});

test('rejects non-admin reliability requests ephemerally', async () => {
  const request = interaction('not-the-admin');
  await reliability.execute(request);
  assert.equal(request.replies.length, 1);
  assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(request.replies[0].content, /admin/i);
});

test('renders aggregate no-data metrics without exposing service identifiers', async () => {
  const request = interaction(config.adminUserId, '24h');
  await reliability.execute(request);
  const embed = request.replies[0].embeds[0].toJSON();
  const text = JSON.stringify(embed);
  assert.match(text, /Availability/);
  assert.match(text, /Latency/);
  assert.match(text, /No data/);
  assert.equal(text.includes('website:'), false);
});
