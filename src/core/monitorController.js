/**
 * Thin indirection that lets slash commands (e.g. /recheck) trigger a manual
 * monitoring cycle without importing the whole composition root in index.js.
 *
 * index.js registers the real runner once the client is ready; commands call
 * runManualCheck(). This keeps the dependency direction clean and avoids
 * circular imports between commands and the bootstrap module.
 */

let manualCheckFn = null;

/**
 * Register the function that performs one monitoring cycle.
 * @param {() => Promise<boolean>} fn
 */
export function registerManualCheck(fn) {
  manualCheckFn = typeof fn === 'function' ? fn : null;
}

/**
 * Run one monitoring cycle on demand.
 * @returns {Promise<boolean>} true if a cycle ran, false if unavailable or skipped.
 */
export async function runManualCheck() {
  if (!manualCheckFn) return false;
  return manualCheckFn();
}
