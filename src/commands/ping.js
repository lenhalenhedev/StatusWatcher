import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check bot response and Discord API latency.');

function formatLatency(value) {
  return Number.isFinite(value) && value >= 0 ? `${Math.round(value)}ms` : 'N/A';
}

export async function execute(interaction) {
  const createdTimestamp = Number(interaction.createdTimestamp);
  const localLatency = Number.isFinite(createdTimestamp)
    ? Math.max(0, Date.now() - createdTimestamp)
    : Number.NaN;
  const apiLatency = interaction.client?.ws?.ping;
  await interaction.reply({
    content: `Pong!\nLatency:    ${formatLatency(localLatency)}\nAPI Latency:    ${formatLatency(apiLatency)}`,
  });
}
