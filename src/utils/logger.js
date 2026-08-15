import { appendFile } from 'fs/promises';
import { getTimestampUTC7 } from './timeUtils.js';

const LOG_FILE = './error.log';

/**
 * Write errors to error.log and stderr.
 * Uses a separate try/catch to avoid infinite loops if fs fails.
 * @param {string} context - Module/function name
 * @param {Error|string} error
 */
export async function logError(context, error) {
  const ts  = getTimestampUTC7();
  const msg = error instanceof Error
    ? `${error.message}\n${error.stack ?? ''}`
    : String(error);

  const line = `[${ts}] [ERROR] [${context}]\n${msg}\n${'─'.repeat(60)}\n`;
  console.error(line);

  try {
    await appendFile(LOG_FILE, line, 'utf8');
  } catch (fsErr) {
    console.error(`[LOGGER] Failed to write error.log: ${fsErr.message}`);
  }
}

/**
 * Log info to stdout (no file write).
 */
export function logInfo(context, message) {
  const ts = getTimestampUTC7();
  console.log(`[${ts}] [INFO] [${context}] ${message}`);
}
