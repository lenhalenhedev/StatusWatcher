import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { buildTlsCheckEmbed, diagnosticErrorMessage } from '../handlers/checkEmbeds.js';
import { checkTlsCertificate } from '../services/tlsCheckService.js';
import { normalizeDomain, parsePort } from '../utils/checkNetworkInput.js';

export const data = new SlashCommandBuilder()
  .setName('check-tls')
  .setDescription('Check a domain SSL/TLS certificate in real time (admin only)')
  .addStringOption((option) => option
    .setName('domain')
    .setDescription('Domain to check, for example google.com')
    .setRequired(true))
  .addIntegerOption((option) => option
    .setName('port')
    .setDescription('TLS port, default 443')
    .setMinValue(1)
    .setMaxValue(65_535)
    .setRequired(false));

function replyError(interaction, message) {
  return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction, dependencies = {}) {
  if (interaction.user.id !== config.adminUserId) {
    await replyError(interaction, 'Only the configured administrator can use this command.');
    return;
  }

  try {
    const domain = normalizeDomain(interaction.options.getString('domain', true));
    const port = parsePort(interaction.options.getInteger('port'), 443);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await (dependencies.checkTlsCertificate || checkTlsCertificate)(domain, { port });
    await interaction.editReply({ embeds: [buildTlsCheckEmbed(domain, port, result)] });
  } catch (error) {
    const message = diagnosticErrorMessage(error);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => undefined);
    else await replyError(interaction, message);
  }
}
