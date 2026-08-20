const SERVICE_TYPES = new Set(['bot', 'minecraft', 'website', 'database']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,200}$/;

function normalizePart(value, fallback) {
  const text = String(value ?? '').trim();
  return SAFE_IDENTIFIER.test(text) ? text : fallback;
}

/**
 * Build a deterministic incident key without embedding URLs, query strings,
 * credentials, response bodies, or raw exception text.
 *
 * Dependency grouping is intentionally not used by the first slice. A
 * dependency group may only change incident identity after an explicit,
 * authorized relationship and bounded grouping window are implemented.
 */
export function buildIncidentKey({ serviceType, serviceId }) {
  const type = SERVICE_TYPES.has(serviceType) ? serviceType : 'unknown';
  const id = normalizePart(serviceId, 'unknown');
  return `${type}:${id}`;
}

export function normalizeIncidentIdentifier(value, fallback = 'unknown') {
  return normalizePart(value, fallback);
}
