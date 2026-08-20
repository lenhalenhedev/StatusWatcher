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
export function createCheckRunner({ client, getGuild, getConnected }) {
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
        const botEvents = await checkBotStatuses(guild, isConnected);
        for (const event of botEvents) {
          if (isMuted(event.botId)) continue;
          const { state } = event;
          if (event.type === 'DOWN') {
            downItems.push({ id: event.botId, name: state.name, type: 'bot', error: null, important: state.hasImportantRole });
          } else if (event.type === 'UP') {
            upItems.push({ name: state.name, type: 'bot', downSince: event.downSince });
          } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
            stillItems.push({ name: state.name, type: 'bot', downSince: event.downSince, error: null });
          }
        }
      }

      for (const result of await checkMcServers(isConnected)) {
        const { server, state, event } = result;
        if (isMuted(server.id)) continue;
        if (event.type === 'DOWN') {
          downItems.push({ id: server.id, name: server.name, type: 'minecraft', error: event.error, important: true });
        } else if (event.type === 'UP') {
          upItems.push({ name: server.name, type: 'minecraft', downSince: event.downSince });
        } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
          stillItems.push({ name: server.name, type: 'minecraft', downSince: event.downSince, error: event.error });
        }
      }

      for (const result of await checkWebsiteTargets(isConnected)) {
        const { target, state, event } = result;
        if (isMuted(target.id)) continue;
        if (event.type === 'DOWN') {
          downItems.push({ id: target.id, name: target.name, type: 'website', error: event.error, important: false });
        } else if (event.type === 'UP') {
          upItems.push({ name: target.name, type: 'website', downSince: event.downSince });
        } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
          stillItems.push({ name: target.name, type: 'website', downSince: event.downSince, error: event.error });
        }
      }

      for (const result of await checkDatabaseTargets(isConnected)) {
        const { target, state, event } = result;
        if (isMuted(target.id)) continue;
        if (event.type === 'DOWN') {
          downItems.push({ id: target.id, name: target.name, type: 'database', error: event.error, important: false });
        } else if (event.type === 'UP') {
          upItems.push({ name: target.name, type: 'database', downSince: event.downSince });
        } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
          stillItems.push({ name: target.name, type: 'database', downSince: event.downSince, error: event.error });
        }
      }

      await notifyUpBatch(client, upItems);
      await notifyDownBatch(client, downItems);
      await notifyStillDownBatch(client, stillItems);
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
