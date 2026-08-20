import config from '../config.js';
import { logInfo } from '../utils/logger.js';
import { registerTarget, recordDown, recordUp, getOpenSessionStart } from '../utils/uptimeTracker.js';
import { listWebsiteTargets } from '../store/runtimeConfigStore.js';
import { checkWebsite } from '../services/websiteStatusClient.js';
import { appendLatencySample } from '../store/latencyStore.js';

const states = new Map();

function newState(target) {
  return {
    id: target.id,
    name: target.name,
    url: target.url,
    isConfirmedDown: false,
    firstSeenOffline: null,
    confirmedDownAt: null,
    lastStillDownNotifiedAt: null,
    stillDownRemindersSent: 0,
    lastStatus: null,
    lastProbeAt: null,
    lastHealthyAt: null,
    lastError: null,
  };
}

function stateFor(target) {
  let state = states.get(target.id);
  if (!state) {
    state = newState(target);
    states.set(target.id, state);
  } else {
    state.name = target.name;
    state.url = target.url;
  }
  return state;
}

function safeError(resultOrError) {
  const code = resultOrError?.code;
  if (code === 'HTTP_ERROR' && Number.isInteger(resultOrError.status)) return `HTTP status ${resultOrError.status}`;
  if (code === 'TIMEOUT') return 'Request timed out';
  if (code === 'DNS_ERROR') return 'DNS lookup failed';
  if (code === 'FORBIDDEN_ADDRESS') return 'Address not allowed';
  if (code === 'INVALID_RESPONSE') return 'Invalid HTTP response';
  return 'Network request failed';
}

function onlineResult(state, result, now = Date.now()) {
  state.lastProbeAt = now;
  state.lastHealthyAt = now;
  state.lastStatus = result.status;
  state.lastError = null;
  if (state.isConfirmedDown) {
    const downSince = getOpenSessionStart(state.id) ?? state.confirmedDownAt;
    recordUp(state.id, now);
    state.isConfirmedDown = false;
    state.firstSeenOffline = null;
    state.confirmedDownAt = null;
    state.lastStillDownNotifiedAt = null;
    state.stillDownRemindersSent = 0;
    logInfo('WebsiteMonitor', `Website target ${state.id} recovered to UP.`);
    return { type: 'UP', downSince };
  }
  state.firstSeenOffline = null;
  return { type: 'ONLINE' };
}

function offlineResult(state, resultOrError, now = Date.now()) {
  state.lastProbeAt = now;
  state.lastStatus = Number.isInteger(resultOrError?.status) ? resultOrError.status : null;
  state.lastError = safeError(resultOrError);
  if (state.firstSeenOffline === null) state.firstSeenOffline = now;

  const elapsed = now - state.firstSeenOffline;
  if (!state.isConfirmedDown && elapsed >= config.confirmDownThresholdMs) {
    state.isConfirmedDown = true;
    state.confirmedDownAt = now;
    state.lastStillDownNotifiedAt = now;
    state.stillDownRemindersSent = 0;
    recordDown(state.id, state.firstSeenOffline);
    logInfo('WebsiteMonitor', `Website target ${state.id} confirmed DOWN.`);
    return { type: 'DOWN', error: state.lastError, downSince: getOpenSessionStart(state.id) ?? now };
  }
  if (state.isConfirmedDown) {
    return { type: 'STILL_DOWN', error: state.lastError, downSince: getOpenSessionStart(state.id) ?? state.confirmedDownAt };
  }
  return { type: null };
}

export function getWebsiteStates() {
  return states;
}

export function initWebsiteMonitor() {
  const targets = Array.isArray(config.websiteTargets) ? config.websiteTargets : listWebsiteTargets();
  const activeIds = new Set(targets.map((target) => target.id));
  for (const id of states.keys()) {
    if (!activeIds.has(id)) states.delete(id);
  }
  for (const target of targets) {
    registerTarget(target.id, target.name, { type: 'website' });
    stateFor(target);
  }
}

export function removeWebsiteState(id) {
  return states.delete(id);
}

export async function checkWebsiteTargets(isConnected, { checkWebsiteImpl = checkWebsite } = {}) {
  if (!config.websiteEnabled || !isConnected) return [];
  initWebsiteMonitor();
  const targets = Array.isArray(config.websiteTargets) ? config.websiteTargets : listWebsiteTargets();
  return Promise.all(targets.map(async (target) => {
    const state = stateFor(target);
    const probeStartedAt = Date.now();
    try {
      const result = await checkWebsiteImpl(target);
      appendLatencySample({
        serviceId: target.id,
        serviceType: 'website',
        observedAt: Date.now(),
        durationMs: result?.durationMs ?? (Date.now() - probeStartedAt),
        success: Boolean(result?.ok),
        statusCode: result?.status,
      });
      return {
        target,
        state,
        event: result?.ok ? onlineResult(state, result) : offlineResult(state, result),
      };
    } catch (error) {
      appendLatencySample({
        serviceId: target.id,
        serviceType: 'website',
        observedAt: Date.now(),
        durationMs: Date.now() - probeStartedAt,
        success: false,
        statusCode: error?.status,
      });
      return { target, state, event: offlineResult(state, error) };
    }
  }));
}
