import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export const STATUS_PAGE_SIZE = 10;
export const STATUS_COMPONENT_PREFIX = 'status-page';

export function getStatusPageCount(botStates) {
  const botCount = botStates?.size ?? 0;
  return Math.max(1, Math.ceil(botCount / STATUS_PAGE_SIZE));
}

export function clampStatusPage(page, totalPages) {
  const normalizedPage = Number.isInteger(page) ? page : 0;
  return Math.min(Math.max(normalizedPage, 0), Math.max(totalPages - 1, 0));
}

export function getStatusPage(botStates, page) {
  const bots = [...(botStates?.entries?.() ?? [])];
  const totalPages = getStatusPageCount(botStates);
  const currentPage = clampStatusPage(page, totalPages);
  const start = currentPage * STATUS_PAGE_SIZE;
  return {
    currentPage,
    totalPages,
    bots: bots.slice(start, start + STATUS_PAGE_SIZE),
  };
}

export function buildStatusComponents(page, totalPages) {
  const currentPage = clampStatusPage(page, totalPages);
  const previousButton = new ButtonBuilder()
    .setCustomId(`${STATUS_COMPONENT_PREFIX}:prev:${currentPage}`)
    .setLabel('Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage === 0);
  const pageIndicator = new ButtonBuilder()
    .setCustomId(`${STATUS_COMPONENT_PREFIX}:page:${currentPage}`)
    .setLabel(`${currentPage + 1}/${totalPages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  const nextButton = new ButtonBuilder()
    .setCustomId(`${STATUS_COMPONENT_PREFIX}:next:${currentPage}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage === totalPages - 1);

  return [new ActionRowBuilder().addComponents(previousButton, pageIndicator, nextButton)];
}

export function parseStatusComponentId(customId) {
  const match = new RegExp(`^${STATUS_COMPONENT_PREFIX}:(prev|page|next):(\\d+)$`).exec(customId);
  if (!match) return null;
  return { action: match[1], page: Number(match[2]) };
}
