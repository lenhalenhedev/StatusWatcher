import { SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { resolveTarget, buildTargetChoices } from './targetUtils.js';
import { muteTarget } from '../store/muteStore.js';
import { parseDuration, formatDuration } from '../utils/duration.js';
import { getTimestampUTC7 } from '../utils/timeUtils.js';

export const data = new SlashCommandBuilder()
  .setName('mute')
  .setDescription('Temporarily silence alerts for a target during maintenance (admin only)')
  .addStringOption((o) =>
    o
      .setName('target')
      .setDescription('Target name or id')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o
      .setName('duration')
      .setDescription('How long to mute, e.g. 30m, 2h, 1d')
      .setRequired(true),
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
  const durationRaw = interaction.options.getString('duration', true);

  const target = resolveTarget(query);
  if (!target) {
    await interaction.reply({ content: `No target found matching "${query}".`, ephemeral: true });
    return;
  }

  const durationMs = parseDuration(durationRaw);
  if (durationMs === null) {
    await interaction.reply({
      content: `Invalid duration "${durationRaw}". Use formats like \`30m\`, \`2h\`, or \`1d\`.`,
      ephemeral: true,
    });
    return;
  }

  const until = Date.now() + durationMs;
  if (!muteTarget(target.id, until)) {
    await interaction.reply({ content: 'Failed to mute the target. Please try again.', ephemeral: true });
    return;
  }

  await interaction.reply({
    content:
      `🔇 Muted **${target.name}** for **${formatDuration(durationMs)}** ` +
      `(until ${getTimestampUTC7(new Date(until))} UTC+7).`,
  });
}
