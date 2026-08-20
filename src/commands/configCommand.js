import { randomUUID } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import runtimeConfig, { reloadRuntimeConfig, serializeRuntimeConfigValue } from '../config.js';
import { parseMinecraftAddress, RUNTIME_CONFIG_DEFINITIONS } from '../config/runtimeConfigSchema.js';
import { normalizeWebsiteUrl } from '../services/websiteStatusClient.js';
import { parseDatabaseConnectionString, parseDatabaseName, parseDatabaseSsl, DATABASE_CERTIFICATE_EXPIRY_MS, DATABASE_MAX_CERTIFICATE_BYTES } from '../config/databaseSchema.js';
import {
  deleteMinecraftServer,
  listMinecraftServers,
  saveMinecraftServer,
  setRuntimeConfigValue,
  deleteWebsiteTarget,
  listWebsiteTargets,
  saveWebsiteTarget,
} from '../store/runtimeConfigStore.js';
import {
  createCertificateRequest,
  deleteCertificateRequest,
  consumeCertificateRequest,
  deleteDatabaseTarget,
  getActiveCertificateRequest,
  listDatabaseTargets,
  saveDatabaseTarget,
  updateDatabaseCertificate,
} from '../store/databaseStore.js';
import { deleteTarget, registerTarget } from '../utils/uptimeTracker.js';
import { refreshStatusMessage } from '../services/statusMessage.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcStates, removeMcState } from '../monitors/mcMonitor.js';
import { getDatabaseStates, initDatabaseMonitor, removeDatabaseState } from '../monitors/databaseMonitor.js';
import { getWebsiteStates, initWebsiteMonitor, removeWebsiteState } from '../monitors/websiteMonitor.js';
import { cancelWindow, listMaintenanceWindows, scheduleWindow } from '../services/maintenanceService.js';
import { recordAudit } from '../store/auditStore.js';
import {
  buildConfigEmbed,
  buildRemoveMinecraftComponents,
  buildRemoveWebsiteComponents,
  buildRemoveDatabaseComponents,
  buildServiceTypeComponents,
  buildRuntimeConfigComponents,
  buildMaintenanceTargetComponents,
  buildMaintenanceWindowComponents,
} from './configView.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Manage uptime monitoring configuration stored in SQLite.');

function isAdmin(interaction) {
  return interaction.user?.id === runtimeConfig.adminUserId;
}

function scalarValue(key) {
  if (key === 'checkIntervalSec') return String(runtimeConfig.checkInterval / 1_000);
  if (key === 'confirmDownThresholdSec') return String(runtimeConfig.confirmDownThresholdMs / 1_000);
  if (key === 'checkIntervalDisplayLogSec') return String(runtimeConfig.checkIntervalDisplayLogSec);
  if (key === 'stillDownBackoffSec') return runtimeConfig.stillDownBackoffStepsMs.map((value) => value / 1_000).join(',');
  if (key === 'mcStatusTimeoutMs') return String(runtimeConfig.mcStatusTimeoutMs);
  if (key === 'dailyDigestCron') return runtimeConfig.dailyDigestCron;
  return runtimeConfig[key] || '';
}

function addMinecraftModal() {
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Your Server Name')
    .setPlaceholder('My Minecraft Server')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const address = new TextInputBuilder()
    .setCustomId('address')
    .setLabel('IP:PORT')
    .setPlaceholder('domain.com:25565')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(253);

  return new ModalBuilder()
    .setCustomId('config:modal:add_mc')
    .setTitle('Add Minecraft Server')
    .addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(address));
}

function addWebsiteModal() {
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Website Name')
    .setPlaceholder('Public status page')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const url = new TextInputBuilder()
    .setCustomId('url')
    .setLabel('HTTP or HTTPS URL')
    .setPlaceholder('https://example.com/health')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2_048);

  return new ModalBuilder()
    .setCustomId('config:modal:add_website')
    .setTitle('Add Website')
    .addComponents(new ActionRowBuilder().addComponents(name), new ActionRowBuilder().addComponents(url));
}

function addDatabaseModal() {
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Database Name')
    .setPlaceholder('Production PostgreSQL')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const connectString = new TextInputBuilder()
    .setCustomId('connect_string')
    .setLabel('Connect String')
    .setPlaceholder('postgres://user:password@host:5432/db')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4_000);
  const ssl = new TextInputBuilder()
    .setCustomId('ssl')
    .setLabel('SSL true/false (optional)')
    .setPlaceholder('true')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5);

  return new ModalBuilder()
    .setCustomId('config:modal:add_database')
    .setTitle('Add Database')
    .addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(connectString),
      new ActionRowBuilder().addComponents(ssl),
    );
}

