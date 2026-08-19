# StatusWatcher `/whois` Handoff Report

## Summary

StatusWatcher now includes an administrator-only `/whois` slash command. The command accepts a required domain, performs a real-time lookup through `whois` 2.16.2, normalizes useful registration data, and renders a bounded Discord embed. The command is registered through the existing central command registry and uses the same deferred ephemeral interaction pattern as `/check-tls` and `/check-dns`.

## Implementation

| Area | Delivered behavior |
|---|---|
| Dependency | Added exact runtime dependency `whois@2.16.2` and updated `package-lock.json`. |
| Service | Added `src/services/whoisService.js` with callback adaptation, timeout handling, safe error categories, parser normalization, duplicate removal, and output bounds. |
| Parser | Allowlisted domain identity, registrar, lifecycle dates, status, nameservers, WHOIS server, DNSSEC, and registrant country. Contact names, organizations, addresses, phone numbers, email addresses, unknown fields, and raw response text are excluded. |
| Command | Added `src/commands/whois.js` with required `domain` option, administrator authorization, domain validation, deferred ephemeral reply, injectable service and error reporter, and safe diagnostics. |
| Embed | Added `buildWhoisEmbed()` with allowlisted fields, sanitization, a maximum of 25 fields, and Discord-compatible value bounds. |
| Registry | Added `/whois` to `src/commands/index.js`; deployment uses the existing registry flow. |

## Security decisions

The existing domain validator runs before network access and rejects URLs, credentials, ports, malformed domains, and forbidden private/reserved/loopback/link-local/multicast addresses. The package call uses `follow: 0` to disable automatic referral connections. This is intentional: the npm package can parse referral servers from untrusted response text, and automatic referral following would create an unnecessary SSRF path. The initial WHOIS connection remains package-managed, while the service does not expose user-controlled WHOIS server, proxy, bind, or referral options.

All upstream WHOIS text is treated as untrusted data. The service strips control characters, neutralizes Discord formatting and mentions, caps values at 512 characters, caps repeated values at 10 per field, and returns only the allowlisted schema. The command logs only an allowlisted uppercase diagnostic category such as `WHOIS_TIMEOUT`, `WHOIS_RESPONSE_INVALID`, or `WHOIS_LOOKUP_FAILED`; raw upstream messages, domains, response text, credentials, and contact information are not logged or returned.

## Verification

The complete test suite passed under Node.js 24.19.0:

| Check | Result |
|---|---:|
| Full `npm test` suite | **127/127 passed** |
| WHOIS service and command focused tests | **22/22 passed** |
| Syntax checks for new service and command | **Passed** |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Source language/deprecation guardrails | **Passed** |
| Cross-model review | Skipped at the operator’s request; single-model adversarial review completed. |

## Documentation sources

The exact installed package was verified from npm metadata and its published source. The package exposes `lookup(addr, options, callback)`, supports `follow`, `timeout`, `verbose`, and related options, and returns either raw text or verbose server/data parts depending on the options. [1] [2]

Discord embed field and value limits were checked against the official Discord developer documentation. [3]

## References

[1]: https://www.npmjs.com/package/whois "npm whois package"
[2]: https://github.com/FurqanSoftware/node-whois "node-whois source repository"
[3]: https://discord.com/developers/docs/resources/message#embed-limits "Discord Embed Limits"

## Real-network smoke note

A bounded smoke check against `example.com` returned the safe category `WHOIS_TIMEOUT`; no raw registry response or upstream error was printed. The package mapping selects `whois.verisign-grs.com` for `.com`, and TCP port 43 reachability was confirmed from the sandbox. The registry did not complete the WHOIS exchange within the configured five-second smoke timeout, so this is recorded as an external registry-response limitation rather than a parser or command failure. The deterministic service tests and callback-boundary tests pass independently.
