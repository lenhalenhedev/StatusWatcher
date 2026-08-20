import cron from 'node-cron';

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export const RUNTIME_CONFIG_DEFINITIONS = Object.freeze({
  importantRoleId: {
    label: 'Important Role',
    description: 'Role prioritized at the top of the uptime embed and mentioned when an important target is DOWN.',
    kind: 'snowflake',
  },
  monitorChannelId: {
    label: 'Monitor Channel',
    description: 'Channel containing the primary uptime status embed.',
    kind: 'snowflake',
  },
  logChannelId: {
    label: 'Log Channel',
    description: 'Channel receiving DOWN, STILL DOWN, and UP alerts.',
    kind: 'snowflake',
  },
  checkIntervalSec: {
    label: 'CHECK_INTERVAL',
    description: 'Time between monitoring cycles, in seconds.',
    kind: 'integer',
    min: 1,
    max: 86_400,
  },
  confirmDownThresholdSec: {
    label: 'CONFIRM_DOWN_THRESHOLD',
    description: 'Seconds a target must remain offline before DOWN is confirmed.',
    kind: 'integer',
    min: 1,
    max: 604_800,
  },
  checkIntervalDisplayLogSec: {
    label: 'CHECK_INTERVAL_DISPLAY_LOG',
    description: 'Initial STILL DOWN reminder interval, in seconds.',
    kind: 'integer',
    min: 1,
    max: 604_800,
  },
  stillDownBackoffSec: {
    label: 'STILL_DOWN_BACKOFF',
    description: 'STILL DOWN reminder intervals in seconds, for example 90,300,1800.',
    kind: 'backoff',
  },
  mcStatusTimeoutMs: {
    label: 'MC_STATUS_TIMEOUT_MS',
    description: 'Timeout for each Minecraft probe, in milliseconds.',
    kind: 'integer',
    min: 0,
    max: 300_000,
  },
  dailyDigestCron: {
    label: 'DAILY_DIGEST_CRON',
    description: 'Cron expression cho daily uptime digest.',
    kind: 'cron',
  },
});

function fail(message) {
  throw new Error(message);
}

export function parseMinecraftAddress(raw) {
  const value = String(raw ?? '').trim();
  const match = /^([^:\s/]+):(\d+)$/.exec(value);
  if (!match) fail('Minecraft address must use host:port, for example domain.com:25565.');

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail('Minecraft port must be an integer between 1 and 65535.');
  }

  return { host: match[1], port };
}

function parseSnowflake(key, raw) {
  const value = String(raw ?? '').trim();
  if (!SNOWFLAKE_PATTERN.test(value)) fail(`${key} must be a valid Discord ID.`);
  return value;
}

function parseInteger(key, raw, definition) {
  const value = String(raw ?? '').trim();
  if (!/^\d+$/.test(value)) fail(`${definition.label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < definition.min || parsed > definition.max) {
    fail(`${definition.label} must be between ${definition.min} and ${definition.max}.`);
  }
  return parsed;
}

export function parseRuntimeConfigValue(key, raw) {
  const definition = RUNTIME_CONFIG_DEFINITIONS[key];
  if (!definition) fail(`Unknown runtime config key: ${key}`);
  if (definition.kind === 'snowflake') return parseSnowflake(key, raw);
  if (definition.kind === 'integer') return parseInteger(key, raw, definition);
  if (definition.kind === 'backoff') {
    const parts = String(raw ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) fail('STILL_DOWN_BACKOFF must contain at least one positive integer.');
    return parts.map((part) => parseInteger(key, part, { ...definition, label: 'STILL_DOWN_BACKOFF item', min: 1, max: 604_800 }));
  }
  if (definition.kind === 'cron') {
    const value = String(raw ?? '').trim();
    if (!value || !cron.validate(value)) fail('DAILY_DIGEST_CRON is not a valid cron expression.');
    return value;
  }
  fail(`Unsupported runtime config kind: ${definition.kind}`);
}

export function serializeRuntimeConfigValue(key, value) {
  const parsed = parseRuntimeConfigValue(key, value);
  return Array.isArray(parsed) ? parsed.join(',') : String(parsed);
}
