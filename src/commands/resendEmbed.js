import { SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcState } from '../monitors/mcMonitor.js';
import { refreshStatusMessage, resetStatusPage } from '../services/statusMessage.js';

export const data = new SlashCommandBuilder()
  .setName('resend-embed')
  .setDescription('Replace the tracked status embed in the monitor channel (admin only)');

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({
      content: 'Only the configured admin can use this command.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  resetStatusPage();
  const message = await refreshStatusMessage(interaction.client, {
    channelId: config.monitorChannelId,
    getBotStates,
    getMcState,
    forceNew: true,
  });

  await interaction.editReply({
    content: message
      ? `Status embed resent as message ${message.id}.`
      : 'Unable to access the monitor channel.',
  });
}
