import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { listSubscriptions } from '../store/subscriptionStore.js';
import {
  buildDownSummaryEmbed,
  buildStillDownSummaryEmbed,
  buildUpSummaryEmbed,
} from './embedBuilder.js';

/**
 * Fetch a text-based channel. Returns null on failure.
 * @param {import('discord.js').Client} client
 * @param {string} channelId
 */
async function fetchTextChannel(client, channelId) {
  try {
    const ch = await client.channels.fetch(channelId);
    return ch?.isTextBased() ? ch : null;
  } catch (err) {
    logError('Notifier.fetchTextChannel', err);
    return null;
  }
}

/**
 * Build the mention payload for an important outage: the admin, the important
 * role, and any opted-in subscribers (users/roles). Returns an empty payload
 * when no ping is warranted so non-critical alerts stay quiet.
 * @param {boolean} pingImportant
 * @returns  content: string|undefined, allowedMentions: object 
 */
function buildAlertMentions(pingImportant) {
  if (!pingImportant) {
    return { content: undefined, allowedMentions: { parse: [] } };
  }

  const userIds = new Set([config.adminUserId]);
  const roleIds = new Set([config.importantRoleId]);

  for (const sub of listSubscriptions()) {
    if (sub.kind === 'user') userIds.add(sub.target_id);
    else if (sub.kind === 'role') roleIds.add(sub.target_id);
  }

  const mentions = [
    ...[...userIds].map((id) => `<@${id}>`),
    ...[...roleIds].map((id) => `<@&${id}>`),
  ];

  return {
    content: mentions.join(' '),
    allowedMentions: { users: [...userIds], roles: [...roleIds] },
  };
}

/**
 * Send a single (deduplicated) DOWN alert covering every target that went down
 * this cycle. Pings the admin / important role / subscribers when any target is
 * important or is the Minecraft server.
 * @param {import('discord.js').Client} client
 * @param {Array<object>} items
 */
export async function notifyDownBatch(client, items) {
  if (!items || items.length === 0) return;
  const ch = await fetchTextChannel(client, config.logChannelId);
  if (!ch) return;

  const pingImportant = items.some((i) => i.important || i.type === 'minecraft');
  const { content, allowedMentions } = buildAlertMentions(pingImportant);

  try {
    const embed = buildDownSummaryEmbed(items);
    await ch.send({ content, embeds: [embed], allowedMentions });
    logInfo('Notifier', `DOWN alert sent for ${items.length} target(s).`);
  } catch (err) {
    logError('Notifier.notifyDownBatch', err);
  }
}

/**
 * Send a single "Still DOWN" reminder covering every target still down.
 * @param {import('discord.js').Client} client
 * @param {Array<object>} items
 */
export async function notifyStillDownBatch(client, items) {
  if (!items || items.length === 0) return;
  const ch = await fetchTextChannel(client, config.logChannelId);
  if (!ch) return;

  try {
    const embed = buildStillDownSummaryEmbed(items);
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    logInfo('Notifier', `Still DOWN reminder sent for ${items.length} target(s).`);
  } catch (err) {
    logError('Notifier.notifyStillDownBatch', err);
  }
}

/**
 * Send a single recovery alert covering every target that recovered this cycle.
 * @param {import('discord.js').Client} client
 * @param {Array<object>} items
 */
export async function notifyUpBatch(client, items) {
  if (!items || items.length === 0) return;
  const ch = await fetchTextChannel(client, config.logChannelId);
  if (!ch) return;

  try {
    const embed = buildUpSummaryEmbed(items);
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    logInfo('Notifier', `UP alert sent for ${items.length} target(s).`);
  } catch (err) {
    logError('Notifier.notifyUpBatch', err);
  }
}

/**
 * Delete this bot's recent messages in a channel. Discord only bulk-deletes
 * messages younger than 14 days; a lone message is deleted individually.
 * @param {import('discord.js').Client} client
 * @param {string} channelId
 * @param {number} limit
 */
async function cleanOwnMessages(client, channelId, limit) {
  const ch = await fetchTextChannel(client, channelId);
  if (!ch) return;

  try {
    const messages = await ch.messages.fetch({ limit });
    const botMessages = messages.filter((m) => m.author.id === client.user.id);
    if (botMessages.size === 0) return;

    if (botMessages.size >= 2) {
      await ch.bulkDelete(botMessages, true);
    } else {
      await botMessages.first()?.delete();
    }
    logInfo('Notifier', `Cleaned ${botMessages.size} old message(s) in channel ${channelId}.`);
  } catch (err) {
    logError('Notifier.cleanOwnMessages', err);
  }
}

/** Remove this bot's old alerts from the log channel on startup. */
export async function cleanLogChannel(client) {
  await cleanOwnMessages(client, config.logChannelId, 100);
}

/** Remove this bot's old status embeds from the monitor channel on startup. */
export async function cleanMonitorChannelEmbeds(client, limit = 50) {
  await cleanOwnMessages(client, config.monitorChannelId, limit);
}
