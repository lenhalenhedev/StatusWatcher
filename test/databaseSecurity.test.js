import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceFiles = [
  'src/commands/configCommand.js',
  'src/monitors/databaseMonitor.js',
  'src/store/databaseStore.js',
  'src/handlers/embedBuilder.js',
];

async function sourceText() {
  return (await Promise.all(sourceFiles.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');
}

test('database runtime never logs or embeds plaintext secret fields', async () => {
  const source = await sourceText();
  assert.doesNotMatch(source, /log(?:Info|Error)\([^\n]*(?:connectionString|certificate|password|attachment\.url)/i);
  assert.doesNotMatch(source, /embed\.[\s\S]{0,200}(?:connectionString|certificate|attachment\.url)/i);
});

test('database remove labels use metadata only', async () => {
  const source = await readFile(new URL('../src/commands/configView.js', import.meta.url), 'utf8');
  assert.match(source, /target\.name/);
  assert.match(source, /target\.engine/);
  assert.doesNotMatch(source, /target\.(host|port|connection|password|username)/i);
});

test('certificate upload policy rejects private-key markers and deletes source message', async () => {
  const source = await readFile(new URL('../src/commands/configCommand.js', import.meta.url), 'utf8');
  assert.match(source, /PRIVATE KEY/);
  assert.match(source, /message\.delete\(\)/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.doesNotMatch(source, /err\.message/);
});

test('configuration failures use generic Discord responses', async () => {
  const source = await readFile(new URL('../src/commands/configCommand.js', import.meta.url), 'utf8');
  assert.match(source, /Configuration was not saved\. Check the supplied values and try again/);
  assert.match(source, /Certificate was not saved\. Check that it is a valid CA certificate/);
});
