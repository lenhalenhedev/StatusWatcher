import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { getElapsedSeconds } from '../utils/timeUtils.js';
import {
  registerTarget,
  recordDown,
  recordUp,
  archiveTarget,
  getOpenSessionStart,
} from '../utils/uptimeTracker.js';

/**
 * Runtime state for each monitored bot:
 * {
 *   name: string,
 *   hasImportantRole: boolean,
 *   isConfirmedDown: boolean,             // true once the threshold has been crossed
 *   firstSeenOffline: number|null,        // epoch ms - first time detected offline
 *   confirmedDownAt: number|null,         // epoch ms - moment confirmed DOWN
 *   lastStillDownNotifiedAt: number|null, // epoch ms - last "Still DOWN" reminder
 *   stillDownRemindersSent: number,       // reminders sent during the current outage
 * }
 */
const botStates = new Map();

const confirmDownThresholdSec = config.confirmDownThresholdMs / 1_000;

/**
 * Whether a guild member is a bot we should monitor (excludes this monitor bot).
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function isMonitorableBot(member) {
  return Boolean(member?.user?.bot) && member.id !== member.guild.client.user.id;
}

/**
 * Create the initial runtime state for a bot and persist it as an active target.
 * A bot that is already offline at boot is treated as a known outage so it
 * shows as DOWN immediately and emits a reminder on the first cycle.
 * @param {import('discord.js').GuildMember} member
 * @returns {object} The created runtime state.
 */
function createInitialState(member) {
  const hasImportantRole = member.roles.cache.has(config.importantRoleId);
  const isOffline = !member.presence || member.presence.status === 'offline';

  const bootConfirmedDownAt = isOffline ? Date.now() : null;
  const bootFirstSeenOffline = isOffline
    ? bootConfirmedDownAt - config.confirmDownThresholdMs
    : null;

  const state = {
    name: member.user.username,
    hasImportantRole,
    isConfirmedDown: Boolean(isOffline),
    firstSeenOffline: bootFirstSeenOffline,
    confirmedDownAt: bootConfirmedDownAt,
    lastStillDownNotifiedAt: null,
    stillDownRemindersSent: 0,
  };

  botStates.set(member.id, state);
  registerTarget(member.id, member.user.username, { type: 'bot', hasImportantRole });

  if (isOffline) {
    recordDown(member.id, bootFirstSeenOffline);
  }

  return state;
}

/**
 * Scan every bot in the guild and establish the initial monitoring state.
 * Must be called after GuildMembers and GuildPresences have been fetched.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<Map<string, object>>}
 */
export async function initBotMonitor(guild) {
  const members = await guild.members.fetch();

  for (const [, member] of members) {
    if (!isMonitorableBot(member)) continue;
    const state = createInitialState(member);
    logInfo(
      'BotMonitor',
      `Registered: ${state.name} | ` +
      `Status: ${member.presence?.status ?? 'offline'} | ` +
      `Important: ${state.hasImportantRole}`,
    );
  }

  return botStates;
}

/** Return the current map of bot states (used by the embed builder). */
export function getBotStates() {
  return botStates;
}

/**
 * Handle a member joining while the monitor is running.
 * @param {import('discord.js').GuildMember} member
 */
export function handleMemberAdd(member) {
  try {
    if (!isMonitorableBot(member)) return;
    if (botStates.has(member.id)) return;
    const state = createInitialState(member);
    logInfo('BotMonitor', `New bot joined and registered: ${state.name}`);
  } catch (err) {
    logError('BotMonitor.handleMemberAdd', err);
  }
}

/**
 * Handle a member leaving / being kicked.
 * @param {import('discord.js').GuildMember | { id: string }} member
 */
export function handleMemberRemove(member) {
  try {
    const id = member?.id;
    if (!id || !botStates.has(id)) return;
    stopMonitoring(id);
  } catch (err) {
    logError('BotMonitor.handleMemberRemove', err);
  }
}

/**
 * Stop monitoring a target: close any open session, archive it (history kept)
 * and drop it from the active runtime map.
 * @param {string} id
 */
function stopMonitoring(id) {
  const state = botStates.get(id);
  const name = state?.name ?? id;
  archiveTarget(id);
  botStates.delete(id);
  logInfo('BotMonitor', `Stopped monitoring (archived): ${name}`);
}

/**
 * Reset a bot's runtime state back to the healthy baseline.
 * @param {object} state
 */
function resetState(state) {
  state.firstSeenOffline = null;
  state.isConfirmedDown = false;
  state.confirmedDownAt = null;
  state.lastStillDownNotifiedAt = null;
  state.stillDownRemindersSent = 0;
}

/**
 * Check the status of every monitored bot in a single cycle.
 * Returns the list of state-change events.
 *
 * @param {import('discord.js').Guild} guild
 * @param {boolean} isConnected - Whether the main bot is connected.
 * @returns {Promise<Array<object>>}
 */
export async function checkBotStatuses(guild, isConnected) {
  if (!isConnected) {
    logInfo('BotMonitor', 'Skipping check cycle - main bot is disconnected.');
    return [];
  }

  const events = [];

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    logError('BotMonitor.checkBotStatuses.fetch', err);
    return events;
  }

  // Reconcile removed bots: any tracked id no longer present is archived.
  for (const id of [...botStates.keys()]) {
    if (!members.has(id)) stopMonitoring(id);
  }

  for (const [id, member] of members) {
    try {
      if (!isMonitorableBot(member)) continue;

      let state = botStates.get(id);
      if (!state) {
        state = createInitialState(member);
        logInfo('BotMonitor', `Auto-registered untracked bot: ${state.name}`);
      }

      const isCurrentlyOffline = !member.presence || member.presence.status === 'offline';

      if (isCurrentlyOffline) {
        if (state.firstSeenOffline === null) {
          state.firstSeenOffline = Date.now();
          logInfo('BotMonitor', `${state.name} offline - starting ${confirmDownThresholdSec}s threshold...`);
        } else if (!state.isConfirmedDown) {
          const elapsedSec = getElapsedSeconds(state.firstSeenOffline);
          if (elapsedSec >= confirmDownThresholdSec) {
            state.isConfirmedDown = true;
            state.confirmedDownAt = Date.now();
            // Seed the reminder clock and counter so the first "Still DOWN"
            // reminder waits a full backoff step after the initial DOWN alert.
            state.lastStillDownNotifiedAt = state.confirmedDownAt;
            state.stillDownRemindersSent = 0;
            recordDown(id, state.firstSeenOffline);
            const downSince = getOpenSessionStart(id) ?? state.confirmedDownAt;
            events.push({ type: 'DOWN', botId: id, state, downSince });
            logInfo('BotMonitor', `${state.name} confirmed DOWN after ${elapsedSec}s.`);
          }
        } else {
          // Already confirmed DOWN -> report Still DOWN using the persisted start.
          const downSince = getOpenSessionStart(id) ?? state.confirmedDownAt;
          events.push({ type: 'STILL_DOWN', botId: id, state, downSince });
        }
      } else if (state.isConfirmedDown) {
        // Recovery: DOWN -> UP. Capture the real downtime start before closing it.
        const downSince = getOpenSessionStart(id) ?? state.confirmedDownAt;
        recordUp(id);
        events.push({ type: 'UP', botId: id, state, downSince });
        resetState(state);
        logInfo('BotMonitor', `${state.name} recovered UP.`);
      } else {
        // Healthy and online: clear any pending offline timer.
        resetState(state);
      }
    } catch (err) {
      logError('BotMonitor.checkBotStatuses.member', err);
    }
  }

  return events;
}
