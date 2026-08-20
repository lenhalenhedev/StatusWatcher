import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { getElapsedSeconds } from '../utils/timeUtils.js';
import { recordProbeEvidence } from '../services/probeEvidenceService.js';
import {
  registerTarget,
  recordDown,
  recordUp,
  deleteTarget,
  getOpenSessionStart,
  getTarget,
  listTargets,
} from '../utils/uptimeTracker.js';

/**
 * Runtime state for each monitored bot:
 * {
 *   name: string,
 *   hasImportantRole: boolean,
 *   isConfirmedDown: boolean,
 *   firstSeenOffline: number|null,
 *   confirmedDownAt: number|null,
 *   lastStillDownNotifiedAt: number|null,
 *   stillDownRemindersSent: number,
 * }
 */
const botStates = new Map();

/**
 * Whether a guild member is a bot we should monitor (excludes this monitor bot).
 * This also accepts partial members received by guildMemberRemove.
 * @param {import('discord.js').GuildMember|import('discord.js').PartialGuildMember} member
 * @returns {boolean}
 */
function isMonitorableBot(member) {
  return Boolean(member?.user?.bot) && member.id !== config.clientId;
}

function memberHasImportantRole(member) {
  return Boolean(member?.roles?.cache?.has?.(config.importantRoleId));
}

function memberName(member) {
  return member?.user?.globalName || member?.user?.username || member?.displayName || member?.id || 'Unknown Bot';
}

/**
 * Create the initial runtime state for a bot and persist its current metadata.
 * @param {import('discord.js').GuildMember} member
 * @returns {object}
 */
function createInitialState(member, { persist = true } = {}) {
  const hasImportantRole = memberHasImportantRole(member);
  const isOffline = !member.presence || member.presence.status === 'offline';

  const bootConfirmedDownAt = isOffline ? Date.now() : null;
  const bootFirstSeenOffline = isOffline
    ? bootConfirmedDownAt - config.confirmDownThresholdMs
    : null;

  const state = {
    name: memberName(member),
    hasImportantRole,
    isConfirmedDown: Boolean(isOffline),
    firstSeenOffline: bootFirstSeenOffline,
    confirmedDownAt: bootConfirmedDownAt,
    lastStillDownNotifiedAt: null,
    stillDownRemindersSent: 0,
  };

  botStates.set(member.id, state);
  if (persist) registerTarget(member.id, state.name, { type: 'bot', hasImportantRole });

  if (isOffline) recordDown(member.id, bootFirstSeenOffline);
  return state;
}

/**
 * Restore only active bot IDs stored in SQLite. Each ID is fetched individually
 * so startup reconciles persistence without requesting the complete guild.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<Map<string, object>>}
 */
export async function initBotMonitor(guild) {
  botStates.clear();
  const storedBots = listTargets({ activeOnly: true }).filter(target => target.type === 'bot');

  for (const target of storedBots) {
    try {
      const member = await guild.members.fetch(target.id);
      if (!isMonitorableBot(member)) {
        deleteTarget(target.id);
        continue;
      }

      const state = createInitialState(member);
      logInfo(
        'BotMonitor',
        `Restored: ${state.name} | ` +
        `Status: ${member.presence?.status ?? 'offline'} | ` +
        `Important: ${state.hasImportantRole}`,
      );
    } catch (err) {
      // A failed lookup is treated as no longer present. This also handles
      // Discord's unknown-member response during startup reconciliation.
      deleteTarget(target.id);
      botStates.delete(target.id);
      logInfo('BotMonitor', `Removed missing bot target from SQLite: ${target.name} (${target.id})`);
    }
  }

  return botStates;
}

/** Return the current map of bot states (used by the embed builder). */
export function getBotStates() {
  return botStates;
}

/**
 * Register a bot received through the guildMemberAdd event or fetch command.
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
export function addBotToMonitor(member) {
  if (!isMonitorableBot(member)) return false;

  const existing = botStates.get(member.id);
  if (existing) {
    existing.name = memberName(member);
    existing.hasImportantRole = memberHasImportantRole(member);
    registerTarget(member.id, existing.name, { type: 'bot', hasImportantRole: existing.hasImportantRole });
    return false;
  }

  const state = createInitialState(member);
  logInfo('BotMonitor', `Bot added and registered: ${state.name}`);
  return true;
}

/**
 * Load a member into the runtime map after its target row has already been
 * persisted. Existing state is preserved so an in-progress outage is not reset.
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
export function hydrateBotState(member) {
  if (!isMonitorableBot(member)) return false;
  const existing = botStates.get(member.id);
  if (existing) {
    existing.name = memberName(member);
    existing.hasImportantRole = memberHasImportantRole(member);
    return false;
  }
  createInitialState(member, { persist: false });
  return true;
}

/** Remove a bot from the in-memory monitor after its persistence row is deleted. */
export function removeBotState(id) {
  return botStates.delete(id);
}

