const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Fetch Minecraft server status with retry and exponential backoff.
 *
 * This deliberately distinguishes two very different failures:
 *   - The server is OFFLINE      => { ok: true,  online: false }
 *   - The mcstatus.io call FAILS  => { ok: false, error } (network / HTTP / etc.)
 *
 * A service failure must NOT be treated as the server being down, otherwise a
 * flaky network would trigger false DOWN alerts. Service failures are retried
 * with exponential backoff before giving up.
 *
 * @param {object} options
 * @param {string} options.ip
 * @param {number} options.port
 * @param {number} [options.maxRetries=3] - extra attempts after the first.
 * @param {number} [options.baseDelayMs=500] - backoff base; delay = base * 2^attempt.
 * @param {(ip: string, port: number) => Promise<object>} [options.statusFn]
 * @returns {Promise<{ ok: true, online: boolean, data?: object } | { ok: false, error: string }>}
 */
export async function fetchMcStatus(options) {
  const {
    ip,
    port,
    maxRetries = 3,
    baseDelayMs = 500,
    statusFn = defaultStatusFn,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await statusFn(ip, port);

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
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}
