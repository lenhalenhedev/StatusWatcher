# `/check-tls` and `/check-dns` research notes

## Official Node.js TLS documentation

Source: https://nodejs.org/api/tls.html

- `tls.connect(options[, callback])` creates a client TLS socket and the callback is associated with the secure connection event.
- `secureConnect` is the success boundary for an established TLS handshake.
- `TLSSocket.getPeerCertificate()` exposes peer certificate metadata such as `subject`, `issuer`, `valid_from`, `valid_to`, `fingerprint256`, and `subjectaltname`.
- `TLSSocket.authorized` indicates whether the peer was verified against supplied CAs; `authorizationError` explains a failed authorization.
- The TLS request must set `servername` for SNI when checking a domain, rather than relying only on the socket host.
- The implementation must attach `error`, `timeout`, and `close` handling and must destroy the socket on all terminal paths.
- Certificate validity must be calculated from parsed `valid_to`; raw certificate/hostname/connection details must not be logged or exposed in errors.

## Official Node.js DNS documentation

Source: https://nodejs.org/api/dns.html

- `dns.lookup()` uses OS facilities and may not perform network communication.
- `dns.resolve*()` functions query an actual DNS server and bypass OS name-resolution facilities such as `/etc/hosts`.
- A `dns.Resolver` instance supports independent configuration via `resolver.setServers(servers)` and exposes `resolve4`, `resolve6`, `resolveMx`, `resolveTxt`, `resolveNs`, and `resolveCname`.
- The feature must use an independent resolver per request, never mutate process-global DNS settings.
- DNS errors expose a code such as `ENOTFOUND`; user-facing errors should use safe categories rather than raw error strings.
- DNS calls are network calls and need bounded timeout/cancellation behavior where supported.

Implementation consequence: `/check-tls` will use `node:tls` directly with SNI, peer certificate inspection, timeout, and guaranteed socket cleanup. `/check-dns` will use `dns2` with an explicit nameserver so the query is sent to the selected resolver, not the OS cache.

Research phase recorded after two browser operations on 2026-08-19.

## dns2 package and repository documentation

Sources: https://www.npmjs.com/package/dns2 and https://github.com/lsongdev/node-dns

- The current package release observed is dns2 3.1.1 and the repository includes `index.mjs` for ESM support.
- The high-level client accepts `nameServers`, `port`, `recursive`, and `timeout` options; default transport is UDP.
- Convenience methods include `resolveA`, `resolveAAAA`, and `resolveMX`; arbitrary types can use `resolve(domain, 'TYPE')`.
- Query results contain `answers` and may contain `authorities`; the implementation must normalize only the requested record fields and never dump raw packet/error objects to Discord.
- dns2 may query multiple nameservers in parallel and return the first success. This command will pass exactly one validated nameserver to preserve the user-selected-server contract.
- Package documentation states timeout is per nameserver and errors can include server/reason details; raw errors remain internal and are mapped to safe user-facing categories.
- The official repository's latest release is 3.1.1 and includes ESM support. Dependency addition must be pinned through the project's package manager lockfile and audited.

Research phase updated after two additional browser operations on 2026-08-19.
