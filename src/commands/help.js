import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  buildHelpComponents,
  buildHelpEntries,
  getHelpPage,
  parseHelpComponentId,
} from '../handlers/helpPagination.js';
let registeredCommandModules = [];

export function setCommandModules(commandModules) {
  registeredCommandModules = Array.isArray(commandModules) ? commandModules : [];
}

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all commands, parameters, and usage instructions.');

function getModules(dependencies = {}) {
  return dependencies.commandModules ?? registeredCommandModules;
}

function buildHelpPayload(commandModules, page) {
  const entries = buildHelpEntries(commandModules);
  const pageData = getHelpPage(entries, page);
  const embed = new EmbedBuilder()
    .setTitle('StatusWatcher Help')
    .setDescription('All commands are listed below. Use the shown usage pattern and required parameters. Optional parameters are marked explicitly.')
    .addFields(pageData.entries)
    .setFooter({ text: `Page ${pageData.currentPage + 1} of ${pageData.totalPages} • Use /help again to reopen this guide.` });
  return {
    embeds: [embed],
    components: buildHelpComponents(pageData.currentPage, pageData.totalPages),
  };
}

export async function execute(interaction, dependencies = {}) {
  await interaction.reply(buildHelpPayload(getModules(dependencies), 0));
}

export function handlesInteraction(interaction) {
  return typeof interaction?.customId === 'string' && interaction.customId.startsWith('help:');
}

export async function handleInteraction(interaction, dependencies = {}) {
  const parsed = parseHelpComponentId(interaction?.customId);
  if (!parsed || parsed.action === 'page') {
    await interaction.reply({
      content: 'This help page is invalid or expired. Run /help again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const nextPage = parsed.action === 'next' ? parsed.page + 1 : parsed.page - 1;
  await interaction.update(buildHelpPayload(getModules(dependencies), nextPage));
}
