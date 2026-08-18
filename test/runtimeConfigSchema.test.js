import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMinecraftAddress,
  parseRuntimeConfigValue,
  RUNTIME_CONFIG_DEFINITIONS,
} from '../src/config/runtimeConfigSchema.js';

test('parses Minecraft host and port from domain:port', () => {
  assert.deepEqual(parseMinecraftAddress('play.example.com:25565'), {
    host: 'play.example.com',
    port: 25565,
  });
});

test('rejects malformed Minecraft address and invalid port', () => {
  assert.throws(() => parseMinecraftAddress('https://example.com:25565'));
  assert.throws(() => parseMinecraftAddress('example.com:0'));
  assert.throws(() => parseMinecraftAddress('example.com:not-a-port'));
});

test('parses integer runtime settings using their declared bounds', () => {
  assert.equal(parseRuntimeConfigValue('checkIntervalSec', '45'), 45);
  assert.throws(() => parseRuntimeConfigValue('checkIntervalSec', '0'));
  assert.throws(() => parseRuntimeConfigValue('mcMaxRetries', '-1'));
});

test('parses comma-separated still-down backoff values', () => {
  assert.deepEqual(parseRuntimeConfigValue('stillDownBackoffSec', '90, 300, 1800'), [90, 300, 1800]);
  assert.throws(() => parseRuntimeConfigValue('stillDownBackoffSec', '90, nope'));
});

test('defines every config button requested by the operator', () => {
  for (const key of [
    'importantRoleId',
    'monitorChannelId',
    'logChannelId',
    'checkIntervalSec',
    'confirmDownThresholdSec',
    'checkIntervalDisplayLogSec',
    'stillDownBackoffSec',
    'mcRetryBaseMs',
    'mcMaxRetries',
    'mcStatusTimeoutMs',
    'dailyDigestCron',
  ]) {
    assert.ok(RUNTIME_CONFIG_DEFINITIONS[key], `missing definition for ${key}`);
  }
});
