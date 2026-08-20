const DEFAULT_TIMEOUT_MS = 10_000;
function timeoutError(timeoutMs) {
  return new Error(`Minecraft status request timed out after ${timeoutMs}ms`);
}

/**
 * Resolve an async provider within a bounded window. The provider contract does
 * not expose cancellation, so a late result is ignored after the timeout.
 * @param {() => Promise<object>} operation
 * @param {number} timeoutMs
 * @returns {Promise<object>}
 */
async function withTimeout(operation, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation();

  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Default status function: queries mcstatus.io for a Java server.
 * The dependency is imported lazily so this module stays decoupled and unit
 * tests (which inject their own statusFn) never need the network library.
 */
async function defaultStatusFn(ip, port) {
  const { default: mcs } = await import('node-mcstatus');
  // query:false keeps responses fast; we only need the base ping.
  return mcs.statusJava(ip, port, { query: false });
}

/**
 * Fetch Minecraft server status with one bounded probe.
 *
 * This deliberately distinguishes two very different failures:
 *   - The server is OFFLINE      => { ok: true,  online: false }
 *   - The mcstatus.io call FAILS  => { ok: false, error } (network / HTTP / etc.)
 *
 * A service failure must NOT be treated as the server being down, otherwise a
 * flaky network would trigger false DOWN alerts. The next probe is performed by
 * the shared monitor on the next CHECK_INTERVAL cycle.
 *
 * @param {object} options
 * @param {string} options.ip
 * @param {number} options.port
 * @param {number} [options.timeoutMs=10000] - maximum duration for the provider call; <=0 disables the guard.
 * @param {(ip: string, port: number) => Promise<object>} [options.statusFn]
 * @returns {Promise<{ ok: true, online: boolean, data?: object } | { ok: false, error: string }>}
 */
export async function fetchMcStatus(options) {
  const {
    ip,
    port,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    statusFn = defaultStatusFn,
  } = options;

  try {
    const result = await withTimeout(() => statusFn(ip, port), timeoutMs);

    if (result && result.online) {
      return {
        ok: true,
        online: true,
        data: {
          players: result.players?.online ?? 0,
          maxPlayers: result.players?.max ?? 0,
          version: result.version?.name_clean ?? 'Unknown',
        },
      };
    }

    // A clean response saying the server is offline is authoritative.
    return { ok: true, online: false };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
