# `/check-tls` and `/check-dns` specification

## Command contracts

| Command | Required input | Optional input | Default | Output |
| --- | --- | --- | --- | --- |
| `/check-tls` | `domain`: validated DNS hostname or IP literal | `port`: integer 1–65535 | `443` | Safe ephemeral embed with certificate subject/issuer, validity window, remaining days, authorization status, protocol and cipher; no raw endpoint or exception text beyond the user-supplied domain. |
| `/check-dns` | `domain`: validated DNS hostname | `type`: `A`, `AAAA`, `MX`, `TXT`, `NS`, or `CNAME`; `nameserver`: IPv4/IPv6 literal | `A`, `1.1.1.1` | Safe ephemeral embed with selected record type, selected resolver label, normalized answers, and count; no raw packet or driver exception. |

## Validation rules

`domain` must be non-empty, trimmed, at most 253 characters, contain no whitespace, control characters, URL scheme, slash, query, fragment, or port suffix, and be either a valid DNS name or IP literal. DNS names are normalized to lowercase and trailing root dot is removed. A fully numeric dotted input is accepted only as an IP literal. `port` is a strict base-10 integer in the inclusive range 1–65535. DNS type is case-insensitive at the command boundary but normalized to uppercase. `nameserver` must be an IPv4 or IPv6 literal and may not be a hostname, URL, or port-bearing value.

## TLS behavior

The implementation uses `node:tls` and `tls.connect({ host: domain, port, servername: domain, rejectUnauthorized: false })` solely to inspect the peer certificate while separately reporting `authorized` and `authorizationError`. It must not disable TLS itself, follow redirects, or use an HTTP client. It waits for `secureConnect`, reads `getPeerCertificate()`, computes remaining days from `valid_to`, and always destroys the socket on success, timeout, error, and close. Certificate fields are normalized and truncated to bounded lengths.

## DNS behavior

The implementation uses a fresh `dns2` client per request with exactly one validated nameserver, UDP protocol, port 53, recursion enabled, and a bounded timeout. A record-type map calls `resolveA`, `resolveAAAA`, `resolveMX`, `resolveCNAME`, or generic `resolve(domain, type)` for TXT and NS. The result is normalized to bounded strings/objects. Raw dns2 errors and packet contents never reach Discord or logs.

## Security acceptance criteria

Both commands are admin-only according to the existing command policy. Replies are ephemeral using `MessageFlags.Ephemeral`. No user input other than normalized labels may be interpolated into errors or logs. The implementation must not accept URLs, embedded credentials, arbitrary ports in domain/nameserver fields, localhost/loopback/link-local/multicast/private/reserved addresses, or DNS rebinding through a hostname that resolves to a forbidden address. TLS and DNS checks are outbound network operations and must enforce timeout and output limits.

## English-only acceptance criteria

All user-facing command names, descriptions, option names, embed titles, field labels, validation errors, source comments intended for operators, README/operations docs, package metadata, and test descriptions must be English. Historical planning notes under `tasks/` may remain as archival records unless explicitly included in the translation scope; source JavaScript and package metadata may not contain Vietnamese characters.

## Verification contract

Tests must cover valid and malformed domain/IP inputs, all supported record types, defaults, boundaries, uppercase/lowercase normalization, IPv6 nameservers, DNS/TLS timeout/error paths, certificate absence and malformed dates, output truncation, admin rejection, ephemeral flags, command registration, interaction routing, embed contracts, English-only source scans, and injection/SSRF payloads. Network-dependent tests use injectable factories and local fixtures; they must not depend on public DNS or public TLS availability.
