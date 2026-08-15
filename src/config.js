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

/** Parse an integer env var with a default fallback. */
function intEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Seconds a target must be continuously offline before being confirmed DOWN.
const confirmDownThresholdSec = intEnv('CONFIRM_DOWN_THRESHOLD', 60);

// First "Still DOWN" reminder step. Kept for backward compatibility with the
// original CHECK_INTERVAL_DISPLAY_LOG variable.
const firstBackoffStepSec = intEnv('CHECK_INTERVAL_DISPLAY_LOG', 90);

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
  mcServerPort:     parseInt(process.env.MC_SERVER_PORT, 10),
  mcServerName:     process.env.MC_SERVER_NAME,
  importantRoleId:  process.env.IMPORTANT_ROLE_ID,
  adminUserId:      process.env.ADMIN_USER_ID,

  // Active check interval (ms).
  checkInterval: intEnv('CHECK_INTERVAL', 30) * 1_000,

  // Must be offline continuously for this long before being confirmed DOWN.
  confirmDownThresholdMs: confirmDownThresholdSec * 1_000,

  // Escalating "Still DOWN" reminder schedule (ms).
  stillDownBackoffStepsMs: resolvedBackoffSec.map((s) => s * 1_000),

  // mcstatus.io retry policy.
  mcMaxRetries: intEnv('MC_MAX_RETRIES', 3),
  mcRetryBaseMs: intEnv('MC_RETRY_BASE_MS', 500),

  // HTTP health-check server port (0 disables it).
  healthPort: intEnv('HEALTH_PORT', 3000),

  // Cron expression for the daily uptime digest (default 08:00 UTC+7 = 01:00 UTC).
  dailyDigestCron: process.env.DAILY_DIGEST_CRON || '0 1 * * *',
});
