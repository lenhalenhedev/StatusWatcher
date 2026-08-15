import { SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { addSubscription, removeSubscription } from '../store/subscriptionStore.js';

export const data = new SlashCommandBuilder()
  .setName('subscribe')
  .setDescription('Get pinged when an important target goes down')
  .addBooleanOption((o) =>
    o
      .setName('enabled')
      .setDescription('true to subscribe (default), false to unsubscribe'),
  )
  .addRoleOption((o) =>
    o
      .setName('role')
      .setDescription('Subscribe a role instead of yourself (admin only)'),
  );

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction) {
  const enabled = interaction.options.getBoolean('enabled') ?? true;
  const role = interaction.options.getRole('role');

  if (role) {
    if (interaction.user.id !== config.adminUserId) {
      await interaction.reply({
        content: 'Only the configured admin can subscribe a role.',
        ephemeral: true,
      });
      return;
    }

    if (enabled) addSubscription('role', role.id);
    else removeSubscription('role', role.id);

    await interaction.reply({
      content: enabled
        ? `🔔 Role **${role.name}** will now be pinged on important outages.`
        : `🔕 Role **${role.name}** will no longer be pinged.`,
    });
    return;
  }

  if (enabled) addSubscription('user', interaction.user.id);
  else removeSubscription('user', interaction.user.id);

  await interaction.reply({
    content: enabled
      ? '🔔 You will now be pinged when an important target goes down.'
      : '🔕 You will no longer be pinged on outages.',
    ephemeral: true,
  });
}
