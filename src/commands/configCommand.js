import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import runtimeConfig, { reloadRuntimeConfig, serializeRuntimeConfigValue } from '../config.js';
import { parseMinecraftAddress, RUNTIME_CONFIG_DEFINITIONS } from '../config/runtimeConfigSchema.js';
import {
  deleteMinecraftServer,
  listMinecraftServers,
  saveMinecraftServer,
  setRuntimeConfigValue,
} from '../store/runtimeConfigStore.js';
import { deleteTarget, registerTarget } from '../utils/uptimeTracker.js';
import { refreshStatusMessage } from '../services/statusMessage.js';
import { getBotStates } from '../monitors/botMonitor.js';
import { getMcStates, removeMcState } from '../monitors/mcMonitor.js';
import { buildConfigEmbed, buildRemoveMinecraftComponents } from './configView.js';

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
  if (key === 'mcRetryBaseMs') return String(runtimeConfig.mcRetryBaseMs);
  if (key === 'mcMaxRetries') return String(runtimeConfig.mcMaxRetries);
  if (key === 'mcStatusTimeoutMs') return String(runtimeConfig.mcStatusTimeoutMs);
  if (key === 'dailyDigestCron') return runtimeConfig.dailyDigestCron;
  return runtimeConfig[key] || '';
}

function addModal() {
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
    .addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(address),
    );
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
  await refreshStatusMessage(interaction.client, {
    channelId: runtimeConfig.monitorChannelId,
    getBotStates,
    getMcStates,
  });
}

async function showConfig(interaction, page = 0) {
  const view = buildConfigEmbed(page);
  await interaction.editReply({ content: '', embeds: [view.embed], components: view.components });
}

export function handlesInteraction(interaction) {
  return String(interaction.customId || '').startsWith('config:');
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured admin can use /config.', ephemeral: true });
    return;
  }
  const view = buildConfigEmbed(0);
  await interaction.reply({ embeds: [view.embed], components: view.components, ephemeral: true });
}

export async function handleInteraction(interaction) {
  if (!isAdmin(interaction)) {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: 'Only the configured admin can use /config.' });
    else await interaction.reply({ content: 'Only the configured admin can use /config.', ephemeral: true });
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
      const servers = listMinecraftServers();
      await interaction.update({ content: 'Select the Minecraft server to remove.', components: buildRemoveMinecraftComponents(servers, Number(value)) });
      return;
    }
    if (action === 'back') {
      const view = buildConfigEmbed(0);
      await interaction.update({ content: '', embeds: [view.embed], components: view.components });
      return;
    }
    if (action !== 'open') return;
    if (value === 'add_mc') {
      await interaction.showModal(addModal());
      return;
    }
    if (value === 'remove_mc') {
      const servers = listMinecraftServers();
      if (servers.length === 0) {
        await interaction.update({
          content: 'No Minecraft servers are configured.',
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
          )],
        });
      } else {
        await interaction.update({ content: 'Select the Minecraft server to remove.', components: buildRemoveMinecraftComponents(servers) });
      }
      return;
    }
    if (RUNTIME_CONFIG_DEFINITIONS[value]) {
      await interaction.showModal(scalarModal(value));
    }
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
    deleteTarget(id);
    removeMcState(id);
    await refreshAfterConfigChange(interaction);
    const view = buildConfigEmbed(0);
    await interaction.editReply({ content: `Removed Minecraft server: ${server.name}`, embeds: [view.embed], components: view.components });
    return;
  }

  if (interaction.isModalSubmit()) {
    const [, , key] = String(interaction.customId).split(':');
    await interaction.deferReply({ ephemeral: true });
    try {
      if (key === 'add_mc') {
        const name = interaction.fields.getTextInputValue('name').trim();
        const { host, port } = parseMinecraftAddress(interaction.fields.getTextInputValue('address'));
        if (!name) throw new Error('Server name is required.');
        const id = `minecraft_${randomUUID()}`;
        saveMinecraftServer({ id, name, host, port });
        registerTarget(id, name, { type: 'minecraft' });
        await refreshAfterConfigChange(interaction);
        await interaction.editReply({ content: `Minecraft server **${name}** was added and is now monitored.` });
        return;
      }

      if (!RUNTIME_CONFIG_DEFINITIONS[key]) throw new Error('Unknown configuration field.');
      const raw = interaction.fields.getTextInputValue('value');
      setRuntimeConfigValue(key, serializeRuntimeConfigValue(key, raw));
      await refreshAfterConfigChange(interaction);
      await interaction.editReply({ content: `Saved **${RUNTIME_CONFIG_DEFINITIONS[key].label}** to SQLite and applied it immediately.` });
    } catch (err) {
      await interaction.editReply({ content: `Configuration was not saved: ${err.message}` });
    }
  }
}
