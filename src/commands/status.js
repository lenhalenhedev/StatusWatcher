import { SlashCommandBuilder } from 'discord.js';
import { getStatusMessagePayload } from '../services/statusMessage.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcState } from '../monitors/mcMonitor.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show the current status of all monitored bots and the Minecraft server');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();
  await interaction.editReply({
    ...getStatusMessagePayload(getBotStates(), getMcState()),
  });
}
