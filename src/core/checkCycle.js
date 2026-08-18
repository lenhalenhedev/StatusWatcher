import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { checkBotStatuses } from '../monitors/botMonitor.js';
import { checkMcServer, getMcState, MC_TARGET_ID } from '../monitors/mcMonitor.js';
import {
  notifyDownBatch,
  notifyStillDownBatch,
  notifyUpBatch,
} from '../handlers/notifier.js';
import { shouldRemindStillDown } from '../utils/stillDownBackoff.js';
import { isMuted } from '../store/muteStore.js';

/**
 * Decide whether a "Still DOWN" reminder is due for a target. When due, advance
 * the target's reminder clock and counter (escalating backoff) and return true.
 * @param {object} state - mutable runtime state with reminder fields.
 * @returns {boolean}
 */
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

/**
 * Create a re-entrancy-safe monitoring cycle runner.
 *
 * One cycle: collect bot + Minecraft events, drop muted targets, apply the
 * escalating "Still DOWN" backoff, then emit at most one summary embed per
 * category (UP / DOWN / Still DOWN) so simultaneous outages are deduplicated.
 *
 * @param {object} deps
 * @param {import('discord.js').Client} deps.client
 * @param {() => import('discord.js').Guild|null} deps.getGuild
 * @param {() => boolean} deps.getConnected
 * @returns  run: () => Promise<boolean> 
 */
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

      // --- Bots ---
      if (guild) {
        const botEvents = await checkBotStatuses(guild, isConnected);
        for (const event of botEvents) {
          if (isMuted(event.botId)) continue;
          const { state } = event;

          if (event.type === 'DOWN') {
            downItems.push({
              id: event.botId,
              name: state.name,
              type: 'bot',
              error: null,
              important: state.hasImportantRole,
            });
          } else if (event.type === 'UP') {
            upItems.push({ name: state.name, type: 'bot', downSince: event.downSince });
          } else if (event.type === 'STILL_DOWN' && consumeStillDownReminder(state)) {
            stillItems.push({ name: state.name, type: 'bot', downSince: event.downSince, error: null });
          }
        }
      }

      // --- Minecraft server ---
      if (config.mcEnabled) {
        const mcEvent = await checkMcServer(isConnected);
        if (!isMuted(MC_TARGET_ID)) {
          const mcState = getMcState();
          if (mcEvent.type === 'DOWN') {
            downItems.push({
              id: MC_TARGET_ID,
              name: config.mcServerName,
              type: 'minecraft',
              error: mcEvent.error,
              important: true,
            });
          } else if (mcEvent.type === 'UP') {
            upItems.push({ name: config.mcServerName, type: 'minecraft', downSince: mcEvent.downSince });
          } else if (mcEvent.type === 'STILL_DOWN' && consumeStillDownReminder(mcState)) {
            stillItems.push({
              name: config.mcServerName,
              type: 'minecraft',
              downSince: mcEvent.downSince,
              error: mcEvent.error,
            });
          }
        }
      }

      // Emit recoveries first, then new outages, then reminders.
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
