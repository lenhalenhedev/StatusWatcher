import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import config from '../config.js';
import { RUNTIME_CONFIG_DEFINITIONS } from '../config/runtimeConfigSchema.js';

export const CONFIG_PAGE_SIZE = 23;
export const CONFIG_NAV_PAGE_SIZE = 20;

export const CONFIG_ITEMS = Object.freeze([
  { id: 'add_mc', label: 'Add MC', description: 'Add a Minecraft server by name and host:port.' },
  { id: 'remove_mc', label: 'Remove MC', description: 'Open a dropdown to remove a saved Minecraft server.' },
  { id: 'add_website', label: 'Add Website', description: 'Monitor a public HTTP or HTTPS website by its response status.' },
  { id: 'remove_website', label: 'Remove Website', description: 'Open a dropdown to remove a monitored website.' },
  { id: 'add_database', label: 'Add Database', description: 'Add PostgreSQL, MySQL/MariaDB, Redis, or MongoDB with a connection string.' },
  { id: 'remove_database', label: 'Remove Database', description: 'Open a dropdown to remove a monitored database.' },
  ...Object.entries(RUNTIME_CONFIG_DEFINITIONS).map(([id, definition]) => ({
    id,
    label: definition.label,
    description: definition.description,
  })),
]);

function displayValue(id) {
  if (id === 'add_mc' || id === 'remove_mc') return `${config.mcServers.length} server(s)`;
  if (id === 'add_website' || id === 'remove_website') return `${config.websiteTargets.length} website(s)`;
  if (id === 'add_database' || id === 'remove_database') return `${config.databaseTargets.length} database(s)`;
  if (id === 'checkIntervalSec') return `${config.checkInterval / 1_000}s`;
  if (id === 'confirmDownThresholdSec') return `${config.confirmDownThresholdMs / 1_000}s`;
  if (id === 'checkIntervalDisplayLogSec') return `${config.checkIntervalDisplayLogSec}s`;
  if (id === 'stillDownBackoffSec') return config.stillDownBackoffStepsMs.map((value) => value / 1_000).join(', ');
  if (id === 'mcStatusTimeoutMs') return `${config.mcStatusTimeoutMs}ms`;
  if (id === 'dailyDigestCron') return config.dailyDigestCron;
  return config[id] || 'Not set';
}

export function buildConfigEmbed(page = 0) {
  // Discord allows at most five action rows. A navigation row consumes one,
  // leaving four rows × five buttons when pagination is required.
  const pageSize = CONFIG_ITEMS.length > CONFIG_PAGE_SIZE ? CONFIG_NAV_PAGE_SIZE : CONFIG_PAGE_SIZE;
  const maxPage = Math.max(0, Math.ceil(CONFIG_ITEMS.length / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const pageItems = CONFIG_ITEMS.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const embed = new EmbedBuilder()
    .setTitle('Runtime Configuration')
    .setColor(0x5865f2)
    .setDescription(
      'The values below are stored in SQLite and applied immediately after saving. '
      + 'Add/Remove MC manages Minecraft servers; the other settings control monitoring, alerts, digests, and uptime-embed ordering.',
    )
    .setFooter({ text: `Config page ${safePage + 1}/${maxPage + 1} • SQLite-backed` });

  for (const item of pageItems) {
    embed.addFields({
      name: `${item.label} — ${displayValue(item.id)}`,
      value: item.description,
      inline: false,
    });
  }

  const components = [];
  if (maxPage > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`config:page:${safePage - 1}`)
        .setLabel('PREV')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`config:page:${safePage + 1}`)
        .setLabel('NEXT')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === maxPage),
    ));
  }

  for (let i = 0; i < pageItems.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(
      pageItems.slice(i, i + 5).map((item) => new ButtonBuilder()
        .setCustomId(`config:open:${item.id}`)
        .setLabel(item.label)
        .setStyle(['remove_mc', 'remove_website', 'remove_database'].includes(item.id) ? ButtonStyle.Danger : ButtonStyle.Primary)),
    ));
  }

  return { embed, components, page: safePage, maxPage };
}

export function buildRemoveWebsiteComponents(targets, page = 0) {
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(targets.length / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const options = targets.slice(safePage * pageSize, (safePage + 1) * pageSize).map((target) => {
    let description = target.url;
    try {
      const url = new URL(target.url);
      description = `${url.origin}${url.pathname}`;
    } catch {
      description = 'Configured website';
    }
    return {
      label: target.name.slice(0, 100),
      description: description.slice(0, 100),
      value: target.id,
    };
  });
  const rows = [];
  if (maxPage > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`config:remove_website_page:${safePage - 1}`).setLabel('PREV').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
      new ButtonBuilder().setCustomId(`config:remove_website_page:${safePage + 1}`).setLabel('NEXT').setStyle(ButtonStyle.Secondary).setDisabled(safePage === maxPage),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`config:remove_website:select:${safePage}`)
      .setPlaceholder(`Select a website to remove (${safePage + 1}/${maxPage + 1})`)
      .addOptions(options),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

export function buildRemoveDatabaseComponents(targets, page = 0) {
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(targets.length / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const options = targets.slice(safePage * pageSize, (safePage + 1) * pageSize).map((target) => ({
    label: target.name.slice(0, 100),
    description: `${target.engine} • SSL ${target.sslEnabled ? 'on' : 'off'}`.slice(0, 100),
    value: target.id,
  }));
  const rows = [];
  if (maxPage > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`config:remove_database_page:${safePage - 1}`).setLabel('PREV').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
      new ButtonBuilder().setCustomId(`config:remove_database_page:${safePage + 1}`).setLabel('NEXT').setStyle(ButtonStyle.Secondary).setDisabled(safePage === maxPage),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`config:remove_database:select:${safePage}`)
      .setPlaceholder(`Select a database to remove (${safePage + 1}/${maxPage + 1})`)
      .addOptions(options),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

export function buildRemoveMinecraftComponents(servers, page = 0) {
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(servers.length / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const options = servers.slice(safePage * pageSize, (safePage + 1) * pageSize).map((server) => ({
    label: server.name.slice(0, 100),
    description: `${server.host}:${server.port}`.slice(0, 100),
    value: server.id,
  }));
  const rows = [];
  if (maxPage > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`config:remove_mc_page:${safePage - 1}`)
        .setLabel('PREV')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`config:remove_mc_page:${safePage + 1}`)
        .setLabel('NEXT')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === maxPage),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`config:remove_mc:select:${safePage}`)
      .setPlaceholder(`Select a Minecraft server to remove (${safePage + 1}/${maxPage + 1})`)
      .addOptions(options),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

