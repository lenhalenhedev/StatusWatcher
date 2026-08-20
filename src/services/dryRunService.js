import { checkWebsite, validateWebsiteTarget } from './websiteStatusClient.js';

const MAX_NAME_LENGTH = 200;

function normalizeName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    const error = new Error('Monitor name is invalid.');
    error.code = 'INVALID_NAME';
    throw error;
  }
  return name;
}

export async function previewWebsite(target, { lookupImpl, checkWebsiteImpl = checkWebsite } = {}) {
  const name = normalizeName(target?.name);
  const url = await validateWebsiteTarget(target, { lookupImpl });
  if (typeof checkWebsiteImpl !== 'function') {
    const error = new Error('Website probe is unavailable.');
    error.code = 'PROBE_UNAVAILABLE';
    throw error;
  }
  const result = await checkWebsiteImpl({ ...target, url });
  const durationMs = Number(result?.durationMs);
  const statusCode = Number(result?.status);
  return {
    valid: true,
    persisted: false,
    serviceType: 'website',
    name,
    status: result?.ok ? 'ONLINE' : 'DOWN',
    statusCode: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.min(15_000, Math.round(durationMs)) : null,
  };
}
