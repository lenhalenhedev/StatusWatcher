import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const srcRoot = path.join(projectRoot, 'src');

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
    return entry.name.endsWith('.js') ? [absolutePath] : [];
  });
}

test('startup uses discord.js clientReady instead of deprecated ready event', () => {
  const source = readSource('src/index.js');
  assert.match(source, /client\.once\(['"]clientReady['"]/);
  assert.doesNotMatch(source, /client\.once\(['"]ready['"]/);
  assert.match(source, /refreshBotRoleFlags/);
  assert.match(source, /from ['"]\.\/monitors\/botMonitor\.js['"]/);
});

test('runtime listener references an imported refreshBotRoleFlags symbol', () => {
  const source = readSource('src/index.js');
  const importLine = source.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/monitors\/botMonitor\.js['"]/s)?.[1] ?? '';
  assert.match(importLine, /\brefreshBotRoleFlags\b/);
});

test('production wires presenceUpdate to automatic bot monitoring', () => {
  const source = readSource('src/index.js');
  assert.match(source, /handlePresenceUpdate/);
  assert.match(source, /client\.on\(['"]presenceUpdate['"]/);
  assert.match(source, /Index\.presenceUpdate/);
});

test('production source does not use deprecated ephemeral response option', () => {
  const deprecatedUses = [];
  for (const filePath of listJavaScriptFiles(srcRoot)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (/\bephemeral\s*:/.test(source)) deprecatedUses.push(path.relative(projectRoot, filePath));
  }
  assert.deepEqual(deprecatedUses, []);
});

test('production source uses MessageFlags.Ephemeral for private interaction responses', () => {
  const responseFiles = [
    'src/commands/history.js',
    'src/commands/mute.js',
    'src/commands/recheck.js',
    'src/commands/resendEmbed.js',
    'src/commands/subscribe.js',
    'src/commands/unmute.js',
    'src/commands/uptime.js',
    'src/commands/fetchBot.js',
    'src/commands/configCommand.js',
    'src/handlers/interactionRouter.js',
    'src/services/statusMessage.js',
  ];
  for (const relativePath of responseFiles) {
    const source = readSource(relativePath);
    assert.match(source, /MessageFlags\.Ephemeral/, `${relativePath} must use MessageFlags.Ephemeral`);
  }
});


test('startup has no alternate deprecated ready listener spelling', () => {
  const source = readSource('src/index.js');
  assert.doesNotMatch(source, /client\.(?:on|once)\(['"]ready['"]/);
  assert.doesNotMatch(source, /client\.(?:on|once)\(\s*`ready`/);
});

test('every module that emits private replies imports MessageFlags from discord.js', () => {
  const responseFiles = [
    'src/commands/history.js',
    'src/commands/list.js',
    'src/commands/mute.js',
    'src/commands/recheck.js',
    'src/commands/resendEmbed.js',
    'src/commands/subscribe.js',
    'src/commands/unmute.js',
    'src/commands/uptime.js',
    'src/commands/fetchBot.js',
    'src/commands/configCommand.js',
    'src/handlers/interactionRouter.js',
    'src/services/statusMessage.js',
  ];
  for (const relativePath of responseFiles) {
    const source = readSource(relativePath);
    assert.match(source, /import[\s\S]*\bMessageFlags\b[\s\S]*from ['"]discord\.js['"];/, `${relativePath} must import MessageFlags`);
  }
});

test('no source file contains the deprecated interaction option in multiline or inline form', () => {
  const deprecatedUses = [];
  for (const filePath of listJavaScriptFiles(srcRoot)) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (/\bephemeral\b\s*:/i.test(source)) deprecatedUses.push(path.relative(projectRoot, filePath));
  }
  assert.deepEqual(deprecatedUses, []);
});
