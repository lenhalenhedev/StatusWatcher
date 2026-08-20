import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import runtimeConfig from '../config.js';
import { listAudit } from '../store/auditStore.js';

export const data = new SlashCommandBuilder()
  .setName('audit')
  .setDescription('View recent configuration audit events (admin only).')
  .addIntegerOption((option) => option.setName('limit').setDescription('Number of events, up to 25.').setMinValue(1).setMaxValue(25).setRequired(false));

export async function execute(interaction, dependencies = {}) {
  if (interaction.user?.id !== runtimeConfig.adminUserId) {
    await interaction.reply({ content: 'Only the configured administrator can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const rows = (dependencies.listAudit || listAudit)(interaction.options.getInteger('limit') ?? 10);
  const content = rows.length === 0
    ? 'No audit events are available.'
    : rows.map((row) => `${new Date(row.created_at).toISOString()} — ${row.action} — ${row.target_type}${row.target_id ? `:${row.target_id}` : ''} — value hash ${row.value_hash}`).join('\n').slice(0, 1_900);
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
