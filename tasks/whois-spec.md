# `/whois` Command Specification

## Goal

Add an administrator-only Discord slash command named `/whois` that queries domain WHOIS data in real time using the npm `whois` package and presents the useful registration, lifecycle, registrar, nameserver, and status information in a safe Discord embed.

## User-facing contract

The command is `/whois` with one required string option:

| Option | Type | Required | Contract |
|---|---|---:|---|
| `domain` | string | yes | A hostname or public IP address without a URL scheme, path, port, credentials, or whitespace. Existing `normalizeDomain()` validation is reused. |

The command is restricted to the configured administrator, follows the existing deferred ephemeral interaction flow, and returns a generic safe error message for network, timeout, malformed-response, or upstream failures.

## Service contract

`lookupWhois(domain, dependencies = {})` validates the domain before any network operation, calls the injected `whois.lookup`-compatible client, and returns a normalized bounded object. The default package call uses a bounded socket timeout, no automatic referral following, and non-verbose mode. The service never logs or returns the complete raw WHOIS response.

The default package call uses `follow: 0`, so it does not automatically connect to an arbitrary referral server returned by untrusted WHOIS text. This prevents the package’s internal referral mechanism from becoming an SSRF path; the command still returns the useful fields from the initial registry response. The normalized result contains only useful allowlisted fields, represented as strings or string arrays:

| Category | Included labels |
|---|---|
| Identity | Domain Name, Registry Domain ID |
| Registrar | Registrar, Registrar IANA ID, Registrar URL |
| Lifecycle | Creation Date, Updated Date, Registry Expiry Date, Registrar Registration Expiration Date |
| Status | Domain Status |
| Nameservers | Name Server |
| Network/registry | Whois Server, DNSSEC, Registrant Country when present |

Field labels are matched case-insensitively after trimming whitespace and normalizing repeated spaces. Unknown fields, raw referral/debug text, contact names, organizations, street addresses, phone numbers, fax numbers, and email addresses are excluded from the returned normalized result by default to reduce PII exposure.

Duplicate values are deduplicated while preserving their first-seen order. Values are bounded to 512 characters per value, arrays to 10 values per field, and the total normalized output to a conservative limit that fits a Discord embed. Malformed or excessively large upstream data must fail safely with `WHOIS_RESPONSE_INVALID` or be truncated deterministically; it must never cause an unbounded embed or log write.

## Embed contract

The embed title is `WHOIS Lookup — <normalized domain>`. It presents only normalized fields, uses `Unavailable` for absent scalar data, shows nameservers and statuses as bounded multiline values, and never includes raw WHOIS output. Every field name and value respects Discord embed limits; the embed has at most 25 fields and values are no longer than 1024 characters. If no allowlisted data is present, the embed says `No useful WHOIS fields were returned.`

## Security and abuse controls

The implementation treats WHOIS data as untrusted external input. It must not log raw responses, domains containing secrets, upstream error messages, or contact data. Domain validation blocks URLs, credentials, ports, control characters, invalid IDNs, and private/reserved/loopback/link-local/multicast addresses through the existing validator. The service uses a finite timeout and disables automatic referral following. User-controlled WHOIS server, proxy, bind address, or referral depth options are not exposed.

## Test acceptance criteria

The suite must cover command metadata, admin authorization, deferred/replied interaction behavior, normalized domain forwarding, safe error responses, registry inclusion, successful WHOIS parsing, case/spacing variants, duplicate values, missing fields, multiline values, malformed client payloads, oversized values and arrays, package errors, timeout mapping, validation-before-network behavior, and embed Discord field/value bounds. Tests must assert that raw PII-like values and raw upstream error text do not reach the normalized result, embed, or logging path.

## Deliberate trade-offs

WHOIS is not a standardized structured protocol and registry responses vary by TLD. The implementation therefore uses a conservative allowlist and a tolerant line parser rather than pretending to provide a complete universal schema. The command prioritizes safe, useful information over exposing every raw registry line.

## References

[1]: https://www.npmjs.com/package/whois "npm whois package documentation"
[2]: https://github.com/FurqanSoftware/node-whois "Maintained node-whois repository and README"
[3]: https://discord.com/developers/docs/resources/message#embed-limits "Discord embed limits"
