import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { buildWhoisEmbed, diagnosticErrorMessage } from '../handlers/checkEmbeds.js';
import { lookupWhois } from '../services/whoisService.js';
import { normalizeDomain } from '../utils/checkNetworkInput.js';
import { logError } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Look up useful WHOIS registration data for a domain (admin only)')
  .addStringOption((option) => option
    .setName('domain')
    .setDescription('Domain to look up, for example example.com')
    .setRequired(true));

function replyError(interaction, message) {
  return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function safeDiagnosticCategory(error) {
  return typeof error?.code === 'string' && SAFE_ERROR_CODE_PATTERN.test(error.code)
    ? error.code
    : 'UNKNOWN';
}

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
export async function execute(interaction, dependencies = {}) {
  if (interaction.user.id !== config.adminUserId) {
    await replyError(interaction, 'Only the configured administrator can use this command.');
    return;
  }

  try {
    const domain = normalizeDomain(interaction.options.getString('domain', true));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await (dependencies.lookupWhois || lookupWhois)(domain);
    await interaction.editReply({ embeds: [buildWhoisEmbed(domain, result)] });
  } catch (error) {
    const category = safeDiagnosticCategory(error);
    await (dependencies.reportError || logError)('Whois.execute', `category=${category}`);
    const message = diagnosticErrorMessage(error);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => undefined);
    else await replyError(interaction, message);
  }
}