function maintenanceTargets() {
  const botTargets = [...getBotStates().entries()].map(([id, state]) => ({ id, name: state.name, type: 'bot' }));
  return [
    ...botTargets,
    ...listMinecraftServers().map((target) => ({ id: target.id, name: target.name, type: 'minecraft' })),
    ...listWebsiteTargets().map((target) => ({ id: target.id, name: target.name, type: 'website' })),
    ...listDatabaseTargets().map((target) => ({ id: target.id, name: target.name, type: 'database' })),
  ];
}

function maintenanceModal(target) {
  const startsAt = new TextInputBuilder()
    .setCustomId('starts_at')
    .setLabel('Start time (ISO 8601 UTC)')
    .setPlaceholder('2026-08-20T12:00:00Z')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40);
  const endsAt = new TextInputBuilder()
    .setCustomId('ends_at')
    .setLabel('End time (ISO 8601 UTC)')
    .setPlaceholder('2026-08-20T13:00:00Z')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40);
  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setPlaceholder('Planned database maintenance')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);
  return new ModalBuilder()
    .setCustomId(`config:modal:add_maintenance:${target.id}`)
    .setTitle(`Maintenance: ${target.name}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(startsAt),
      new ActionRowBuilder().addComponents(endsAt),
      new ActionRowBuilder().addComponents(reason),
    );
}

function parseMaintenanceTime(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) throw new Error('Maintenance timestamps must be ISO 8601 UTC values.');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Maintenance timestamp is invalid.');
  return parsed;
}

function scalarModal(key) {
  const definition = RUNTIME_CONFIG_DEFINITIONS[key];
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(definition.label.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(4000);
  const currentValue = scalarValue(key);
  if (currentValue) input.setValue(currentValue.slice(0, 4000));

  return new ModalBuilder()
    .setCustomId(`config:modal:${key}`)
    .setTitle(`Set ${definition.label}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function refreshAfterConfigChange(interaction) {
  reloadRuntimeConfig();
  initWebsiteMonitor();
  await refreshStatusMessage(interaction.client, {
    channelId: runtimeConfig.monitorChannelId,
    getBotStates,
    getMcStates,
    getDatabaseStates,
    getWebsiteStates,
  });
}

async function showConfig(interaction, page = 0) {
  const view = buildConfigEmbed(page);
  await interaction.editReply({ content: '', embeds: [view.embed], components: view.components });
}

async function requestOptionalCertificate(interaction, targetId, databaseName) {
  const request = createCertificateRequest({
    targetId,
    userId: interaction.user.id,
    expiresAt: Date.now() + DATABASE_CERTIFICATE_EXPIRY_MS,
  });
  try {
    await interaction.user.send({
      content: `Optional certificate upload for **${databaseName}**. Reply in this DM with one PEM/CRT/DER CA certificate file within 10 minutes. Do not upload a private key. The attachment will be deleted after processing.`,
    });
    return request.id;
  } catch {
    deleteCertificateRequest(request.id, interaction.user.id);
    return null;
  }
}

async function downloadCertificate(attachment) {
  if (!attachment || attachment.size > DATABASE_MAX_CERTIFICATE_BYTES) {
    throw new Error('Certificate file is missing or exceeds the 512 KB limit.');
  }
  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Certificate download failed.');
  const length = Number(response.headers.get('content-length') ?? attachment.size ?? 0);
  if (length > DATABASE_MAX_CERTIFICATE_BYTES) throw new Error('Certificate file exceeds the 512 KB limit.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > DATABASE_MAX_CERTIFICATE_BYTES) throw new Error('Certificate file is empty or too large.');
  if (buffer.includes(Buffer.from('PRIVATE KEY'))) throw new Error('Private keys are not accepted.');
  try {
    new X509Certificate(buffer);
  } catch {
    throw new Error('The uploaded file is not a valid X.509 certificate.');
  }
  return buffer.toString('base64');
}

/** Handle certificate attachments received in the administrator's DM. */
export async function handleCertificateMessage(message) {
  if (!message?.channel?.isDMBased?.() || message.author?.id !== runtimeConfig.adminUserId) return false;
  const request = getActiveCertificateRequest(message.author.id);
  if (!request) return false;
  const attachment = message.attachments?.first?.();
  try {
    const certificate = await downloadCertificate(attachment);
    const consumed = consumeCertificateRequest(request.id, message.author.id);
    if (!consumed) throw new Error('Certificate upload request expired.');
    updateDatabaseCertificate(consumed.target_id, certificate);
    await removeDatabaseState(consumed.target_id);
    reloadRuntimeConfig();
    initDatabaseMonitor();
    await refreshStatusMessage(message.client, {
      channelId: runtimeConfig.monitorChannelId,
      getBotStates,
      getMcStates,
      getDatabaseStates,
      getWebsiteStates,
    });
    initWebsiteMonitor();
    await message.reply('Certificate saved securely and database monitoring was refreshed.');
  } catch {
    await message.reply('Certificate was not saved. Check that it is a valid CA certificate under 512 KB and try again.');
  } finally {
    await message.delete().catch(() => undefined);
  }
  return true;
}

export function handlesInteraction(interaction) {
  return String(interaction.customId || '').startsWith('config:');
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured admin can use /config.', flags: MessageFlags.Ephemeral });
    return;
  }
  const view = buildConfigEmbed(0);
  await interaction.reply({ embeds: [view.embed], components: view.components, flags: MessageFlags.Ephemeral });
}

export async function handleInteraction(interaction) {
  if (!isAdmin(interaction)) {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: 'Only the configured admin can use /config.' });
    else await interaction.reply({ content: 'Only the configured admin can use /config.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isButton()) {
    const [, action, value] = String(interaction.customId).split(':');
    if (action === 'page') {
      const view = buildConfigEmbed(Number(value));
      await interaction.update({ content: '', embeds: [view.embed], components: view.components });
      return;
    }
    if (action === 'remove_mc_page') {
      await interaction.update({ content: 'Select the Minecraft server to remove.', components: buildRemoveMinecraftComponents(listMinecraftServers(), Number(value)) });
      return;
    }
    if (action === 'remove_database_page') {
      await interaction.update({ content: 'Select the database to remove.', components: buildRemoveDatabaseComponents(listDatabaseTargets(), Number(value)) });
      return;
    }
    if (action === 'remove_website_page') {
      await interaction.update({ content: 'Select the website to remove.', components: buildRemoveWebsiteComponents(listWebsiteTargets(), Number(value)) });
      return;
    }
    if (action === 'remove_maintenance_page') {
      await interaction.update({ content: 'Select the maintenance window to cancel.', components: buildMaintenanceWindowComponents(listMaintenanceWindows(), Number(value)) });
      return;
    }
    if (action === 'back') {
      await interaction.update({ content: '', embeds: [buildConfigEmbed(0).embed], components: buildConfigEmbed(0).components });
      return;
    }
    if (action !== 'open') return;
    if (value === 'add_service' || value === 'remove_service') {
      await interaction.update({
        content: value === 'add_service' ? 'Select the service type to add.' : 'Select the service type to remove.',
        components: buildServiceTypeComponents(value),
      });
      return;
    }
    if (value === 'config') {
      await interaction.update({
        content: 'Select the runtime setting to configure.',
        components: buildRuntimeConfigComponents(),
      });
      return;
    }
    if (value === 'add_maintenance') {
      const targets = maintenanceTargets();
      await interaction.update({
        content: targets.length ? 'Select a monitored service for the maintenance window.' : 'No monitored services are configured.',
        components: targets.length ? buildMaintenanceTargetComponents(targets) : buildConfigEmbed(0).components,
      });
      return;
    }
    if (value === 'remove_maintenance') {
      const windows = listMaintenanceWindows();
      await interaction.update({
        content: windows.length ? 'Select the maintenance window to cancel.' : 'No active or future maintenance windows exist.',
        components: windows.length ? buildMaintenanceWindowComponents(windows) : buildConfigEmbed(0).components,
      });
      return;
    }
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId) === 'config:add_service:select') {
    const service = interaction.values[0];
    if (service === 'mc') await interaction.showModal(addMinecraftModal());
    else if (service === 'website') await interaction.showModal(addWebsiteModal());
    else if (service === 'database') await interaction.showModal(addDatabaseModal());
    else await interaction.update({ content: 'Unsupported service type.', components: buildConfigEmbed(0).components });
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId) === 'config:remove_service:select') {
    const service = interaction.values[0];
    if (service === 'mc') {
      const servers = listMinecraftServers();
      await interaction.update({
        content: servers.length ? 'Select the Minecraft server to remove.' : 'No Minecraft servers are configured.',
        components: servers.length ? buildRemoveMinecraftComponents(servers) : buildConfigEmbed(0).components,
      });
    } else if (service === 'website') {
      const targets = listWebsiteTargets();
      await interaction.update({
        content: targets.length ? 'Select the website to remove.' : 'No websites are configured.',
        components: targets.length ? buildRemoveWebsiteComponents(targets) : buildConfigEmbed(0).components,
      });
    } else if (service === 'database') {
      const targets = listDatabaseTargets();
      await interaction.update({
        content: targets.length ? 'Select the database to remove.' : 'No databases are configured.',
        components: targets.length ? buildRemoveDatabaseComponents(targets) : buildConfigEmbed(0).components,
      });
    } else {
      await interaction.update({ content: 'Unsupported service type.', components: buildConfigEmbed(0).components });
    }
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId) === 'config:add_maintenance:select') {
    const target = maintenanceTargets().find((item) => item.id === interaction.values[0]);
    if (!target) {
      await interaction.update({ content: 'That monitored service no longer exists.', components: buildConfigEmbed(0).components });
      return;
    }
    await interaction.showModal(maintenanceModal(target));
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId).startsWith('config:remove_maintenance:select')) {
    await interaction.deferUpdate();
    const id = Number(interaction.values[0]);
    if (!Number.isInteger(id) || !cancelWindow(id)) {
      const view = buildConfigEmbed(0);
      await interaction.editReply({ content: 'That maintenance window no longer exists.', embeds: [view.embed], components: view.components });
      return;
    }
    recordAudit({ action: 'CANCEL_MAINTENANCE', actorId: interaction.user.id, targetType: 'maintenance', targetId: String(id) });
    await refreshAfterConfigChange(interaction);
    const view = buildConfigEmbed(0);
    await interaction.editReply({ content: `Maintenance window **${id}** was cancelled.`, embeds: [view.embed], components: view.components });
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId) === 'config:runtime:select') {
    const key = interaction.values[0];
    if (RUNTIME_CONFIG_DEFINITIONS[key]) await interaction.showModal(scalarModal(key));
    else await interaction.update({ content: 'Unsupported runtime setting.', components: buildConfigEmbed(0).components });
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId).startsWith('config:remove_mc:select')) {
    await interaction.deferUpdate();
    const id = interaction.values[0];
    const server = listMinecraftServers().find((item) => item.id === id);
    if (!server) {
      const view = buildConfigEmbed(0);
      await interaction.editReply({ content: 'That Minecraft server no longer exists.', embeds: [view.embed], components: view.components });
      return;
    }
    deleteMinecraftServer(id);
    recordAudit({ action: 'REMOVE_SERVICE', actorId: interaction.user.id, targetType: 'minecraft', targetId: id });
    deleteTarget(id);
    removeMcState(id);
    await refreshAfterConfigChange(interaction);
    const view = buildConfigEmbed(0);
    await interaction.editReply({ content: `Removed Minecraft server: ${server.name}`, embeds: [view.embed], components: view.components });
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId).startsWith('config:remove_website:select')) {
    await interaction.deferUpdate();
    const id = interaction.values[0];
    const target = listWebsiteTargets().find((item) => item.id === id);
    if (!target) {
      const view = buildConfigEmbed(0);
      await interaction.editReply({ content: 'That website no longer exists.', embeds: [view.embed], components: view.components });
      return;
    }
    deleteWebsiteTarget(id);
    recordAudit({ action: 'REMOVE_SERVICE', actorId: interaction.user.id, targetType: 'website', targetId: id });
    deleteTarget(id);
    removeWebsiteState(id);
    await refreshAfterConfigChange(interaction);
    const view = buildConfigEmbed(0);
    await interaction.editReply({ content: `Removed website: ${target.name}`, embeds: [view.embed], components: view.components });
    return;
  }

  if (interaction.isStringSelectMenu() && String(interaction.customId).startsWith('config:remove_database:select')) {
    await interaction.deferUpdate();
    const id = interaction.values[0];
    const target = listDatabaseTargets().find((item) => item.id === id);
    if (!target) {
      const view = buildConfigEmbed(0);
      await interaction.editReply({ content: 'That database no longer exists.', embeds: [view.embed], components: view.components });
      return;
    }
    deleteDatabaseTarget(id);
    recordAudit({ action: 'REMOVE_SERVICE', actorId: interaction.user.id, targetType: 'database', targetId: id });
    deleteTarget(id);
    await removeDatabaseState(id);
    await refreshAfterConfigChange(interaction);
    const view = buildConfigEmbed(0);
    await interaction.editReply({ content: `Removed database: ${target.name}`, embeds: [view.embed], components: view.components });
    return;
  }

  if (interaction.isModalSubmit()) {
    const [, , key] = String(interaction.customId).split(':');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (key === 'add_mc') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const { host, port } = parseMinecraftAddress(interaction.fields.getTextInputValue('address'));
        if (!name) throw new Error('Server name is required.');
        const id = `minecraft_${randomUUID()}`;
        saveMinecraftServer({ id, name, host, port });
        recordAudit({ action: 'ADD_SERVICE', actorId: interaction.user.id, targetType: 'minecraft', targetId: id, value: { name, host, port } });
        registerTarget(id, name, { type: 'minecraft' });
        await refreshAfterConfigChange(interaction);
        await interaction.editReply({ content: `Minecraft server **${name}** was added and is now monitored.` });
        return;
      }

      if (key === 'add_website') {
        const name = interaction.fields.getTextInputValue('name').trim();
        if (!name || name.length > 100) throw new Error('Website name is invalid.');
        const url = normalizeWebsiteUrl(interaction.fields.getTextInputValue('url'));
        const id = `website_${randomUUID()}`;
        saveWebsiteTarget({ id, name, url });
        recordAudit({ action: 'ADD_SERVICE', actorId: interaction.user.id, targetType: 'website', targetId: id, value: { name, url } });
        registerTarget(id, name, { type: 'website' });
        await refreshAfterConfigChange(interaction);
        await interaction.editReply({ content: `Website **${name}** was added and is now monitored.` });
        return;
      }

      if (key === 'add_maintenance') {
        const targetId = String(interaction.customId).split(':')[3] ?? '';
        const target = maintenanceTargets().find((item) => item.id === targetId);
        if (!target) throw new Error('The selected monitored service no longer exists.');
        const startsAt = parseMaintenanceTime(interaction.fields.getTextInputValue('starts_at'));
        const endsAt = parseMaintenanceTime(interaction.fields.getTextInputValue('ends_at'));
        const reason = interaction.fields.getTextInputValue('reason').trim();
        const window = scheduleWindow({ serviceId: target.id, serviceType: target.type, startsAt, endsAt, reason, createdBy: interaction.user.id });
        if (!window) throw new Error('The maintenance window values are invalid.');
        recordAudit({ action: 'SCHEDULE_MAINTENANCE', actorId: interaction.user.id, targetType: target.type, targetId: target.id, value: { startsAt, endsAt, reason } });
        await refreshAfterConfigChange(interaction);
        await interaction.editReply({ content: `Maintenance window **${window.id}** was scheduled for **${target.name}** and applied immediately.` });
        return;
      }

      if (key === 'add_database') {
        const name = parseDatabaseName(interaction.fields.getTextInputValue('name'));
        const connection = parseDatabaseConnectionString(interaction.fields.getTextInputValue('connect_string'));
        const sslEnabled = parseDatabaseSsl(interaction.fields.getTextInputValue('ssl'));
        const id = `database_${randomUUID()}`;
        saveDatabaseTarget({ id, name, engine: connection.engine, connectionString: connection.value, sslEnabled });
        recordAudit({ action: 'ADD_SERVICE', actorId: interaction.user.id, targetType: 'database', targetId: id, value: { name, engine: connection.engine, connectionString: connection.value, sslEnabled } });
        registerTarget(id, name, { type: 'database' });
        await refreshAfterConfigChange(interaction);
        const requestId = sslEnabled ? await requestOptionalCertificate(interaction, id, name) : null;
        const certificateText = sslEnabled
          ? (requestId ? ' An optional certificate-upload request was sent to your DM.' : ' I could not send the optional certificate-upload DM; system CA trust will be used.')
          : '';
        await interaction.editReply({ content: `Database **${name}** (${connection.engine}) was added and is now monitored.${certificateText}` });
        return;
      }

      if (!RUNTIME_CONFIG_DEFINITIONS[key]) throw new Error('Unknown configuration field.');
      const raw = interaction.fields.getTextInputValue('value');
      const serializedValue = serializeRuntimeConfigValue(key, raw);
      setRuntimeConfigValue(key, serializedValue);
      recordAudit({ action: 'SET_RUNTIME_CONFIG', actorId: interaction.user.id, targetType: 'runtime_config', targetId: key, value: serializedValue });
      await refreshAfterConfigChange(interaction);
      await interaction.editReply({ content: `Saved **${RUNTIME_CONFIG_DEFINITIONS[key].label}** to SQLite and applied it immediately.` });
    } catch {
      await interaction.editReply({ content: 'Configuration was not saved. Check the supplied values and try again.' });
    }
  }
}
