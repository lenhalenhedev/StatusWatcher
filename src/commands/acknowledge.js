import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { acknowledgeIncident } from '../store/incidentStore.js';

export const data = new SlashCommandBuilder()
  .setName('acknowledge')
  .setDescription('Acknowledge an active incident and suppress duplicate communication.')
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
  const incident = acknowledgeIncident(incidentId, interaction.user.id);
  if (!incident) {
    await interaction.reply({ content: 'The incident does not exist or is not in an open state.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    content: `Incident **${incident.id}** acknowledged. Repeated STILL_DOWN reminders are suppressed; health monitoring continues, and an UP event will automatically resolve this incident.`,
    flags: MessageFlags.Ephemeral,
  });
}
