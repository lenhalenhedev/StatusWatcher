import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export const HELP_PAGE_SIZE = 8;
export const HELP_COMPONENT_PREFIX = 'help';
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_DESCRIPTION_LENGTH = 400;

function clampPage(page, totalPages) {
  const normalizedPage = Number.isInteger(page) ? page : 0;
  return Math.min(Math.max(normalizedPage, 0), Math.max(totalPages - 1, 0));
}

function trimText(value, maxLength) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatOption(option) {
  const name = trimText(option?.name, 32) || 'option';
  const requirement = option?.required ? 'required' : 'optional';
  const description = trimText(option?.description, 180) || 'No additional description.';
  return `\`${name}\` (${requirement}) — ${description}`;
}

function formatOptions(options = []) {
  const directOptions = options.filter((option) => option?.type !== 1 && option?.type !== 2);
  const subcommands = options.filter((option) => option?.type === 1 || option?.type === 2);
  const lines = [];
  if (directOptions.length > 0) lines.push(`Parameters: ${directOptions.map(formatOption).join('; ')}`);
  if (subcommands.length > 0) {
    lines.push(`Subcommands: ${subcommands.map((option) => `\`${trimText(option.name, 32)}\` — ${trimText(option.description, 180) || 'No description.'}`).join('; ')}`);
    for (const subcommand of subcommands) {
      const nestedOptions = subcommand.options ?? [];
      if (nestedOptions.length > 0) {
        lines.push(`${trimText(subcommand.name, 32)} parameters: ${nestedOptions.map(formatOption).join('; ')}`);
      }
    }
  }
  return lines;
}

export function buildHelpEntries(commandModules = []) {
  return commandModules
    .map((module) => module?.data?.toJSON?.() ?? module?.data)
    .filter((command) => command?.name && command?.description)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((command) => {
      const options = command.options ?? [];
      const usageSuffix = options.length > 0 ? ` ${options.map((option) => option.type === 1 || option.type === 2 ? option.name : `<${option.name}>`).join(' ')}` : '';
      const lines = [
        trimText(command.description, MAX_DESCRIPTION_LENGTH),
        `Usage: \`/${trimText(command.name, 32)}${usageSuffix}\``,
        ...formatOptions(options),
      ];
      return {
        name: `/${trimText(command.name, 32)}`,
        value: trimText(lines.join('\n'), MAX_FIELD_VALUE_LENGTH),
      };
    });
}

export function getHelpPage(entries = [], page = 0) {
  const totalPages = Math.max(1, Math.ceil(entries.length / HELP_PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const start = currentPage * HELP_PAGE_SIZE;
  return {
    currentPage,
    totalPages,
    entries: entries.slice(start, start + HELP_PAGE_SIZE),
  };
}

export function buildHelpComponents(page, totalPages) {
  const currentPage = clampPage(page, totalPages);
  const previousButton = new ButtonBuilder()
    .setCustomId(`${HELP_COMPONENT_PREFIX}:prev:${currentPage}`)
    .setLabel('Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage === 0);
  const pageIndicator = new ButtonBuilder()
    .setCustomId(`${HELP_COMPONENT_PREFIX}:page:${currentPage}`)
    .setLabel(`${currentPage + 1}/${totalPages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  const nextButton = new ButtonBuilder()
    .setCustomId(`${HELP_COMPONENT_PREFIX}:next:${currentPage}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage === totalPages - 1);
  return [new ActionRowBuilder().addComponents(previousButton, pageIndicator, nextButton)];
}

export function parseHelpComponentId(customId) {
  const match = new RegExp(`^${HELP_COMPONENT_PREFIX}:(prev|page|next):(\\d+)$`).exec(customId);
  if (!match) return null;
  return { action: match[1], page: Number(match[2]) };
}
