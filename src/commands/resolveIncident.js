import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { resolveIncidentCommunication } from '../store/incidentStore.js';

export const data = new SlashCommandBuilder()
  .setName('resolve-incident')
  .setDescription('Resolve incident communication after the response is complete.')
  .addIntegerOption((option) => option
    .setName('incident_id')
    .setDescription('SQLite incident ID shown by incident reports.')
    .setRequired(true)
    .setMinValue(1));

export async function execute(interaction) {
  if (interaction.user?.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const incidentId = interaction.options.getInteger('incident_id', true);
  const incident = resolveIncidentCommunication(incidentId, interaction.user.id);
  if (!incident) {
    await interaction.reply({ content: 'The incident does not exist or its communication is already resolved.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    content: `Incident **${incident.id}** communication resolved. Monitoring remains active until the service recovers.`,
    flags: MessageFlags.Ephemeral,
  });
}
