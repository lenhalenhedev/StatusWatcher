import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import runtimeConfig from '../config.js';
import { recordAudit } from '../store/auditStore.js';
import { deleteSlo, listSlos, setSlo } from '../store/sloStore.js';

const SERVICE_TYPES = ['bot', 'minecraft', 'website', 'database'];

export const data = new SlashCommandBuilder()
  .setName('slo')
  .setDescription('Manage service-level objectives and error budgets (admin only).')
  .addSubcommand((command) => command
    .setName('set')
    .setDescription('Set an uptime SLO for a monitored service.')
    .addStringOption((option) => option.setName('service_type').setDescription('Service type.').setRequired(true).addChoices(...SERVICE_TYPES.map((value) => ({ name: value, value }))))
    .addStringOption((option) => option.setName('service_id').setDescription('Internal service identifier.').setRequired(true).setMaxLength(200))
    .addNumberOption((option) => option.setName('target_percent').setDescription('Target uptime percentage, for example 99.9.').setRequired(true).setMinValue(0.01).setMaxValue(100))
    .addIntegerOption((option) => option.setName('window_days').setDescription('Rolling window length in days.').setRequired(false).setMinValue(1).setMaxValue(366))
    .addStringOption((option) => option.setName('maintenance_policy').setDescription('Whether maintenance time is excluded.').setRequired(false).addChoices({ name: 'Include maintenance', value: 'include' }, { name: 'Exclude maintenance', value: 'exclude' })))
  .addSubcommand((command) => command.setName('list').setDescription('List configured SLO policies.'))
  .addSubcommand((command) => command
    .setName('remove')
    .setDescription('Remove a service SLO policy.')
    .addStringOption((option) => option.setName('service_type').setDescription('Service type.').setRequired(true).addChoices(...SERVICE_TYPES.map((value) => ({ name: value, value }))))
    .addStringOption((option) => option.setName('service_id').setDescription('Internal service identifier.').setRequired(true).setMaxLength(200)));

function isAdmin(interaction) {
  return interaction.user?.id === runtimeConfig.adminUserId;
}

function safeText(value, fallback = 'Unavailable') {
  return String(value ?? fallback).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
}

export async function execute(interaction, dependencies = {}) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'Only the configured administrator can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'set') {
    const serviceType = interaction.options.getString('service_type', true);
    const serviceId = interaction.options.getString('service_id', true);
    const targetPercent = interaction.options.getNumber('target_percent', true);
    const windowDays = interaction.options.getInteger('window_days') ?? 30;
    const maintenancePolicy = interaction.options.getString('maintenance_policy') ?? 'include';
    const saved = (dependencies.setSlo || setSlo)({ serviceType, serviceId, targetPercent, windowDays, maintenancePolicy, createdBy: interaction.user.id });
    if (!saved) {
      await interaction.reply({ content: 'The SLO values are invalid or the service identifier is not allowed.', flags: MessageFlags.Ephemeral });
      return;
    }
    recordAudit({ action: 'SET_SLO', actorId: interaction.user.id, targetType: serviceType, targetId: serviceId, value: { targetPercent, windowDays, maintenancePolicy } });
    await interaction.reply({ content: `SLO saved: ${safeText(serviceType)} service, target ${saved.target_percent}%, ${saved.window_days}-day window, maintenance ${saved.maintenance_policy}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === 'remove') {
    const serviceType = interaction.options.getString('service_type', true);
    const serviceId = interaction.options.getString('service_id', true);
    const removed = (dependencies.deleteSlo || deleteSlo)({ serviceType, serviceId });
    await interaction.reply({ content: removed ? 'SLO policy removed.' : 'No matching SLO policy exists.', flags: MessageFlags.Ephemeral });
    if (removed) recordAudit({ action: 'REMOVE_SLO', actorId: interaction.user.id, targetType: serviceType, targetId: serviceId });
    return;
  }
  const policies = (dependencies.listSlos || listSlos)(25);
  const content = policies.length === 0
    ? 'No SLO policies are configured.'
    : policies.map((policy) => `${safeText(policy.service_type)}:${safeText(policy.service_id)} — ${policy.target_percent}% / ${policy.window_days}d / maintenance ${safeText(policy.maintenance_policy)}`).join('\n').slice(0, 1_900);
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
