import { ActionRowBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';
import config from '../config.js';
import {
  acknowledgeIncidentForService,
  listOpenIncidents,
} from '../store/incidentStore.js';

export const ACKNOWLEDGE_SERVICE_SELECT_ID = 'acknowledge:service';
const MAX_OPTIONS = 25;
const SERVICE_LABELS = {
  bot: 'Bot',
  website: 'Website',
  database: 'Database',
  minecraft: 'Minecraft',
};

export const data = new SlashCommandBuilder()
  .setName('acknowledge')
  .setDescription('Acknowledge an active service incident and suppress duplicate communication.');

function encodeServiceSelection(serviceType, serviceId) {
  return `${String(serviceType)}:${String(serviceId)}`;
}

function decodeServiceSelection(value) {
  const separator = String(value ?? '').indexOf(':');
  if (separator <= 0 || separator === String(value).length - 1) return null;
  const serviceType = String(value).slice(0, separator);
  const serviceId = String(value).slice(separator + 1);
  if (!SERVICE_LABELS[serviceType] || !serviceId) return null;
  return { serviceType, serviceId };
}

function buildServiceOptions(incidents) {
  return incidents.slice(0, MAX_OPTIONS).map((incident) => ({
    label: `${SERVICE_LABELS[incident.service_type]}: ${incident.name}`.slice(0, 100),
    description: 'Acknowledge the current open incident'.slice(0, 100),
    value: encodeServiceSelection(incident.service_type, incident.service_id),
  }));
}

function buildServiceSelect(incidents) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ACKNOWLEDGE_SERVICE_SELECT_ID)
      .setPlaceholder('Select a service with an active incident')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(buildServiceOptions(incidents)),
  );
}

function isAdmin(interaction) {
  return interaction.user?.id === config.adminUserId;
}

export async function execute(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const incidents = listOpenIncidents(MAX_OPTIONS);
  if (incidents.length === 0) {
    await interaction.reply({ content: 'There are no open service incidents to acknowledge.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: 'Select the service whose active incident you want to acknowledge.',
    components: [buildServiceSelect(incidents)],
    flags: MessageFlags.Ephemeral,
  });
}

export function handlesInteraction(interaction) {
  return interaction.isStringSelectMenu?.() !== false
    && interaction.customId === ACKNOWLEDGE_SERVICE_SELECT_ID;
}

export async function handleInteraction(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const selected = decodeServiceSelection(interaction.values?.[0]);
  if (!selected) {
    await interaction.reply({ content: 'The selected service is invalid or no longer available.', flags: MessageFlags.Ephemeral });
    return;
  }

  const incident = acknowledgeIncidentForService(selected.serviceType, selected.serviceId, interaction.user.id);
  if (!incident) {
    await interaction.reply({ content: 'The selected service does not have an open incident anymore.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: `Service **${incident.name}** acknowledged. Repeated STILL_DOWN reminders are suppressed; health monitoring continues, and an UP event will automatically resolve this incident.`,
    flags: MessageFlags.Ephemeral,
  });
}
