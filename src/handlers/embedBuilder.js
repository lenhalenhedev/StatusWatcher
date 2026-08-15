import { EmbedBuilder } from 'discord.js';
import { getTimestampUTC7, getElapsedMinutes } from '../utils/timeUtils.js';
import {
  getDailyUptime,
  getWeeklyUptime,
  getMonthlyUptime,
  getYearlyUptime,
  getOpenSessionStart,
} from '../utils/uptimeTracker.js';
import { MC_TARGET_ID } from '../monitors/mcMonitor.js';
import config from '../config.js';
import { getStatusPage } from './statusPagination.js';

// Standard status colors.
const COLOR = {
  UP:      0x57F287,
  DOWN:    0xED4245,
  WARNING: 0xFEE75C,
  INFO:    0x5865F2,
};

// Discord hard limit per embed field value.
const FIELD_VALUE_LIMIT = 1024;
// Safety margin so trailing newlines / formatting never exceed the hard limit.
const FIELD_SAFE_LIMIT = 1000;

/**
 * Build the inline uptime / SLA metrics line for a target across all periods.
 * @param {string} id
 * @returns {string}
 */
function buildUptimeLine(id) {
  return (
    `Uptime 24h: \`${getDailyUptime(id)}%\` | ` +
    `7d: \`${getWeeklyUptime(id)}%\` | ` +
    `30d: \`${getMonthlyUptime(id)}%\` | ` +
    `1y: \`${getYearlyUptime(id)}%\``
  );
}

/**
 * Minutes a target has been down, using the persisted session start (which
 * survives restarts) and falling back to a runtime timestamp.
 * @param {string} id
 * @param {number|null} fallbackTs
 * @returns {number}
 */
function downtimeMinutes(id, fallbackTs) {
  const start = getOpenSessionStart(id) ?? fallbackTs;
  return start ? getElapsedMinutes(start) : 0;
}

export function buildStatusEmbed(botStates, mcState, page = 0) {
  const { currentPage, totalPages, bots } = getStatusPage(botStates, page);
  const embed = new EmbedBuilder()
    .setTitle('📊 System Status Monitor')
    .setColor(COLOR.INFO)
    .setFooter({ text: `Updated at: ${getTimestampUTC7()} (UTC+7)` })
    .setTimestamp();

  // --- Minecraft Server section ---
  let mcField = '🟡 **Checking...**';

  if (mcState.isConfirmedDown) {
    const min = downtimeMinutes(MC_TARGET_ID, mcState.confirmedDownAt);
    const errorText = String(mcState.lastError ?? 'Unknown connection error').substring(0, 500);
    mcField =
      `🔴 **DOWN** — Down for **${min} min**\n` +
      `\`\`Error: ${errorText}\`\`\n` +
      `${buildUptimeLine(MC_TARGET_ID)}`;
  } else if (mcState.lastPingData) {
    const players = mcState.lastPingData.players ?? 0;
    const maxPlayers = mcState.lastPingData.maxPlayers ?? 0;
    mcField =
      `🟢 **ONLINE** — \`${config.mcServerName}\`\n` +
      `Players: **${players}/${maxPlayers}**\n` +
      `${buildUptimeLine(MC_TARGET_ID)}`;
  }

  embed.addFields({
    name: '🎮 Minecraft Server',
    value: String(mcField).substring(0, FIELD_VALUE_LIMIT),
    inline: false,
  });

  // --- Bot sections (chunked to respect the 1024-character field limit) ---
  if (!botStates || botStates.size === 0) {
    embed.addFields({ name: '🤖 Bots', value: 'No bots are being monitored.', inline: false });
    return embed;
  }

  let currentContent = '';
  let fieldCount = 1;

  const pushField = (content, count) => {
    embed.addFields({
      name: count === 1
        ? `🤖 Server Bots — Page ${currentPage + 1}/${totalPages}`
        : `🤖 Server Bots — Page ${currentPage + 1}/${totalPages} (continued)`,
      value: content.trim().substring(0, FIELD_VALUE_LIMIT),
      inline: false,
    });
  };

  for (const [id, state] of bots) {
    const star = state.hasImportantRole ? ' ⭐' : '';
    const name = state.name || 'Unknown Bot';
    let botLine;

    if (state.isConfirmedDown) {
      const min = downtimeMinutes(id, state.confirmedDownAt);
      botLine = `🔴 **${name}**${star} — DOWN (**${min} min**)\n   └ ${buildUptimeLine(id)}`;
    } else {
      botLine = `🟢 **${name}**${star} — ONLINE\n   └ ${buildUptimeLine(id)}`;
    }

    if (currentContent.length + botLine.length + 1 > FIELD_SAFE_LIMIT) {
      pushField(currentContent, fieldCount);
      currentContent = botLine + '\n';
      fieldCount++;
    } else {
      currentContent += botLine + '\n';
    }
  }

  if (currentContent.trim().length > 0) {
    pushField(currentContent, fieldCount);
  }

  return embed;
}

