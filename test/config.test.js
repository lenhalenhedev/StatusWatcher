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

function loadConfig(overrides = {}) {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "import('./src/config.js')"],
    { cwd, env: { ...process.env, ...validEnv, ...overrides } },
  );
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
