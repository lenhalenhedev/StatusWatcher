import { EmbedBuilder } from 'discord.js';

function valueOrFallback(value) {
  const text = String(value ?? '').trim();
  return text || 'Unavailable';
}

export function buildTlsCheckEmbed(domain, port, result) {
  const embed = new EmbedBuilder()
    .setTitle(`TLS Certificate — ${domain}:${port}`)
    .setColor(result.expired ? 0xed4245 : result.remainingDays <= 30 ? 0xfee75c : 0x57f287)
    .setTimestamp()
    .addFields(
      { name: 'Status', value: result.expired ? 'Expired' : 'Valid', inline: true },
      { name: 'Authorized', value: result.authorized ? 'Yes' : 'No', inline: true },
      { name: 'Remaining', value: `${result.remainingDays} day(s)`, inline: true },
      { name: 'Subject', value: valueOrFallback(result.subject), inline: true },
      { name: 'Issuer', value: valueOrFallback(result.issuer), inline: true },
      { name: 'Protocol', value: valueOrFallback(result.protocol), inline: true },
      { name: 'Cipher', value: valueOrFallback(result.cipher), inline: true },
      { name: 'Valid From', value: valueOrFallback(result.validFrom), inline: true },
      { name: 'Valid To', value: valueOrFallback(result.validTo), inline: true },
      { name: 'Fingerprint (SHA-256)', value: valueOrFallback(result.fingerprint256), inline: false },
    );
  if (!result.authorized) embed.addFields({ name: 'Authorization', value: 'The certificate chain could not be authorized.', inline: false });
  return embed;
}

export function buildDnsCheckEmbed(domain, result) {
  const lines = result.answers.length === 0 ? ['No records found.'] : result.answers.map((answer) => (
    typeof answer === 'string' ? `• ${answer}` : `• ${answer.exchange} (priority ${answer.priority})`
  ));
  return new EmbedBuilder()
    .setTitle(`DNS Lookup — ${domain}`)
    .setColor(0x5865f2)
    .setTimestamp()
    .addFields(
      { name: 'Record Type', value: result.type, inline: true },
      { name: 'Nameserver', value: result.nameserver, inline: true },
      { name: 'Answer Count', value: String(result.answerCount), inline: true },
      { name: 'Answers', value: lines.join('\n').slice(0, 1024), inline: false },
    );
}

export function diagnosticErrorMessage(error) {
  switch (error?.code) {
    case 'INVALID_DOMAIN': return 'The domain is invalid. Use a hostname or public IP address without a scheme, path, port, or credentials.';
    case 'FORBIDDEN_ADDRESS': return 'Private, loopback, link-local, multicast, or reserved addresses are not allowed.';
    case 'INVALID_PORT': return 'The port must be an integer between 1 and 65535.';
    case 'INVALID_DNS_TYPE': return 'The record type is not supported.';
    case 'INVALID_NAMESERVER': return 'The nameserver must be a public IPv4 or IPv6 address.';
    case 'TIMEOUT':
    case 'DNS_TIMEOUT': return 'The check timed out.';
    case 'DNS_LOOKUP_FAILED': return 'The domain could not be resolved.';
    case 'CONNECTION_REFUSED': return 'The TLS service refused the connection.';
    case 'CERTIFICATE_UNAVAILABLE': return 'The server did not provide a usable certificate.';
    case 'CERTIFICATE_INVALID': return 'The server certificate contains invalid validity data.';
    case 'CERTIFICATE_AUTHORIZATION_FAILED': return 'The certificate chain could not be authorized.';
    case 'DNS_RESPONSE_INVALID': return 'The DNS server returned an invalid response.';
    default: return 'The check failed. Review the bot logs for a safe diagnostic category.';
  }
}
