import { appendFile } from 'fs/promises';
import { getTimestampUTC7 } from './timeUtils.js';

const LOG_FILE = './error.log';
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_CONTEXT = /^[A-Za-z0-9._:-]{1,120}$/;

function safeContext(value) {
  const context = String(value ?? 'unknown').replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120);
  return context || 'unknown';
}

function safeCategory(error) {
  const candidate = error && typeof error === 'object' ? error.code : null;
  if (typeof candidate === 'string' && SAFE_CODE.test(candidate)) return candidate;
  const text = typeof error === 'string' ? error : '';
  const match = text.match(/\bcategory=([A-Z][A-Z0-9_]{0,63})\b/);
  return match ? match[1] : 'UNKNOWN';
}

/** Write only a safe diagnostic category to error.log and stderr. */
export async function logError(context, error) {
  const ts = getTimestampUTC7();
  const line = `[${ts}] [ERROR] [${safeContext(context)}] category=${safeCategory(error)}\n`;
  console.error(line.trim());
  try {
    await appendFile(LOG_FILE, line, 'utf8');
  } catch {
    console.error('[LOGGER] Failed to write error.log.');
  }
}

/** Log bounded operational information to stdout. */
export function logInfo(context, message) {
  const ts = getTimestampUTC7();
  const safeMessage = String(message ?? '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
  console.log(`[${ts}] [INFO] [${safeContext(context)}] ${safeMessage}`);
}
