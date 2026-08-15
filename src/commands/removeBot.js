import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import config from '../config.js';
import { archiveMonitoredBots, listMonitoredBots } from '../store/botTargetStore.js';
import { removeBotFromMonitor } from '../monitors/botMonitor.js';

const SELECT_PREFIX = 'remove-bot:';
const PAGE_PREFIX = 'remove-bot-page:';
const MAX_MENU_OPTIONS = 25;

export const data = new SlashCommandBuilder()
  .setName('remove-bot')
  .setDescription('Remove monitored Discord bots from uptime tracking (admin only)');

function isAdmin(interaction) {
  return interaction.user.id === config.adminUserId;
}

function truncate(value, maxLength) {
  return String(value).slice(0, maxLength);
}

function pageCount(targets) {
  return Math.max(1, Math.ceil(targets.length / MAX_MENU_OPTIONS));
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
}

export function buildRemoveBotMenu(targets, userId, page = 0) {
  const options = targets.slice(0, MAX_MENU_OPTIONS).map((target) => ({
    label: truncate(target.name || target.id, 100),
    description: truncate(`ID: ${target.id}`, 100),
    value: target.id,
  }));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${SELECT_PREFIX}${userId}:${page}`)
    .setPlaceholder('Select monitored bots to remove')
    .setMinValues(1)
    .setMaxValues(Math.max(1, options.length))
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

export function buildRemoveBotComponents(targets, userId, page = 0) {
  const totalPages = pageCount(targets);
  const currentPage = clampPage(page, totalPages);
  const pageTargets = targets.slice(
    currentPage * MAX_MENU_OPTIONS,
    (currentPage + 1) * MAX_MENU_OPTIONS,
  );
  const components = [buildRemoveBotMenu(pageTargets, userId, currentPage)];

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PAGE_PREFIX}${userId}:${currentPage - 1}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${PAGE_PREFIX}${userId}:${currentPage + 1}`)
        .setLabel(`Page ${currentPage + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${PAGE_PREFIX}${userId}:${currentPage + 1}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages - 1),
    ));
  }

  return components;
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', ephemeral: true });
    return;
  }

  const targets = listMonitoredBots();
  if (targets.length === 0) {
    await interaction.reply({ content: 'No monitored Discord bots are currently stored.', ephemeral: true });
    return;
  }

  await interaction.reply({
    content: `Select one or more monitored bots to remove (page 1/${pageCount(targets)}). Their uptime history will be preserved.`,
    components: buildRemoveBotComponents(targets, interaction.user.id),
    ephemeral: true,
  });
}

export function handlesInteraction(interaction) {
  return interaction.isStringSelectMenu?.()
    ? interaction.customId.startsWith(SELECT_PREFIX)
    : interaction.isButton?.() && interaction.customId.startsWith(PAGE_PREFIX);
}

export async function handleInteraction(interaction) {
  const [prefix, ownerId, pageValue] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId || interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the command owner can use this removal menu.', ephemeral: true });
    return;
  }

  const targets = listMonitoredBots();
  if (prefix === 'remove-bot-page') {
    const page = clampPage(pageValue, pageCount(targets));
    await interaction.update({
      content: `Select one or more monitored bots to remove (page ${page + 1}/${pageCount(targets)}). Their uptime history will be preserved.`,
      components: buildRemoveBotComponents(targets, ownerId, page),
    });
    return;
  }

  const trackedIds = new Set(targets.map((target) => target.id));
  const selectedIds = interaction.values.filter((id) => trackedIds.has(id));
  if (selectedIds.length === 0) {
    await interaction.update({ content: 'Those bots are no longer monitored.', components: [] });
    return;
  }

  const targetNames = new Map(targets.map((target) => [target.id, target.name]));
  archiveMonitoredBots(selectedIds);
  for (const id of selectedIds) removeBotFromMonitor(id);

  const removedNames = selectedIds.map((id) => targetNames.get(id) || id);
  await interaction.update({
    content: `Removed ${removedNames.map((name) => `**${name}**`).join(', ')} from monitoring. Uptime history was preserved.`,
    components: [],
  });
}

