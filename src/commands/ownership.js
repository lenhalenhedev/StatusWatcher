import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import runtimeConfig from '../config.js';
import { recordAudit } from '../store/auditStore.js';
import { deleteOwnershipRecord, getOwnership, setOwnership } from '../store/ownershipStore.js';

const SERVICE_TYPES = ['bot', 'minecraft', 'website', 'database'];

export const data = new SlashCommandBuilder()
  .setName('ownership')
  .setDescription('Manage service-owner roles (admin only).')
  .addSubcommand((command) => command
    .setName('set')
    .setDescription('Assign a Discord role to a service.')
    .addStringOption((option) => option.setName('service_type').setDescription('Service type.').setRequired(true).addChoices(...SERVICE_TYPES.map((value) => ({ name: value, value }))))
    .addStringOption((option) => option.setName('service_id').setDescription('Internal service identifier.').setRequired(true).setMaxLength(200))
    .addRoleOption((option) => option.setName('role').setDescription('Role allowed to manage this service.').setRequired(true)))
  .addSubcommand((command) => command.setName('get').setDescription('Read a service-owner role.')
    .addStringOption((option) => option.setName('service_type').setDescription('Service type.').setRequired(true).addChoices(...SERVICE_TYPES.map((value) => ({ name: value, value }))))
    .addStringOption((option) => option.setName('service_id').setDescription('Internal service identifier.').setRequired(true).setMaxLength(200)))
  .addSubcommand((command) => command.setName('remove').setDescription('Remove a service-owner role.')
    .addStringOption((option) => option.setName('service_type').setDescription('Service type.').setRequired(true).addChoices(...SERVICE_TYPES.map((value) => ({ name: value, value }))))
    .addStringOption((option) => option.setName('service_id').setDescription('Internal service identifier.').setRequired(true).setMaxLength(200)));

export async function execute(interaction, dependencies = {}) {
  if (interaction.user?.id !== runtimeConfig.adminUserId) {
    await interaction.reply({ content: 'Only the configured administrator can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const serviceType = interaction.options.getString('service_type', true);
  const serviceId = interaction.options.getString('service_id', true);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'set') {
    const role = interaction.options.getRole('role', true);
    const saved = (dependencies.setOwnership || setOwnership)({ serviceType, serviceId, roleId: role.id, updatedBy: interaction.user.id });
    if (!saved) {
      await interaction.reply({ content: 'The ownership values are invalid.', flags: MessageFlags.Ephemeral });
      return;
    }
    recordAudit({ action: 'SET_OWNERSHIP', actorId: interaction.user.id, targetType: serviceType, targetId: serviceId, value: role.id });
    await interaction.reply({ content: `Ownership saved for ${serviceType}:${serviceId}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === 'remove') {
    const removed = (dependencies.deleteOwnershipRecord || deleteOwnershipRecord)({ serviceType, serviceId });
    if (removed) recordAudit({ action: 'REMOVE_OWNERSHIP', actorId: interaction.user.id, targetType: serviceType, targetId: serviceId });
    await interaction.reply({ content: removed ? 'Ownership removed.' : 'No ownership rule exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  const owner = (dependencies.getOwnership || getOwnership)({ serviceType, serviceId });
  await interaction.reply({ content: owner ? `Owner role configured for ${serviceType}:${serviceId}.` : 'No ownership rule exists.', flags: MessageFlags.Ephemeral });
}
