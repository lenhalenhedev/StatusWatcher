import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTargetLabel, parseBotInput } from '../src/handlers/botInput.js';

test('parses raw IDs and user mentions while trimming whitespace', () => {
  assert.deepEqual(parseBotInput(' <@12345678901234567>, 98765432109876543 '), {
    validIds: ['12345678901234567', '98765432109876543'],
    invalidTokens: [],
    duplicateTokens: [],
  });
});

test('classifies malformed tokens and duplicate IDs without throwing', () => {
  assert.deepEqual(parseBotInput('not-an-id,12345678901234567,<@!12345678901234567>'), {
    validIds: ['12345678901234567'],
    invalidTokens: ['not-an-id'],
    duplicateTokens: ['<@!12345678901234567>'],
  });
});

test('uses the most useful available Discord display label', () => {
  assert.equal(formatTargetLabel({ displayName: 'Nickname', user: { username: 'user' } }), 'Nickname');
  assert.equal(formatTargetLabel({ user: { globalName: 'Global', username: 'user' } }), 'Global');
  assert.equal(formatTargetLabel({ user: { username: 'user' } }), 'user');
  assert.equal(formatTargetLabel({ id: '12345678901234567' }), '12345678901234567');
});
