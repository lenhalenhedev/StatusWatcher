import config from '../config.js';
import { logInfo } from '../utils/logger.js';
import { registerTarget, recordDown, recordUp, getOpenSessionStart } from '../utils/uptimeTracker.js';
import { fetchMcStatus } from '../services/mcStatusClient.js';
import { recordProbeEvidence } from '../services/probeEvidenceService.js';

// Kept for compatibility with legacy consumers; new servers receive their own
// stable ID from the minecraft_servers SQLite table.
export const MC_TARGET_ID = 'minecraft_server';

const mcStates = new Map();

function newState(server) {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    isConfirmedDown: false,
    firstSeenOffline: null,
    confirmedDownAt: null,
    lastStillDownNotifiedAt: null,
    stillDownRemindersSent: 0,
    lastPingData: null,
    lastError: null,
  };
}

function stateFor(server) {
  let state = mcStates.get(server.id);
  if (!state) {
    state = newState(server);
    mcStates.set(server.id, state);
  } else {
    state.name = server.name;
    state.host = server.host;
    state.port = server.port;
  }
  return state;
}

export function getMcStates() {
  return mcStates;
}

/** Legacy single-state accessor; returns the first configured server. */
export function getMcState(id = null) {
  if (id) return mcStates.get(id) ?? null;
  return mcStates.values().next().value ?? null;
}

export function removeMcState(id) {
  return mcStates.delete(id);
}

/** Register/update all configured Minecraft targets and remove stale runtime state. */
export function initMcMonitor() {
  const activeIds = new Set(config.mcServers.map((server) => server.id));
  for (const id of mcStates.keys()) {
    if (!activeIds.has(id)) mcStates.delete(id);
  }

  for (const server of config.mcServers) {
    registerTarget(server.id, server.name, { type: 'minecraft' });
    stateFor(server);
  }
}

function recordMcEvidence(server, startedAt, status, event) {
  recordProbeEvidence({
    serviceId: server.id,
    serviceType: 'minecraft',
    observedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    success: Boolean(status?.ok && status?.online),
    statusCode: status?.ok ? 200 : null,
    eventType: event?.type,
    errorCategory: status?.ok && status?.online ? null : 'MINECRAFT_CONNECTION_FAILED',
  });
}

async function checkOne(server, isConnected) {
  const state = stateFor(server);
  if (!isConnected) return { server, state, event: { type: null } };

  const startedAt = Date.now();
  const status = await fetchMcStatus({
    ip: server.host,
    port: server.port,
    timeoutMs: config.mcStatusTimeoutMs,
  });

  if (!status.ok) {
    state.lastError = `mcstatus.io unavailable: ${status.error}`;
    const event = { type: null };
    recordMcEvidence(server, startedAt, status, event);
    return { server, state, event };
  }

  if (status.online) {
    state.lastPingData = status.data;
    state.lastError = null;

    if (state.isConfirmedDown) {
      const downSince = getOpenSessionStart(server.id) ?? state.confirmedDownAt;
      recordUp(server.id);
      state.isConfirmedDown = false;
      state.firstSeenOffline = null;
      state.confirmedDownAt = null;
      state.lastStillDownNotifiedAt = null;
      state.stillDownRemindersSent = 0;
      logInfo('McMonitor', `${server.name} recovered to UP.`);
      const event = { type: 'UP', downSince };
      recordMcEvidence(server, startedAt, status, event);
      return { server, state, event };
    }

    state.firstSeenOffline = null;
    const event = { type: 'ONLINE' };
    recordMcEvidence(server, startedAt, status, event);
    return { server, state, event };
  }

  state.lastPingData = null;
  state.lastError = 'Server offline (reported by mcstatus.io)';
  if (state.firstSeenOffline === null) {
    state.firstSeenOffline = Date.now();
    logInfo('McMonitor', `${server.name} offline - starting ${config.confirmDownThresholdMs / 1_000}s threshold...`);
  }

  const elapsed = Date.now() - state.firstSeenOffline;
  if (!state.isConfirmedDown && elapsed >= config.confirmDownThresholdMs) {
    state.isConfirmedDown = true;
    state.confirmedDownAt = Date.now();
    state.lastStillDownNotifiedAt = state.confirmedDownAt;
    state.stillDownRemindersSent = 0;
    recordDown(server.id, state.firstSeenOffline);
    const downSince = getOpenSessionStart(server.id) ?? state.confirmedDownAt;
    logInfo('McMonitor', `${server.name} confirmed DOWN after ${Math.floor(elapsed / 1_000)}s.`);
    const event = { type: 'DOWN', error: state.lastError, downSince };
    recordMcEvidence(server, startedAt, status, event);
    return { server, state, event };
  }

  if (state.isConfirmedDown) {
    const downSince = getOpenSessionStart(server.id) ?? state.confirmedDownAt;
    const event = { type: 'STILL_DOWN', error: state.lastError, downSince };
    recordMcEvidence(server, startedAt, status, event);
    return { server, state, event };
  }

  const event = { type: null };
  recordMcEvidence(server, startedAt, status, event);
  return { server, state, event };
}

/** Check every configured server once. */
export async function checkMcServers(isConnected) {
  if (!config.mcEnabled || !isConnected) return [];
  initMcMonitor();
  const results = [];
  for (const server of config.mcServers) {
    results.push(await checkOne(server, isConnected));
  }
  return results;
}

/** Legacy single-server wrapper used by older callers and tests. */
export async function checkMcServer(isConnected) {
  return (await checkMcServers(isConnected))[0]?.event ?? { type: null };
}
