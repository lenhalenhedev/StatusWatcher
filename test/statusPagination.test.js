import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatusComponents,
  getStatusPage,
  getStatusPageCount,
  parseStatusComponentId,
} from '../src/handlers/statusPagination.js';

function makeStates(count) {
  return new Map(Array.from({ length: count }, (_, index) => [
    `bot-${index + 1}`,
    { name: `Bot ${index + 1}` },
  ]));
}

test('paginates bots in groups of ten and always exposes at least one page', () => {
  assert.equal(getStatusPageCount(makeStates(0)), 1);
  assert.equal(getStatusPageCount(makeStates(10)), 1);
  assert.equal(getStatusPageCount(makeStates(11)), 2);
  assert.equal(getStatusPage( makeStates(21), 1).bots.length, 10);
  assert.equal(getStatusPage(makeStates(21), 2).bots.length, 1);
});

test('disables previous and next buttons at the respective boundaries', () => {
  const firstRow = buildStatusComponents(0, 3)[0].toJSON().components;
  assert.equal(firstRow[0].disabled, true);
  assert.equal(firstRow[1].disabled, true);
  assert.equal(firstRow[1].label, '1/3');
  assert.equal(firstRow[2].disabled, false);

  const lastRow = buildStatusComponents(2, 3)[0].toJSON().components;
  assert.equal(lastRow[0].disabled, false);
  assert.equal(lastRow[1].label, '3/3');
  assert.equal(lastRow[2].disabled, true);
});

test('parses component IDs without accepting unrelated custom IDs', () => {
  assert.deepEqual(parseStatusComponentId('status-page:next:4'), { action: 'next', page: 4 });
  assert.equal(parseStatusComponentId('other:next:4'), null);
});
