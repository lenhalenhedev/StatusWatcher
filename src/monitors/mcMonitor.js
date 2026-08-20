import config from '../config.js';
import { logInfo } from '../utils/logger.js';
import { registerTarget, recordDown, recordUp, getOpenSessionStart } from '../utils/uptimeTracker.js';
import { fetchMcStatus } from '../services/mcStatusClient.js';

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

async function checkOne(server, isConnected) {
  const state = stateFor(server);
  if (!isConnected) return { server, state, event: { type: null } };

  const status = await fetchMcStatus({
    ip: server.host,
    port: server.port,
    timeoutMs: config.mcStatusTimeoutMs,
  });

  if (!status.ok) {
    state.lastError = `mcstatus.io unavailable: ${status.error}`;
    return { server, state, event: { type: null } };
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
      return { server, state, event: { type: 'UP', downSince } };
    }

    state.firstSeenOffline = null;
    return { server, state, event: { type: 'ONLINE' } };
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
    return { server, state, event: { type: 'DOWN', error: state.lastError, downSince } };
  }

  if (state.isConfirmedDown) {
    const downSince = getOpenSessionStart(server.id) ?? state.confirmedDownAt;
    return { server, state, event: { type: 'STILL_DOWN', error: state.lastError, downSince } };
  }

  return { server, state, event: { type: null } };
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
