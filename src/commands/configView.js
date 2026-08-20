import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import config from '../config.js';
import { RUNTIME_CONFIG_DEFINITIONS } from '../config/runtimeConfigSchema.js';
import { listMaintenanceWindows } from '../store/maintenanceStore.js';

export const CONFIG_PAGE_SIZE = 23;
export const CONFIG_NAV_PAGE_SIZE = 20;

const SERVICE_OPTIONS = Object.freeze([
  { label: 'MC', value: 'mc', description: 'Add or remove a Minecraft server.' },
  { label: 'Website', value: 'website', description: 'Add or remove an HTTP or HTTPS website.' },
  { label: 'Database', value: 'database', description: 'Add or remove a monitored database.' },
]);

export const CONFIG_ITEMS = Object.freeze([
  { id: 'add_service', label: 'Add Service', description: 'Choose MC, Website, or Database to add a monitored service.' },
  { id: 'remove_service', label: 'Remove Service', description: 'Choose MC, Website, or Database to remove a monitored service.' },
  { id: 'config', label: 'Config', description: 'Choose one runtime setting to validate, save to SQLite, and apply immediately.' },
  { id: 'add_maintenance', label: 'Add Maintenance', description: 'Schedule an alert-suppression window for a monitored service.' },
  { id: 'remove_maintenance', label: 'Remove Maintenance', description: 'Cancel a scheduled or active maintenance window.' },
]);

const RUNTIME_CONFIG_OPTIONS = Object.freeze(Object.entries(RUNTIME_CONFIG_DEFINITIONS).map(([id, definition]) => ({
  label: definition.label,
  value: id,
  description: definition.description,
}))); 

function displayValue(id) {
  if (id === 'add_service') return `${config.mcServers.length + config.websiteTargets.length + config.databaseTargets.length} service(s) available`;
  if (id === 'remove_service') return `${config.mcServers.length + config.websiteTargets.length + config.databaseTargets.length} service(s) configured`;
  if (id === 'config') return `${RUNTIME_CONFIG_OPTIONS.length} runtime setting(s)`;
  if (id === 'add_maintenance') return 'Schedule a service window';
  if (id === 'remove_maintenance') return `${listMaintenanceWindows().length} active or future window(s)`;
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
  // leaving four rows by five buttons when pagination is required.
  const pageSize = CONFIG_ITEMS.length > CONFIG_PAGE_SIZE ? CONFIG_NAV_PAGE_SIZE : CONFIG_PAGE_SIZE;
  const maxPage = Math.max(0, Math.ceil(CONFIG_ITEMS.length / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const pageItems = CONFIG_ITEMS.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const embed = new EmbedBuilder()
    .setTitle('Runtime Configuration')
    .setColor(0x5865f2)
    .setDescription(
      'The values below are stored in SQLite and applied immediately after saving. '
      + 'Add Service and Remove Service manage MC, Website, and Database targets; Config manages validated runtime settings.',
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
        .setStyle(item.id === 'remove_service' ? ButtonStyle.Danger : ButtonStyle.Primary)),
    ));
  }

  return { embed, components, page: safePage, maxPage };
}

export function buildServiceTypeComponents(action) {
  if (!['add_service', 'remove_service'].includes(action)) throw new Error('Unsupported service action.');
  const label = action === 'add_service' ? 'add' : 'remove';
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`config:${action}:select`)
        .setPlaceholder(`Select a service type to ${label}.`)
        .addOptions(SERVICE_OPTIONS),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildMaintenanceTargetComponents(targets) {
  const options = targets.slice(0, 25).map((target) => ({
    label: String(target.name).slice(0, 100),
    description: `${target.type} service`.slice(0, 100),
    value: String(target.id),
  }));
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('config:add_maintenance:select')
        .setPlaceholder('Select a monitored service.')
        .addOptions(options),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildMaintenanceWindowComponents(windows, page = 0) {
  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(windows.length / pageSize) - 1);
  const safePage = Math.min(Math.max(Number(page) || 0, 0), maxPage);
  const options = windows.slice(safePage * pageSize, (safePage + 1) * pageSize).map((window) => ({
    label: `${window.service_type} maintenance #${window.id}`.slice(0, 100),
    description: `Starts ${new Date(window.starts_at).toISOString()}`.slice(0, 100),
    value: String(window.id),
  }));
  const rows = [];
  if (maxPage > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`config:remove_maintenance_page:${safePage - 1}`).setLabel('PREV').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
      new ButtonBuilder().setCustomId(`config:remove_maintenance_page:${safePage + 1}`).setLabel('NEXT').setStyle(ButtonStyle.Secondary).setDisabled(safePage === maxPage),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`config:remove_maintenance:select:${safePage}`)
      .setPlaceholder(`Select a maintenance window (${safePage + 1}/${maxPage + 1})`)
      .addOptions(options),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

export function buildRuntimeConfigComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('config:runtime:select')
        .setPlaceholder('Select a runtime setting to configure.')
        .addOptions(RUNTIME_CONFIG_OPTIONS),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
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

