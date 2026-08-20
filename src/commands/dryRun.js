import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { previewWebsite } from '../services/dryRunService.js';

export const data = new SlashCommandBuilder()
  .setName('dry-run')
  .setDescription('Validate and probe a website without saving it (admin only)')
  .addStringOption((option) => option.setName('name').setDescription('Proposed monitor name').setRequired(true))
  .addStringOption((option) => option.setName('url').setDescription('Proposed website URL').setRequired(true));

export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const preview = await previewWebsite({
      name: interaction.options.getString('name', true),
      url: interaction.options.getString('url', true),
    });
    const embed = new EmbedBuilder()
      .setTitle('Dry-run Preview')
      .setColor(preview.status === 'ONLINE' ? 0x57F287 : 0xED4245)
      .addFields(
        { name: 'Monitor name', value: preview.name, inline: true },
        { name: 'Probe status', value: preview.status, inline: true },
        { name: 'HTTP status', value: String(preview.statusCode ?? 'No response'), inline: true },
        { name: 'Duration', value: preview.durationMs === null ? 'No data' : `${preview.durationMs} ms`, inline: true },
        { name: 'Persistence', value: 'Not saved', inline: true },
      )
      .setFooter({ text: 'Preview only. Use configuration controls to save a validated monitor.' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    await interaction.reply({ content: 'Dry-run failed. The proposed monitor was not saved.', flags: MessageFlags.Ephemeral });
  }
}
