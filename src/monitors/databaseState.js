export function createDatabaseState(target) {
  return {
    id: target.id,
    name: target.name,
    engine: target.engine,
    sslEnabled: target.sslEnabled,
    hasCertificate: target.hasCertificate,
    client: null,
    clientKind: null,
    certificatePath: null,
    connecting: null,
    isConfirmedDown: false,
    firstSeenOffline: null,
    confirmedDownAt: null,
    lastStillDownNotifiedAt: null,
    stillDownRemindersSent: 0,
    lastError: null,
    lastProbeAt: null,
    lastHealthyAt: null,
  };
}

export function markOnline(state, { now = Date.now(), getOpenSessionStart = () => null, recordUp = () => undefined } = {}) {
  state.lastProbeAt = now;
  state.lastHealthyAt = now;
  state.lastError = null;
  if (state.isConfirmedDown) {
    const downSince = getOpenSessionStart(state.id) ?? state.confirmedDownAt;
    recordUp(state.id, now);
    state.isConfirmedDown = false;
    state.firstSeenOffline = null;
    state.confirmedDownAt = null;
    state.lastStillDownNotifiedAt = null;
    state.stillDownRemindersSent = 0;
    return { type: 'UP', downSince };
  }
  state.firstSeenOffline = null;
  return { type: 'ONLINE' };
}

export function markOffline(
  state,
  error,
  {
    now = Date.now(),
    confirmDownThresholdMs,
    classifyError = () => 'probe_failed',
    getOpenSessionStart = () => null,
    recordDown = () => undefined,
  } = {},
) {
  state.lastProbeAt = now;
  state.lastError = `Database probe failed (${classifyError(error)}).`;
  if (state.firstSeenOffline === null) state.firstSeenOffline = now;
  const elapsed = now - state.firstSeenOffline;
  if (!state.isConfirmedDown && elapsed >= confirmDownThresholdMs) {
    state.isConfirmedDown = true;
    state.confirmedDownAt = now;
    state.lastStillDownNotifiedAt = now;
    state.stillDownRemindersSent = 0;
    recordDown(state.id, state.firstSeenOffline);
    return { type: 'DOWN', error: state.lastError, downSince: getOpenSessionStart(state.id) ?? now };
  }
  if (state.isConfirmedDown) {
    return { type: 'STILL_DOWN', error: state.lastError, downSince: getOpenSessionStart(state.id) ?? state.confirmedDownAt };
  }
  return { type: null };
}