/** Re-read important-role membership from cached members after runtime config changes. */
export function refreshBotRoleFlags(guild) {
  for (const [id, state] of botStates) {
    const member = guild?.members?.cache?.get(id);
    if (!member) continue;
    state.hasImportantRole = memberHasImportantRole(member);
    registerTarget(id, state.name, { type: 'bot', hasImportantRole: state.hasImportantRole });
  }
}

export function handleMemberAdd(member) {
  try {
    return addBotToMonitor(member);
  } catch (err) {
    logError('BotMonitor.handleMemberAdd', err);
    return false;
  }
}

/**
 * Stop monitoring and physically delete a target from SQLite.
 * @param {string} id
 */
function stopMonitoring(id) {
  const state = botStates.get(id);
  const target = getTarget(id);
  const name = state?.name ?? target?.name ?? id;
  botStates.delete(id);
  deleteTarget(id);
  logInfo('BotMonitor', `Stopped monitoring and deleted target: ${name}`);
}

/**
 * Handle a member leaving / being kicked. The target is deleted even when it
 * was restored in SQLite but not present in the current runtime map.
 * @param {import('discord.js').GuildMember|{id: string}} member
 */
export function handleMemberRemove(member) {
  try {
    const id = member?.id;
    if (!id || (!botStates.has(id) && !getTarget(id))) return false;
    stopMonitoring(id);
    return true;
  } catch (err) {
    logError('BotMonitor.handleMemberRemove', err);
    return false;
  }
}

function resetState(state) {
  state.firstSeenOffline = null;
  state.isConfirmedDown = false;
  state.confirmedDownAt = null;
  state.lastStillDownNotifiedAt = null;
  state.stillDownRemindersSent = 0;
}

/**
 * Check the presence of every monitored bot from the runtime member cache.
 * No guild-wide member fetch occurs in the hot monitoring path.
 * @param {import('discord.js').Guild} guild
 * @param {boolean} isConnected
 * @returns {Promise<Array<object>>}
 */
export async function checkBotStatuses(guild, isConnected) {
  if (!isConnected) {
    logInfo('BotMonitor', 'Skipping check cycle - main bot is disconnected.');
    return [];
  }

  const events = [];

  for (const [id, state] of botStates) {
    try {
      const member = guild?.members?.cache?.get(id);
      if (!member) {
        logInfo('BotMonitor', `Skipping ${id} - member is not in the runtime cache.`);
        continue;
      }

      state.name = memberName(member);
      state.hasImportantRole = memberHasImportantRole(member);
      const startedAt = Date.now();
      const isCurrentlyOffline = !member.presence || member.presence.status === 'offline';

      if (isCurrentlyOffline) {
        let evidenceEventType = null;
        if (state.firstSeenOffline === null) {
          state.firstSeenOffline = Date.now();
          logInfo('BotMonitor', `${state.name} offline - starting ${config.confirmDownThresholdMs / 1_000}s threshold...`);
        } else if (!state.isConfirmedDown) {
          const elapsedSec = getElapsedSeconds(state.firstSeenOffline);
          if (elapsedSec >= config.confirmDownThresholdMs / 1_000) {
            state.isConfirmedDown = true;
            state.confirmedDownAt = Date.now();
            state.lastStillDownNotifiedAt = state.confirmedDownAt;
            state.stillDownRemindersSent = 0;
            recordDown(id, state.firstSeenOffline);
            const downSince = getOpenSessionStart(id) ?? state.confirmedDownAt;
            events.push({ type: 'DOWN', botId: id, state, downSince });
            evidenceEventType = 'DOWN';
            logInfo('BotMonitor', `${state.name} confirmed DOWN after ${elapsedSec}s.`);
          }
        } else {
          const downSince = getOpenSessionStart(id) ?? state.confirmedDownAt;
          events.push({ type: 'STILL_DOWN', botId: id, state, downSince });
          evidenceEventType = 'STILL_DOWN';
        }
        recordProbeEvidence({
          serviceId: id,
          serviceType: 'bot',
          observedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: false,
          eventType: evidenceEventType,
          errorCategory: 'UNKNOWN',
        });
      } else if (state.isConfirmedDown) {
        const downSince = getOpenSessionStart(id) ?? state.confirmedDownAt;
        recordUp(id);
        events.push({ type: 'UP', botId: id, state, downSince });
        resetState(state);
        recordProbeEvidence({
          serviceId: id,
          serviceType: 'bot',
          observedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: true,
          eventType: 'UP',
        });
        logInfo('BotMonitor', `${state.name} recovered UP.`);
      } else {
        resetState(state);
        recordProbeEvidence({
          serviceId: id,
          serviceType: 'bot',
          observedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          success: true,
          eventType: 'ONLINE',
        });
      }
    } catch (err) {
      logError('BotMonitor.checkBotStatuses.member', err);
    }
  }

  return events;
}
