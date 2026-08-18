import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);
const validEnv = {
  TOKEN: 'token',
  CLIENT_ID: '123456789012345678',
  GUILD_ID: '123456789012345678',
  MONITOR_CHANNEL_ID: '123456789012345678',
  LOG_CHANNEL_ID: '123456789012345678',
  MC_SERVER_IP: '127.0.0.1',
  MC_SERVER_PORT: '25565',
  MC_SERVER_NAME: 'test-server',
  IMPORTANT_ROLE_ID: '123456789012345678',
  ADMIN_USER_ID: '123456789012345678',
  CHECK_INTERVAL: '30',
};

function buildEnv(overrides = {}) {
  const env = { ...process.env, ...validEnv };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function loadConfig(overrides = {}) {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "import('./src/config.js')"],
    { cwd, env: buildEnv(overrides) },
  );
}

function loadConfigSnapshot(overrides = {}) {
  return JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import config from './src/config.js'; process.stdout.write(JSON.stringify(config))",
    ],
    { cwd, env: buildEnv(overrides), encoding: 'utf8' },
  ));
}

test('rejects a non-numeric Minecraft port', () => {
  assert.throws(
    () => loadConfig({ MC_SERVER_PORT: '25565oops' }),
    (error) => error.status === 1,
  );
});

test('rejects a non-positive check interval', () => {
  assert.throws(
    () => loadConfig({ CHECK_INTERVAL: '0' }),
    (error) => error.status === 1,
  );
});

test('accepts valid operational values', () => {
  assert.doesNotThrow(() => loadConfig({ MC_STATUS_TIMEOUT_MS: '2500', MC_MAX_RETRIES: '0' }));
});

test('defaults MC_ENABLE to true for backward compatibility', () => {
  const config = loadConfigSnapshot({ MC_ENABLE: undefined });
  assert.equal(config.mcEnabled, true);
});

test('accepts MC_ENABLE=false without Minecraft connection settings', () => {
  const config = loadConfigSnapshot({
    MC_ENABLE: ' false ',
    MC_SERVER_IP: undefined,
    MC_SERVER_PORT: undefined,
    MC_SERVER_NAME: undefined,
  });
  assert.equal(config.mcEnabled, false);
  assert.equal('mcServerIp' in config, false);
  assert.equal('mcServerPort' in config, false);
  assert.equal('mcServerName' in config, false);
});

test('rejects an invalid MC_ENABLE value', () => {
  assert.throws(
    () => loadConfig({ MC_ENABLE: 'yes' }),
    (error) => error.status === 1,
  );
});

test('rejects an empty MC_ENABLE value', () => {
  assert.throws(
    () => loadConfig({ MC_ENABLE: '  ' }),
    (error) => error.status === 1,
  );
});
