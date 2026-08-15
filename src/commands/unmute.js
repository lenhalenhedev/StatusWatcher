import { SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { resolveTarget, buildTargetChoices } from './targetUtils.js';
import { unmuteTarget } from '../store/muteStore.js';

export const data = new SlashCommandBuilder()
  .setName('unmute')
  .setDescription('Re-enable alerts for a previously muted target (admin only)')
  .addStringOption((o) =>
    o
      .setName('target')
      .setDescription('Bot or Minecraft server (name or id)')
      .setRequired(true)
      .setAutocomplete(true),
  );

/** @param {import('discord.js').AutocompleteInteraction} interaction */
export async function autocomplete(interaction) {
  await interaction.respond(buildTargetChoices(interaction.options.getFocused()));
}

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', ephemeral: true });
    return;
  }

  const query = interaction.options.getString('target', true);
  const target = resolveTarget(query);
  if (!target) {
    await interaction.reply({ content: `No target found matching "${query}".`, ephemeral: true });
    return;
  }

  const wasMuted = unmuteTarget(target.id);
  await interaction.reply({
    content: wasMuted
      ? `🔊 Unmuted **${target.name}**. Alerts are active again.`
      : `**${target.name}** was not muted.`,
  });
}
