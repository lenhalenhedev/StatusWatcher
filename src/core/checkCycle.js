import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { checkBotStatuses } from '../monitors/botMonitor.js';
import { checkMcServers } from '../monitors/mcMonitor.js';
import { checkDatabaseTargets } from '../monitors/databaseMonitor.js';
import { checkWebsiteTargets } from '../monitors/websiteMonitor.js';
import {
  notifyDownBatch,
  notifyStillDownBatch,
  notifyUpBatch,
} from '../handlers/notifier.js';
import { shouldRemindStillDown } from '../utils/stillDownBackoff.js';
import { isMuted } from '../store/muteStore.js';
import { incidentManager } from '../incidents/incidentService.js';
import { isInMaintenance } from '../services/maintenanceService.js';

function classifyIncidentError(error, serviceType) {
  const value = String(error ?? '').toLowerCase();
  if (serviceType === 'website') {
    if (value.includes('timed out')) return 'HTTP_TIMEOUT';
    if (value.includes('dns')) return 'DNS_FAILURE';
    if (value.includes('http status')) return 'HTTP_STATUS_FAILURE';
    if (value.includes('tls') || value.includes('certificate')) return 'TLS_CERTIFICATE_ERROR';
    return 'UNKNOWN';
  }
  if (serviceType === 'database') return value.includes('timeout') ? 'DATABASE_TIMEOUT' : 'DATABASE_CONNECTION_FAILED';
  if (serviceType === 'minecraft') return 'MINECRAFT_CONNECTION_FAILED';
  return 'UNKNOWN';
}

function recordIncidentTransition({ event, serviceId, serviceType, name, state, incident = incidentManager, now = () => Date.now() }) {
  if (!event?.type || !['DOWN', 'STILL_DOWN', 'UP'].includes(event.type)) return null;
  try {
    return incident.handleTransition({
      serviceId,
      serviceType,
      name,
      eventType: event.type,
      occurredAt: now(),
      errorCategory: classifyIncidentError(event.error, serviceType),
      statusCode: Number.isInteger(state?.lastStatus) ? state.lastStatus : null,
      downSince: Number.isFinite(event.downSince) ? event.downSince : null,
    });
  } catch (error) {
    logError('CheckCycle.recordIncidentTransition', error);
    return null;
  }
}

function consumeStillDownReminder(state) {
  const due = shouldRemindStillDown(
    state.lastStillDownNotifiedAt,
    state.stillDownRemindersSent,
    config.stillDownBackoffStepsMs,
  );
  if (!due) return false;
  state.lastStillDownNotifiedAt = Date.now();
  state.stillDownRemindersSent += 1;
  return true;
}

/** Create a re-entrancy-safe monitoring cycle runner. */
export function createCheckRunner({
  client,
  getGuild,
  getConnected,
  checkBots = checkBotStatuses,
  checkMinecraft = checkMcServers,
  checkWebsites = checkWebsiteTargets,
  checkDatabases = checkDatabaseTargets,
  notifyUp = notifyUpBatch,
  notifyDown = notifyDownBatch,
  notifyStillDown = notifyStillDownBatch,
  muteCheck = isMuted,
  maintenanceCheck = isInMaintenance,
  incident = incidentManager,
  now = () => Date.now(),
}) {
  let running = false;

  async function run() {
    if (running) {
      logInfo('CheckCycle', 'Previous cycle still running - skipping this tick.');
      return false;
    }
    running = true;

    const downItems = [];
    const stillItems = [];
    const upItems = [];

    try {
      const isConnected = getConnected();
      const guild = getGuild();

      if (guild) {
        const botEvents = await checkBots(guild, isConnected);
        for (const event of botEvents) {
          const { state } = event;
          recordIncidentTransition({
            event,
            serviceId: event.botId,
            serviceType: 'bot',
            name: state.name,
            state,
            incident,
            now,
          });
          if (muteCheck(event.botId) || maintenanceCheck(event.botId, 'bot', now())) continue;
          if (event.type === 'DOWN') {
            downItems.push({ id: event.botId, name: state.name, type: 'bot', error: null, important: state.hasImportantRole });
          } else if (event.type === 'UP') {
            upItems.push({ id: event.botId, name: state.name, type: 'bot', downSince: event.downSince });
          } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
            stillItems.push({ id: event.botId, name: state.name, type: 'bot', downSince: event.downSince, error: null });
          }
        }
      }

      for (const result of await checkMinecraft(isConnected)) {
        const { server, state, event } = result;
        recordIncidentTransition({ event, serviceId: server.id, serviceType: 'minecraft', name: server.name, state, incident, now });
        if (muteCheck(server.id) || maintenanceCheck(server.id, 'minecraft', now())) continue;
        if (event.type === 'DOWN') {
          downItems.push({ id: server.id, name: server.name, type: 'minecraft', error: event.error, important: true });
        } else if (event.type === 'UP') {
          upItems.push({ id: server.id, name: server.name, type: 'minecraft', downSince: event.downSince });
        } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
          stillItems.push({ id: server.id, name: server.name, type: 'minecraft', downSince: event.downSince, error: event.error });
        }
      }

      for (const result of await checkWebsites(isConnected)) {
        const { target, state, event } = result;
        recordIncidentTransition({ event, serviceId: target.id, serviceType: 'website', name: target.name, state, incident, now });
        if (muteCheck(target.id) || maintenanceCheck(target.id, 'website', now())) continue;
        if (event.type === 'DOWN') {
          downItems.push({ id: target.id, name: target.name, type: 'website', error: event.error, important: false });
        } else if (event.type === 'UP') {
          upItems.push({ id: target.id, name: target.name, type: 'website', downSince: event.downSince });
        } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
          stillItems.push({ id: target.id, name: target.name, type: 'website', downSince: event.downSince, error: event.error });
        }
      }

      for (const result of await checkDatabases(isConnected)) {
        const { target, state, event } = result;
        recordIncidentTransition({ event, serviceId: target.id, serviceType: 'database', name: target.name, state, incident, now });
        if (muteCheck(target.id) || maintenanceCheck(target.id, 'database', now())) continue;
        if (event.type === 'DOWN') {
          downItems.push({ id: target.id, name: target.name, type: 'database', error: event.error, important: false });
        } else if (event.type === 'UP') {
          upItems.push({ id: target.id, name: target.name, type: 'database', downSince: event.downSince });
        } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
          stillItems.push({ id: target.id, name: target.name, type: 'database', downSince: event.downSince, error: event.error });
        }
      }

      await notifyUp(client, upItems);
      await notifyDown(client, downItems);
      await notifyStillDown(client, stillItems);
      return true;
    } catch (err) {
      logError('CheckCycle.run', err);
      return false;
    } finally {
      running = false;
    }
  }

  return { run };
}
