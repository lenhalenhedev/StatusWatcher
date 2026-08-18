const MAX_CONNECTION_STRING_LENGTH = 4_096;
const MAX_NAME_LENGTH = 100;
const SUPPORTED_SCHEMES = new Map([
  ['postgres', 'postgres'],
  ['postgresql', 'postgres'],
  ['mysql', 'mysql'],
  ['redis', 'redis'],
  ['rediss', 'redis'],
  ['mongodb', 'mongodb'],
  ['mongodb+srv', 'mongodb'],
]);

function fail(message) {
  throw new Error(message);
}

export function parseBoolean(raw, label = 'SSL') {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`${label} must be true or false.`);
}

export function parseDatabaseConnectionString(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > MAX_CONNECTION_STRING_LENGTH) {
    fail('Connect string is required and must be at most 4096 characters.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('Connect string is not a valid database URI.');
  }

  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  const engine = SUPPORTED_SCHEMES.get(scheme);
  if (!engine) fail('Supported URI schemes are postgres://, mysql://, redis://, rediss://, mongodb:// and mongodb+srv://.');
  if (!parsed.hostname) fail('Connect string must contain a database host.');
  if (parsed.username.length > 256 || parsed.password.length > 1_024) fail('Connect string credentials are too long.');
  if (parsed.hash) fail('Connect string fragments are not allowed.');

  if (scheme === 'mongodb+srv' && parsed.port) fail('MongoDB SRV connect strings must not include a port.');

  const port = parsed.port ? Number(parsed.port) : null;
  if (parsed.port && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    fail('Database port must be between 1 and 65535.');
  }

  return Object.freeze({
    engine,
    scheme,
    value,
    host: parsed.hostname,
    port,
  });
}

export function parseDatabaseName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) fail('Database name is required and must be at most 100 characters.');
  if (/^[\u0000-\u001f\u007f]/.test(name)) fail('Database name contains invalid control characters.');
  return name;
}

export function parseDatabaseSsl(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return false;
  return parseBoolean(value, 'SSL');
}

export function sanitizeDatabaseUriForDriver(value, engine) {
  const parsed = parseDatabaseConnectionString(value);
  const url = new URL(parsed.value);
  const blocked = engine === 'postgres'
    ? ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'keepalives', 'keepalives_idle', 'keepalives_interval', 'keepalives_count', 'connect_timeout']
    : engine === 'redis'
      ? ['tls', 'insecure', 'rejectUnauthorized', 'socket_keepalive', 'connect_timeout']
      : ['tls', 'ssl', 'tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames', 'tlsCAFile', 'connectTimeoutMS', 'serverSelectionTimeoutMS', 'socketTimeoutMS'];
  for (const key of blocked) url.searchParams.delete(key);
  return url.toString();
}

export function redactDatabaseError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown database error');
  const withoutUri = raw.replace(/(?:postgres(?:ql)?|mysql|rediss?|mongodb(?:\+srv)?:\/\/)[^\s'"`)]*/gi, '[database-uri]');
  const withoutSecrets = withoutUri
    .replace(/(password|passwd|pwd|secret|token|access_token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(?:^|[\s(])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?/g, '$1[endpoint]')
    .replace(/(?:^|[\s(])\[[0-9a-f:]+\](?::\d{1,5})?/gi, '$1[endpoint]')
    .replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?/gi, '[endpoint]')
    .replace(/\/[^\s:]+(?:\/[^\s:]*)+/g, '[path]');
  return withoutSecrets.replace(/[\r\n]+/g, ' ').slice(0, 240) || 'Database probe failed.';
}

export function classifyDatabaseError(error) {
  const message = redactDatabaseError(error).toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('auth') || message.includes('password') || message.includes('credential')) return 'authentication_failed';
  if (message.includes('protocol') || message.includes('handshake')) return 'protocol_error';
  if (message.includes('certificate') || message.includes('tls') || message.includes('ssl')) return 'tls_error';
  if (message.includes('refused') || message.includes('econn') || message.includes('socket')) return 'connection_failed';
  return 'probe_failed';
}

export const DATABASE_MAX_CERTIFICATE_BYTES = 512 * 1024;
export const DATABASE_CERTIFICATE_EXPIRY_MS = 10 * 60 * 1_000;
