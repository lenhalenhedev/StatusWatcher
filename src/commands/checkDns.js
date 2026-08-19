import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config.js';
import { buildDnsCheckEmbed, diagnosticErrorMessage } from '../handlers/checkEmbeds.js';
import { queryDnsRecords } from '../services/dnsCheckService.js';
import { DNS_RECORD_TYPES, normalizeDnsType, normalizeDomain, normalizeNameserver } from '../utils/checkNetworkInput.js';

export const data = new SlashCommandBuilder()
  .setName('check-dns')
  .setDescription('Query DNS records through a selected nameserver in real time (admin only)')
  .addStringOption((option) => option
    .setName('domain')
    .setDescription('Domain to query, for example facebook.com')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('type')
    .setDescription('DNS record type, default A')
    .addChoices(...DNS_RECORD_TYPES.map((type) => ({ name: type, value: type })))
    .setRequired(false))
  .addStringOption((option) => option
    .setName('nameserver')
    .setDescription('Public DNS server IPv4 or IPv6 address, default 1.1.1.1')
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
    const type = normalizeDnsType(interaction.options.getString('type') ?? 'A');
    const nameserver = normalizeNameserver(interaction.options.getString('nameserver') ?? undefined);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await (dependencies.queryDnsRecords || queryDnsRecords)(domain, { type, nameserver });
    await interaction.editReply({ embeds: [buildDnsCheckEmbed(domain, result)] });
  } catch (error) {
    const message = diagnosticErrorMessage(error);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => undefined);
    else await replyError(interaction, message);
  }
}
