import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import config from '../config.js';
import { runManualCheck } from '../core/monitorController.js';
import { getStatusMessagePayload } from '../services/statusMessage.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcStates } from '../monitors/mcMonitor.js';
import { getDatabaseStates } from '../monitors/databaseMonitor.js';

export const data = new SlashCommandBuilder()
  .setName('recheck')
  .setDescription('Force an immediate monitoring cycle (admin only)');

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ran = await runManualCheck();
  const statusPayload = getStatusMessagePayload(getBotStates(), getMcStates(), 0, getDatabaseStates());

  await interaction.editReply({
    content: ran
      ? '✅ Manual check completed.'
      : '⏳ A check is already running — showing the latest known status.',
    ...statusPayload,
  });
}
