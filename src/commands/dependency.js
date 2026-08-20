import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { addDependency, listDependencies, removeDependency } from '../store/dependencyStore.js';

export const data = new SlashCommandBuilder()
  .setName('dependency')
  .setDescription('Manage cautious service dependency relationships (admin only)')
  .addSubcommand((command) => command
    .setName('add')
    .setDescription('Add a dependency edge')
    .addStringOption((option) => option.setName('service').setDescription('Dependent service identifier').setRequired(true))
    .addStringOption((option) => option.setName('depends_on').setDescription('Dependency service identifier').setRequired(true))
    .addStringOption((option) => option.setName('group').setDescription('Optional dependency group').setRequired(false)))
  .addSubcommand((command) => command
    .setName('remove')
    .setDescription('Remove a dependency edge')
    .addIntegerOption((option) => option.setName('id').setDescription('Dependency edge id').setRequired(true).setMinValue(1)))
  .addSubcommand((command) => command.setName('list').setDescription('List configured dependency edges'));

export async function execute(interaction) {
  if (interaction.user.id !== config.adminUserId) {
    await interaction.reply({ content: 'Only the configured admin can use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'add') {
    const edge = addDependency({
      serviceId: interaction.options.getString('service', true),
      dependsOnServiceId: interaction.options.getString('depends_on', true),
      dependencyGroupId: interaction.options.getString('group'),
      createdBy: interaction.user.id,
    });
    await interaction.reply({
      content: edge ? `Dependency edge **${edge.id}** added.` : 'The dependency was invalid, duplicated, or would create a cycle.',
      flags: edge ? undefined : MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'remove') {
    const removed = removeDependency(interaction.options.getInteger('id', true));
    await interaction.reply({
      content: removed ? 'Dependency edge removed.' : 'Dependency edge not found.',
      flags: removed ? undefined : MessageFlags.Ephemeral,
    });
    return;
  }

  const edges = listDependencies(100);
  const description = edges.length
    ? edges.map((edge) => `**${edge.id}** · ${edge.service_id} depends on ${edge.depends_on_service_id}`).join('\n').slice(0, 4096)
    : 'No dependency relationships are configured.';
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Service Dependencies').setDescription(description).setColor(0x5865F2)] });
}