/** Human label for a target type. */
function typeLabel(type) {
  return type === 'minecraft' ? 'Minecraft Server' : 'Server Bot';
}

/**
 * Build a single summary embed for one or more targets that just went DOWN.
 * @param {Array<{ name: string, type: string, error?: string|null, important?: boolean }>} items
 */
export function buildDownSummaryEmbed(items) {
  const title = items.length === 1
    ? `🔴 ${items[0].name} is now DOWN`
    : `🔴 ${items.length} targets are now DOWN`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLOR.DOWN)
    .setFooter({ text: `${getTimestampUTC7()} (UTC+7)` })
    .setTimestamp();

  for (const it of items.slice(0, 25)) {
    const star = it.important ? ' ⭐' : '';
    const error = it.error ? `\nError: \`${String(it.error).substring(0, 300)}\`` : '';
    embed.addFields({
      name: `${it.name}${star}`,
      value: `${typeLabel(it.type)}${error}`.substring(0, FIELD_VALUE_LIMIT),
      inline: false,
    });
  }

  return embed;
}

/**
 * Build a single summary embed for targets that are still down.
 * @param {Array<{ name: string, type: string, downSince: number, error?: string|null }>} items
 */
export function buildStillDownSummaryEmbed(items) {
  const title = items.length === 1
    ? `⚠️ ${items[0].name} — Still DOWN`
    : `⚠️ ${items.length} targets — Still DOWN`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLOR.WARNING)
    .setFooter({ text: `${getTimestampUTC7()} (UTC+7)` })
    .setTimestamp();

  for (const it of items.slice(0, 25)) {
    const min = it.downSince ? getElapsedMinutes(it.downSince) : 0;
    const error = it.error ? `\nError: \`${String(it.error).substring(0, 300)}\`` : '';
    embed.addFields({
      name: it.name,
      value: `${typeLabel(it.type)} — down for **${min} min**${error}`.substring(0, FIELD_VALUE_LIMIT),
      inline: false,
    });
  }

  return embed;
}

/**
 * Build a single summary embed for targets that just recovered.
 * @param {Array<{ name: string, type: string, downSince?: number }>} items
 */
export function buildUpSummaryEmbed(items) {
  const title = items.length === 1
    ? `✅ ${items[0].name} is now UP`
    : `✅ ${items.length} targets recovered`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLOR.UP)
    .setFooter({ text: `${getTimestampUTC7()} (UTC+7)` })
    .setTimestamp();

  for (const it of items.slice(0, 25)) {
    const min = it.downSince ? getElapsedMinutes(it.downSince) : 0;
    embed.addFields({
      name: it.name,
      value: `${typeLabel(it.type)} — recovered after **${min} min**`.substring(0, FIELD_VALUE_LIMIT),
      inline: false,
    });
  }

  return embed;
}
