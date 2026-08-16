import 'dotenv/config';

// Required environment variables. Missing one should fail fast.
const REQUIRED_VARS = [
  'TOKEN', 'CLIENT_ID', 'GUILD_ID',
  'MONITOR_CHANNEL_ID', 'LOG_CHANNEL_ID',
  'MC_SERVER_IP', 'MC_SERVER_PORT', 'MC_SERVER_NAME',
  'IMPORTANT_ROLE_ID', 'ADMIN_USER_ID',
  'CHECK_INTERVAL',
];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`[CONFIG FATAL] Missing required env var: ${key}`);
    process.exit(1);
  }
}

/**
 * Parse an integer environment variable without accepting partial values such as
 * `25565oops`. Invalid configured values fail fast rather than silently changing
 * the bot’s timing or network behavior.
 */
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

// Seconds a target must be continuously offline before being confirmed DOWN.
const confirmDownThresholdSec = intEnv('CONFIRM_DOWN_THRESHOLD', 60, { min: 1 });

// First "Still DOWN" reminder step. Kept for backward compatibility with the
// original CHECK_INTERVAL_DISPLAY_LOG variable.
const firstBackoffStepSec = intEnv('CHECK_INTERVAL_DISPLAY_LOG', 90, { min: 1 });

// Escalating "Still DOWN" backoff steps (seconds). STILL_DOWN_BACKOFF, when set,
// fully overrides the default schedule (e.g. "90,300,1800").
const backoffStepsSec = process.env.STILL_DOWN_BACKOFF
  ? process.env.STILL_DOWN_BACKOFF.split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  : [];
const resolvedBackoffSec = backoffStepsSec.length > 0
  ? backoffStepsSec
  : [firstBackoffStepSec, 300, 1_800];

export default Object.freeze({
  token:            process.env.TOKEN,
  clientId:         process.env.CLIENT_ID,
  guildId:          process.env.GUILD_ID,
  monitorChannelId: process.env.MONITOR_CHANNEL_ID,
  logChannelId:     process.env.LOG_CHANNEL_ID,
  mcServerIp:       process.env.MC_SERVER_IP,
  mcServerPort:     intEnv('MC_SERVER_PORT', 25565, { min: 1, max: 65_535 }),
  mcServerName:     process.env.MC_SERVER_NAME,
  importantRoleId:  process.env.IMPORTANT_ROLE_ID,
  adminUserId:      process.env.ADMIN_USER_ID,

  // Active check interval (ms).
  checkInterval: intEnv('CHECK_INTERVAL', 30, { min: 1 }) * 1_000,

  // Must be offline continuously for this long before being confirmed DOWN.
  confirmDownThresholdMs: confirmDownThresholdSec * 1_000,

  // Escalating "Still DOWN" reminder schedule (ms).
  stillDownBackoffStepsMs: resolvedBackoffSec.map((s) => s * 1_000),

  // mcstatus.io retry policy.
  mcMaxRetries: intEnv('MC_MAX_RETRIES', 3, { min: 0 }),
  mcRetryBaseMs: intEnv('MC_RETRY_BASE_MS', 500, { min: 0 }),
  mcStatusTimeoutMs: intEnv('MC_STATUS_TIMEOUT_MS', 10_000, { min: 0 }),

  // HTTP health-check server port (0 disables it).
  healthPort: intEnv('HEALTH_PORT', 3000, { min: 0, max: 65_535 }),

  // Cron expression for the daily uptime digest (default 08:00 UTC+7 = 01:00 UTC).
  dailyDigestCron: process.env.DAILY_DIGEST_CRON || '0 1 * * *',
});
