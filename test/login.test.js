import assert from 'node:assert/strict';
import test from 'node:test';
import { loginWithHandling } from '../src/core/login.js';

test('returns the client login result when authentication succeeds', async () => {
  const client = { login: async (token) => `logged:${token}` };
  const errors = [];

  const result = await loginWithHandling(client, 'token', (error) => errors.push(error));

  assert.equal(result, 'logged:token');
  assert.deepEqual(errors, []);
});

test('reports authentication failures without creating an unhandled rejection', async () => {
  const failure = new Error('invalid token');
  const client = { login: async () => { throw failure; } };
  const errors = [];

  const result = await loginWithHandling(client, 'token', (error) => errors.push(error));

  assert.equal(result, null);
  assert.deepEqual(errors, [failure]);
});
