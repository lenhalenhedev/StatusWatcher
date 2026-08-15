import { SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { parseBotInput, formatTargetLabel } from '../handlers/botInput.js';
import { listMonitoredBots } from '../store/botTargetStore.js';
import { addBotToMonitor } from '../monitors/botMonitor.js';

export const data = new SlashCommandBuilder()
  .setName('add-bot')
  .setDescription('Add one or more Discord bots to uptime monitoring (admin only)')
  .addStringOption((option) => option
    .setName('bot')
    .setDescription('Bot mention or ID; separate multiple bots with commas')
    .setMinLength(1)
    .setMaxLength(1_000)
    .setRequired(true));

function isAdmin(interaction) {
  return interaction.user.id === config.adminUserId;
}

function appendResult(lines, heading, entries) {
  if (entries.length === 0) return;
  lines.push(`**${heading}:** ${entries.join(', ')}`);
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', ephemeral: true });
    return;
  }

  const input = interaction.options.getString('bot', true);
  const parsed = parseBotInput(input);
  const trackedIds = new Set(listMonitoredBots().map((target) => target.id));
  const added = [];
  const alreadyTracked = [];
  const notBots = [];
  const notFound = [];

  for (const id of parsed.validIds) {
    let member;
    try {
      member = await interaction.guild.members.fetch(id);
    } catch {
      notFound.push(id);
      continue;
    }

    if (!member.user.bot) {
      notBots.push(`${formatTargetLabel(member)} (${id})`);
      continue;
    }
    if (trackedIds.has(id)) {
      alreadyTracked.push(id);
      continue;
    }

    addBotToMonitor(member, { reactivateArchived: true });
    trackedIds.add(id);
    added.push(`${formatTargetLabel(member)} (${id})`);
  }

  const lines = ['Bot monitoring update'];
  appendResult(lines, 'Added', added);
  appendResult(lines, 'Already tracked', alreadyTracked);
  appendResult(lines, 'Not Discord bots', notBots);
  appendResult(lines, 'Not found in this guild', notFound);
  appendResult(lines, 'Invalid IDs', parsed.invalidTokens);
  appendResult(lines, 'Duplicate input', parsed.duplicateTokens);

  if (lines.length === 1) lines.push('No changes were made.');
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}
