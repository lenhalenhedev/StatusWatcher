import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { resolveTarget, buildTargetChoices } from './targetUtils.js';
import { getRecentSessions } from '../utils/uptimeTracker.js';
import { getTimestampUTC7 } from '../utils/timeUtils.js';
import { formatDuration } from '../utils/duration.js';

const MAX_SESSIONS = 10;

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Show the most recent downtime sessions for a target')
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

  const sessions = getRecentSessions(target.id, MAX_SESSIONS);
  if (sessions.length === 0) {
    await interaction.reply({
      content: `No downtime has been recorded for **${target.name}** yet. 🎉`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = sessions.map((s) => {
    const start = getTimestampUTC7(new Date(s.down_start));
    if (s.up_end) {
      const duration = formatDuration(s.up_end - s.down_start);
      return `🔻 ${start} → back up after **${duration}**`;
    }
    const ongoing = formatDuration(Date.now() - s.down_start);
    return `🔴 ${start} → **ongoing** (${ongoing} so far)`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🕒 Downtime History — ${target.name}`)
    .setColor(0xED4245)
    .setDescription(lines.join('\n').substring(0, 4096))
    .setFooter({ text: `Showing the latest ${sessions.length} session(s) · UTC+7` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
