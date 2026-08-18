import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/commands/', import.meta.url);

async function source(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('status command includes database runtime state', async () => {
  const text = await source('status.js');
  assert.match(text, /getDatabaseStates/);
  assert.match(text, /getStatusMessagePayload\(getBotStates\(\), getMcStates\(\), 0, getDatabaseStates\(\)\)/);
});

test('manual recheck includes database runtime state', async () => {
  const text = await source('recheck.js');
  assert.match(text, /getDatabaseStates/);
  assert.match(text, /getStatusMessagePayload\(getBotStates\(\), getMcStates\(\), 0, getDatabaseStates\(\)\)/);
});

test('resend embed supplies database state provider', async () => {
  const text = await source('resendEmbed.js');
  assert.match(text, /getDatabaseStates/);
  assert.match(text, /getMcStates/);
});

test('fetch-bot refresh supplies database state provider', async () => {
  const text = await source('fetchBot.js');
  assert.match(text, /getDatabaseStates/);
});
