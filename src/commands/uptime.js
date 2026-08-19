import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { resolveTarget, buildTargetChoices } from './targetUtils.js';
import {
  getDailyUptime,
  getWeeklyUptime,
  getMonthlyUptime,
  getYearlyUptime,
} from '../utils/uptimeTracker.js';

export const data = new SlashCommandBuilder()
  .setName('uptime')
  .setDescription('Show daily / weekly / monthly / yearly uptime for a target')
  .addStringOption((o) =>
    o
      .setName('target')
      .setDescription('Target name or id')
      .setRequired(true)
      .setAutocomplete(true),
  );

/** @param {import('discord.js').AutocompleteInteraction} interaction */
export async function autocomplete(interaction) {
  await interaction.respond(buildTargetChoices(interaction.options.getFocused()));
}

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  const query = interaction.options.getString('target', true);
  const target = resolveTarget(query);

  if (!target) {
    await interaction.reply({ content: `No target found matching "${query}".`, flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📈 Uptime — ${target.name}`)
    .setColor(0x5865F2)
    .addFields(
      { name: '24h', value: `\`${getDailyUptime(target.id)}%\``, inline: true },
      { name: '7d', value: `\`${getWeeklyUptime(target.id)}%\``, inline: true },
      { name: '30d', value: `\`${getMonthlyUptime(target.id)}%\``, inline: true },
      { name: '1y', value: `\`${getYearlyUptime(target.id)}%\``, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
