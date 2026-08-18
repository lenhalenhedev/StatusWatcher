import 'dotenv/config';
import cron from 'node-cron';
import {
  listRuntimeConfig,
  seedRuntimeConfig,
  listMinecraftServers,
  saveMinecraftServer,
} from './store/runtimeConfigStore.js';
import {
  parseRuntimeConfigValue,
  serializeRuntimeConfigValue,
} from './config/runtimeConfigSchema.js';

function intEnv(key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;

  if (!/^-?\d+$/.test(raw)) {
    console.error(`[CONFIG FATAL] ${key} must be an integer.`);
    process.exit(1);
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    console.error(`[CONFIG FATAL] ${key} must be between ${min} and ${max}.`);
    process.exit(1);
    return fallback;
  }

  return parsed;
}

const legacyMcEnabled = String(process.env.MC_ENABLE ?? 'true').trim().toLowerCase() !== 'false';

// Only bootstrap credentials remain mandatory at process start. Operational
// settings are intentionally allowed to be empty until /config stores them.
for (const key of ['TOKEN', 'CLIENT_ID', 'GUILD_ID', 'ADMIN_USER_ID']) {
  if (!process.env[key]) {
    console.error(`[CONFIG FATAL] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const firstBackoffStepSec = intEnv('CHECK_INTERVAL_DISPLAY_LOG', 90, { min: 1 });
const envBackoff = process.env.STILL_DOWN_BACKOFF
  ? process.env.STILL_DOWN_BACKOFF.split(',').map((s) => Number(s.trim()))
  : [firstBackoffStepSec, 300, 1_800];
if (envBackoff.some((value) => !Number.isSafeInteger(value) || value < 1)) {
  console.error('[CONFIG FATAL] STILL_DOWN_BACKOFF must contain positive integers.');
  process.exit(1);
}

const envRuntimeDefaults = {
  importantRoleId: process.env.IMPORTANT_ROLE_ID,
  monitorChannelId: process.env.MONITOR_CHANNEL_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,
  checkIntervalSec: process.env.CHECK_INTERVAL || '30',
  confirmDownThresholdSec: process.env.CONFIRM_DOWN_THRESHOLD || '60',
  checkIntervalDisplayLogSec: process.env.CHECK_INTERVAL_DISPLAY_LOG || '90',
  stillDownBackoffSec: envBackoff.join(','),
  mcRetryBaseMs: process.env.MC_RETRY_BASE_MS || '500',
  mcMaxRetries: process.env.MC_MAX_RETRIES || '3',
  mcStatusTimeoutMs: process.env.MC_STATUS_TIMEOUT_MS || '10000',
  dailyDigestCron: process.env.DAILY_DIGEST_CRON || '0 1 * * *',
};

seedRuntimeConfig(envRuntimeDefaults);

// One-time migration for the former single Minecraft environment tuple. The
// new source of truth is minecraft_servers; MC_ENABLE is not consulted again.
if (legacyMcEnabled && listMinecraftServers().length === 0) {
  const host = process.env.MC_SERVER_IP;
  const port = process.env.MC_SERVER_PORT ? Number(process.env.MC_SERVER_PORT) : 25565;
  const name = process.env.MC_SERVER_NAME;
  if (host && name && Number.isInteger(port) && port >= 1 && port <= 65_535) {
    saveMinecraftServer({ id: 'minecraft_server', name, host, port });
  }
}

function readValue(raw, key, fallback) {
  if (raw[key] === undefined) return fallback;
  return parseRuntimeConfigValue(key, raw[key]);
}

function buildSnapshot() {
  const raw = listRuntimeConfig();
  const servers = listMinecraftServers().map((server) => ({
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
  }));
  const firstServer = servers[0] ?? null;
  const checkIntervalSec = readValue(raw, 'checkIntervalSec', 30);
  const confirmDownThresholdSec = readValue(raw, 'confirmDownThresholdSec', 60);
  const displayLogSec = readValue(raw, 'checkIntervalDisplayLogSec', 90);
  const backoffSec = readValue(raw, 'stillDownBackoffSec', [displayLogSec, 300, 1_800]);

  return {
    // Bootstrap values are stable for the life of the process.
    token: process.env.TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    adminUserId: process.env.ADMIN_USER_ID,
    healthPort: intEnv('HEALTH_PORT', 3000, { min: 0, max: 65_535 }),

    monitorChannelId: readValue(raw, 'monitorChannelId', null),
    logChannelId: readValue(raw, 'logChannelId', null),
    importantRoleId: readValue(raw, 'importantRoleId', null),

    mcServers: servers,
    mcEnabled: servers.length > 0,
    mcServerIp: firstServer?.host,
    mcServerPort: firstServer?.port,
    mcServerName: firstServer?.name,

    checkInterval: checkIntervalSec * 1_000,
    confirmDownThresholdMs: confirmDownThresholdSec * 1_000,
    checkIntervalDisplayLogSec: displayLogSec,
    stillDownBackoffStepsMs: backoffSec.map((seconds) => seconds * 1_000),
    mcMaxRetries: readValue(raw, 'mcMaxRetries', 3),
    mcRetryBaseMs: readValue(raw, 'mcRetryBaseMs', 500),
    mcStatusTimeoutMs: readValue(raw, 'mcStatusTimeoutMs', 10_000),
    dailyDigestCron: readValue(raw, 'dailyDigestCron', '0 1 * * *'),
  };
}

export const config = buildSnapshot();
const runtimeConfigListeners = new Set();

export function subscribeRuntimeConfig(listener) {
  if (typeof listener !== 'function') throw new TypeError('Runtime config listener must be a function.');
  runtimeConfigListeners.add(listener);
  return () => runtimeConfigListeners.delete(listener);
}

/** Reload all mutable settings from SQLite into the shared runtime object. */
export function reloadRuntimeConfig() {
  const next = buildSnapshot();
  Object.assign(config, next);
  for (const listener of runtimeConfigListeners) {
    try {
      listener(config);
    } catch (err) {
      console.error('[CONFIG] Runtime config listener failed:', err);
    }
  }
  return config;
}

/** Serialize a validated value before writing it to runtime_config. */
export { serializeRuntimeConfigValue };

export default config;
