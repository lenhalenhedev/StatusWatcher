import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import config from '../config.js';
import { fetchBotsInBatches } from '../services/botFetchService.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcState } from '../monitors/mcMonitor.js';
import { getDatabaseStates } from '../monitors/databaseMonitor.js';
import { refreshStatusMessage } from '../services/statusMessage.js';

export const data = new SlashCommandBuilder()
  .setName('fetch-bot')
  .setDescription('Fetch and reconcile Discord bots in batches of 10 (admin only)');

let fetchInFlight = null;

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (fetchInFlight) {
    await interaction.reply({ content: 'A bot fetch is already running. Please wait for it to finish.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  fetchInFlight = (async () => {
    let latestCount = 0;
    const result = await fetchBotsInBatches(interaction.guild, {
      onProgress: async count => {
        latestCount = count;
        await interaction.editReply({ content: `fetched: ${count} bot` });
      },
    });

    await refreshStatusMessage(interaction.client, {
      channelId: config.monitorChannelId,
      getBotStates,
      getMcState,
      getDatabaseStates,
    });

    latestCount = result.fetchedBots;
    return result;
  })();

  try {
    const result = await fetchInFlight;
    await interaction.editReply({
      content: `✅ Fetch complete — fetched: ${result.fetchedBots} bot. Monitoring: ${result.monitoredBots} bot.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: '❌ Bot fetch failed. Check the bot logs for details.',
    }).catch(() => {});
    throw err;
  } finally {
    fetchInFlight = null;
  }
}
