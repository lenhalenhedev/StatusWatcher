import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);
const validEnv = {
  TOKEN: 'token',
  CLIENT_ID: '123456789012345678',
  GUILD_ID: '123456789012345678',
  ADMIN_USER_ID: '123456789012345678',
};

function buildEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...validEnv,
    DB_PATH: path.join(
      '/tmp',
      `statuswatcher-config-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    ),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
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

test('boots without operational environment values before /config is used', () => {
  const config = loadConfigSnapshot();
  assert.equal(config.mcEnabled, false);
  assert.deepEqual(config.mcServers, []);
  assert.equal(config.monitorChannelId, null);
  assert.equal(config.logChannelId, null);
});

test('MC_ENABLE=false keeps legacy Minecraft migration disabled', () => {
  const config = loadConfigSnapshot({
    MC_ENABLE: 'false',
    MC_SERVER_IP: '127.0.0.1',
    MC_SERVER_PORT: '25565',
    MC_SERVER_NAME: 'legacy-server',
  });
  assert.equal(config.mcEnabled, false);
  assert.deepEqual(config.mcServers, []);
});

test('legacy MC_ENABLE=true can migrate a valid old Minecraft tuple once', () => {
  const config = loadConfigSnapshot({
    MC_ENABLE: 'true',
    MC_SERVER_IP: '127.0.0.1',
    MC_SERVER_PORT: '25565',
    MC_SERVER_NAME: 'legacy-server',
  });
  assert.equal(config.mcEnabled, true);
  assert.equal(config.mcServers.length, 1);
  assert.equal(config.mcServers[0].name, 'legacy-server');
  assert.equal(config.mcServers[0].host, '127.0.0.1');
  assert.equal(config.mcServers[0].port, 25565);
});

test('invalid legacy Minecraft tuple is ignored instead of becoming runtime config', () => {
  const config = loadConfigSnapshot({
    MC_ENABLE: 'true',
    MC_SERVER_IP: '127.0.0.1',
    MC_SERVER_PORT: 'not-a-port',
    MC_SERVER_NAME: 'legacy-server',
  });
  assert.equal(config.mcEnabled, false);
  assert.deepEqual(config.mcServers, []);
});

test('operational defaults are available until values are saved through /config', () => {
  const config = loadConfigSnapshot();
  assert.equal(config.checkInterval, 30_000);
  assert.equal(config.confirmDownThresholdMs, 60_000);
  assert.equal(Object.hasOwn(config, 'mcRetryBaseMs'), false);
  assert.equal(Object.hasOwn(config, 'mcMaxRetries'), false);
  assert.equal(config.mcStatusTimeoutMs, 10_000);
  assert.equal(config.dailyDigestCron, '0 1 * * *');
});

// Values written through /config are validated by runtimeConfigSchema.test.js;
// SQLite-backed integration tests remain environment-dependent because this
// sandbox's better-sqlite3 native binary segfaults under Node 22.
