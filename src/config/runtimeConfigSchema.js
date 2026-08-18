import cron from 'node-cron';

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export const RUNTIME_CONFIG_DEFINITIONS = Object.freeze({
  importantRoleId: {
    label: 'Important Role',
    description: 'Role được ưu tiên ở đầu uptime embed và được mention khi target quan trọng DOWN.',
    kind: 'snowflake',
  },
  monitorChannelId: {
    label: 'Monitor Channel',
    description: 'Kênh chứa uptime status embed chính.',
    kind: 'snowflake',
  },
  logChannelId: {
    label: 'Log Channel',
    description: 'Kênh nhận alert DOWN, STILL DOWN và UP.',
    kind: 'snowflake',
  },
  checkIntervalSec: {
    label: 'CHECK_INTERVAL',
    description: 'Khoảng thời gian giữa hai monitoring cycle, tính bằng giây.',
    kind: 'integer',
    min: 1,
    max: 86_400,
  },
  confirmDownThresholdSec: {
    label: 'CONFIRM_DOWN_THRESHOLD',
    description: 'Số giây một target phải offline liên tục trước khi xác nhận DOWN.',
    kind: 'integer',
    min: 1,
    max: 604_800,
  },
  checkIntervalDisplayLogSec: {
    label: 'CHECK_INTERVAL_DISPLAY_LOG',
    description: 'Khoảng reminder STILL DOWN đầu tiên, tính bằng giây.',
    kind: 'integer',
    min: 1,
    max: 604_800,
  },
  stillDownBackoffSec: {
    label: 'STILL_DOWN_BACKOFF',
    description: 'Các mốc reminder STILL DOWN dạng danh sách giây, ví dụ 90,300,1800.',
    kind: 'backoff',
  },
  mcRetryBaseMs: {
    label: 'MC_RETRY_BASE_MS',
    description: 'Độ trễ retry Minecraft cơ sở, tính bằng mili giây.',
    kind: 'integer',
    min: 0,
    max: 600_000,
  },
  mcMaxRetries: {
    label: 'MC_MAX_RETRIES',
    description: 'Số lần retry tối đa khi probe Minecraft thất bại.',
    kind: 'integer',
    min: 0,
    max: 50,
  },
  mcStatusTimeoutMs: {
    label: 'MC_STATUS_TIMEOUT_MS',
    description: 'Timeout mỗi lần probe Minecraft, tính bằng mili giây.',
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
