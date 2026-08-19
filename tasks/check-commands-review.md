# `/check-tls` and `/check-dns` Final Review

## Scope

This change adds two administrator-only diagnostic commands:

- `/check-tls domain:<string> port:<integer>` checks a live TLS handshake and returns bounded certificate metadata.
- `/check-dns domain:<string> type:<A|AAAA|MX|TXT|NS|CNAME> nameserver:<public IP>` performs a live DNS query through the selected nameserver using `dns2`.

All user-facing command descriptions, validation messages, embed labels, package metadata, JavaScript source, and JavaScript tests are English-only.

## Correctness review

The TLS implementation uses `node:tls`, sets SNI through `servername`, verifies the handshake, reads the peer certificate only after a successful secure connection, validates certificate dates, computes remaining whole calendar days, and destroys the socket on success, timeout, handshake failure, authorization failure, and DNS failure. DNS resolution is performed before the socket is opened; every resolved address is checked against the forbidden/reserved-address policy, and the selected public address is pinned through the TLS lookup callback to reduce DNS-rebinding risk.

The DNS implementation uses `dns2` with an explicit `nameServers` list, recursive mode, port 53, and a bounded timeout. It supports A, AAAA, MX, TXT, NS, and CNAME. Responses are normalized into a bounded allowlist; malformed answers, excessive answer counts, control characters, and oversized values are rejected. The service validates its own inputs in addition to command-layer validation so direct callers cannot bypass the boundary policy.

Both commands use the current Discord.js private-response contract, `flags: MessageFlags.Ephemeral`, and are registered exactly once in the central command map. Errors are mapped to generic user-safe categories and do not return raw exception text, resolver details, packet data, or certificate internals.

## Security review

The trust boundaries are Discord command input, DNS answers, TLS certificate fields, and errors emitted by network libraries. Domains, ports, record types, and nameservers are strictly validated. Private, loopback, link-local, multicast, unspecified, documentation, benchmarking, and other reserved IP ranges are rejected. User-controlled DNS names cannot be used to reach internal addresses through the TLS checker.

Network operations have bounded timeouts and bounded output. TLS sockets are destroyed deterministically. DNS timeout timers are cleared in `finally` blocks. There are no new logs containing domains, IP addresses, nameserver values, certificate subjects, or raw network errors. The embed builders expose only safe, bounded fields.

`dns2` is declared as a runtime dependency and `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities in the installed dependency graph.

## Verification

| Check | Result |
|---|---:|
| Node.js syntax check for every `src/` and `test/` JavaScript file | PASS |
| Focused network, command, embed, source-language, and registry tests | 33/33 PASS |
| Full repository `npm test` under Node.js 24 | 113/113 PASS |
| Vietnamese-character source scan | PASS; no matches outside the scanner's own explicit pattern definition |
| Deprecated `ephemeral:` and `ready` listener scan | PASS; no matches |
| `git diff --check` | PASS |
| Production dependency audit | PASS; 0 vulnerabilities |

## Official references

1. Node.js TLS API: https://nodejs.org/api/tls.html
2. Node.js DNS API: https://nodejs.org/api/dns.html
3. `dns2` package documentation: https://www.npmjs.com/package/dns2
4. `dns2` source repository: https://github.com/lsongdev/node-dns
5. Discord.js interaction reply options: https://discord.js.org/docs/packages/discord.js/14.22.1/InteractionReplyOptions:Interface

## Review conclusion

No correctness, security, architecture, performance, translation, or regression blocker was found in the final review. The implementation is ready for command deployment with the existing deployment script. A production operator should deploy the updated command registry so `/check-tls` and `/check-dns` become available in Discord.
