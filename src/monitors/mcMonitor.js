import config from '../config.js';
import { logInfo } from '../utils/logger.js';
import { registerTarget, recordDown, recordUp, getOpenSessionStart } from '../utils/uptimeTracker.js';
import { fetchMcStatus } from '../services/mcStatusClient.js';

export const MC_TARGET_ID = 'minecraft_server';

// Minecraft server state (module-level singleton).
const mcState = {
  isConfirmedDown: false,
  firstSeenOffline: null,         // epoch ms
  confirmedDownAt: null,          // epoch ms
  lastStillDownNotifiedAt: null,  // epoch ms
  stillDownRemindersSent: 0,      // reminders sent during the current outage
  lastPingData: null,             // { players, maxPlayers, version } when online
  lastError: null,                // most recent error message
};

export function getMcState() {
  return mcState;
}

/** Register the MC server in the uptime tracker. */
export function initMcMonitor() {
  registerTarget(MC_TARGET_ID, config.mcServerName, { type: 'minecraft' });
}

/**
 * Check the Minecraft server once and return a state-change event.
 *
 * Service failures from mcstatus.io (network/HTTP) are retried with backoff by
 * the status client and, if still failing, are treated as "unknown" (type:null)
 * rather than a server outage, so a flaky network never triggers a false DOWN.
 *
 * @param {boolean} isConnected
 * @returns {Promise<{ type: 'ONLINE'|'DOWN'|'STILL_DOWN'|'UP'|null, error?: string, downSince?: number }>}
 */
export async function checkMcServer(isConnected) {
  if (!isConnected) return { type: null };

  const status = await fetchMcStatus({
    ip: config.mcServerIp,
    port: config.mcServerPort,
    maxRetries: config.mcMaxRetries,
    baseDelayMs: config.mcRetryBaseMs,
    timeoutMs: config.mcStatusTimeoutMs,
  });

  // Service failure: keep the previous state to avoid false alarms.
  if (!status.ok) {
    mcState.lastError = `mcstatus.io unavailable: ${status.error}`;
    return { type: null };
  }

  if (status.online) {
    mcState.lastPingData = status.data;
    mcState.lastError = null;

    if (mcState.isConfirmedDown) {
      const downSince = getOpenSessionStart(MC_TARGET_ID) ?? mcState.confirmedDownAt;
      recordUp(MC_TARGET_ID);
      mcState.isConfirmedDown = false;
      mcState.firstSeenOffline = null;
      mcState.confirmedDownAt = null;
      mcState.lastStillDownNotifiedAt = null;
      mcState.stillDownRemindersSent = 0;
      logInfo('McMonitor', 'Minecraft Server recovered to UP.');
      return { type: 'UP', downSince };
    }

    mcState.firstSeenOffline = null;
    return { type: 'ONLINE' };
  }

  // Server is genuinely offline.
  mcState.lastPingData = null;
  mcState.lastError = 'Server offline (reported by mcstatus.io)';

  if (mcState.firstSeenOffline === null) {
    mcState.firstSeenOffline = Date.now();
    const thresholdSec = config.confirmDownThresholdMs / 1_000;
    logInfo('McMonitor', `Server reported offline - starting ${thresholdSec}s threshold...`);
  }

  const elapsed = Date.now() - mcState.firstSeenOffline;

  if (!mcState.isConfirmedDown && elapsed >= config.confirmDownThresholdMs) {
    mcState.isConfirmedDown = true;
    mcState.confirmedDownAt = Date.now();
    // Seed the reminder clock/counter so the first "Still DOWN" reminder waits
    // a full backoff step after the initial DOWN alert.
    mcState.lastStillDownNotifiedAt = mcState.confirmedDownAt;
    mcState.stillDownRemindersSent = 0;
    recordDown(MC_TARGET_ID, mcState.firstSeenOffline);
    const downSince = getOpenSessionStart(MC_TARGET_ID) ?? mcState.confirmedDownAt;
    logInfo('McMonitor', `Minecraft Server confirmed DOWN after ${Math.floor(elapsed / 1_000)}s.`);
    return { type: 'DOWN', error: mcState.lastError, downSince };
  }

  if (mcState.isConfirmedDown) {
    const downSince = getOpenSessionStart(MC_TARGET_ID) ?? mcState.confirmedDownAt;
    return { type: 'STILL_DOWN', error: mcState.lastError, downSince };
  }

  // Below threshold -> stay silent, keep counting.
  return { type: null };
}
