import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { listRecentIncidents } from '../store/incidentStore.js';
import { listDependencies } from '../store/dependencyStore.js';
import { findCandidateRoots } from '../dependencies/dependencyGraph.js';

export const data = new SlashCommandBuilder()
  .setName('diagnose')
  .setDescription('Show cautious dependency correlations for recent incidents (admin only)')
  .addIntegerOption((option) => option
    .setName('window_minutes')
    .setDescription('Correlation window in minutes')
    .setRequired(false)
    .setMinValue(1)
    .setMaxValue(60));

export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const minutes = interaction.options.getInteger('window_minutes') ?? 5;
  const candidates = findCandidateRoots({
    incidents: listRecentIncidents(100),
    dependencies: listDependencies(500),
    correlationWindowMs: minutes * 60 * 1000,
  });
  const description = candidates.length
    ? candidates.map((candidate) => `**${candidate.serviceId}** — ${candidate.wording}: ${candidate.affects.join(', ')}`).join('\n').slice(0, 4096)
    : 'No cautious dependency correlation is available for the recent incident window.';
  const embed = new EmbedBuilder()
    .setTitle('Cautious Incident Diagnosis')
    .setDescription(description)
    .setColor(0xFEE75C)
    .setFooter({ text: 'Correlation is not proof of root cause.' })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
