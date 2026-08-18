import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';
import { getTimestampUTC7 } from '../utils/timeUtils.js';
import {
  listTargets,
  getDailyUptime,
  getWeeklyUptime,
  getMonthlyUptime,
} from '../utils/uptimeTracker.js';

const FIELD_VALUE_LIMIT = 1024;

/**
 * Build the daily digest embed summarizing uptime across all active targets.
 * @returns {EmbedBuilder}
 */
function buildDigestEmbed() {
  const targets = listTargets({ activeOnly: true })
    .filter((target) => config.mcEnabled || target.type !== 'minecraft');

  const embed = new EmbedBuilder()
    .setTitle('📅 Daily Uptime Digest')
    .setColor(0x5865F2)
    .setFooter({ text: `${getTimestampUTC7()} (UTC+7)` })
    .setTimestamp();

  if (targets.length === 0) {
    embed.setDescription('No active targets are being monitored.');
    return embed;
  }

  const lines = targets.map((t) => {
    const icon = t.type === 'minecraft' ? '🎮' : '🤖';
    const star = t.has_important_role ? ' ⭐' : '';
    return (
      `${icon} **${t.name}**${star}\n` +
      `   └ 24h: \`${getDailyUptime(t.id)}%\` | ` +
      `7d: \`${getWeeklyUptime(t.id)}%\` | ` +
      `30d: \`${getMonthlyUptime(t.id)}%\``
    );
  });

  // Chunk into fields so we never exceed the per-field character limit.
  let buffer = '';
  let page = 1;
  const flush = () => {
    embed.addFields({
      name: page === 1 ? 'Uptime report' : `Uptime report (page ${page})`,
      value: buffer.trim().substring(0, FIELD_VALUE_LIMIT),
      inline: false,
    });
  };

  for (const line of lines) {
    if (buffer.length + line.length + 1 > 1000) {
      flush();
      buffer = line + '\n';
      page++;
    } else {
      buffer += line + '\n';
    }
  }
  if (buffer.trim().length > 0) flush();

  return embed;
}

/**
 * Post the daily uptime digest to the configured log channel.
 * @param {import('discord.js').Client} client
 */
export async function postDailyDigest(client) {
  try {
    const ch = await client.channels.fetch(config.logChannelId);
    if (!ch?.isTextBased()) return;
    await ch.send({ embeds: [buildDigestEmbed()], allowedMentions: { parse: [] } });
    logInfo('Digest', 'Daily uptime digest posted to the log channel.');
  } catch (err) {
    logError('Digest.postDailyDigest', err);
  }
}
