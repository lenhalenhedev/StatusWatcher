import assert from 'node:assert/strict';
import test from 'node:test';

const { runBackgroundTask } = await import('../src/utils/backgroundTask.js');

test('contains rejected background tasks and resolves without propagating the failure', async () => {
  const result = await runBackgroundTask('test.background', async () => {
    throw new Error('background failure');
  });

  assert.equal(result, undefined);
});

test('returns successful background task values', async () => {
  const result = await runBackgroundTask('test.background', async () => 'completed');

  assert.equal(result, 'completed');
});
