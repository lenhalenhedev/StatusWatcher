import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { listIncidentsInWindow } from '../store/incidentStore.js';
import { listLatencySamplesInWindow } from '../store/latencyStore.js';
import { calculateReliabilityMetrics } from '../reporting/reliabilityReport.js';
import { formatDuration } from '../utils/duration.js';

const WINDOWS = Object.freeze({
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
});

export const data = new SlashCommandBuilder()
  .setName('reliability')
  .setDescription('Show aggregate reliability metrics for monitored services (admin only)')
  .addStringOption((option) => option
    .setName('window')
    .setDescription('Reporting window')
    .setRequired(false)
    .addChoices(
      { name: 'Last 24 hours', value: '24h' },
      { name: 'Last 7 days', value: '7d' },
      { name: 'Last 30 days', value: '30d' },
    ));

function metricDuration(value) {
  return value === null ? 'No data' : formatDuration(value);
}

export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const key = interaction.options.getString('window') ?? '24h';
  const durationMs = WINDOWS[key];
  if (!durationMs) {
    await interaction.reply({ content: 'Invalid reporting window.', flags: MessageFlags.Ephemeral });
    return;
  }

  const windowEnd = Date.now();
  const windowStart = windowEnd - durationMs;
  const metrics = calculateReliabilityMetrics({
    windowStart,
    windowEnd,
    incidents: listIncidentsInWindow({ startAt: windowStart, endAt: windowEnd }),
    samples: listLatencySamplesInWindow({ startAt: windowStart, endAt: windowEnd }),
  });

  const embed = new EmbedBuilder()
    .setTitle(`Reliability Report — ${key}`)
    .setColor(metrics.uptimePercent >= 99.9 ? 0x57F287 : metrics.uptimePercent >= 99 ? 0xFEE75C : 0xED4245)
    .addFields(
      { name: 'Availability', value: `${metrics.uptimePercent.toFixed(2)}% uptime\n${formatDuration(metrics.downtimeMs)} downtime`, inline: true },
      { name: 'Incidents', value: `${metrics.incidentCount}`, inline: true },
      { name: 'Latency', value: `${metrics.latency.count} samples\np50: ${metrics.latency.p50 ?? 'No data'} ms\np95: ${metrics.latency.p95 ?? 'No data'} ms\np99: ${metrics.latency.p99 ?? 'No data'} ms`, inline: true },
      { name: 'MTTD', value: metricDuration(metrics.mttdMs), inline: true },
      { name: 'MTTR', value: metricDuration(metrics.mttrMs), inline: true },
      { name: 'MTBF', value: metricDuration(metrics.mtbfMs), inline: true },
    )
    .setFooter({ text: 'Aggregate metrics; values are based on persisted monitor history.' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
