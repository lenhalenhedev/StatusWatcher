# Database Monitoring Operations

## Scope

StatusWatcher supports PostgreSQL (`postgres://` and `postgresql://`), MySQL/MariaDB (`mysql://`), Redis (`redis://` and `rediss://`) and MongoDB (`mongodb://` and `mongodb+srv://`). Each target uses a persistent official Node.js driver client rather than a raw port-only check. The monitor performs a protocol-level health operation over the maintained TCP connection: `SELECT 1` for PostgreSQL, `ping()` for MySQL/MariaDB, Redis `PING` expecting `PONG`, and MongoDB `admin.command({ ping: 1 })`.

| Engine | URI schemes | Health operation | TLS behavior |
|---|---|---|---|
| PostgreSQL | `postgres://`, `postgresql://` | `SELECT 1` | `SSL=true` enables certificate verification; optional uploaded CA is used |
| MySQL/MariaDB | `mysql://` | `ping()` | `SSL=true` enables `rejectUnauthorized=true`; optional uploaded CA is used |
| Redis | `redis://`, `rediss://` | `PING` and exact `PONG` check | `rediss://` always uses TLS; `SSL=true` enables TLS for `redis://` |
| MongoDB | `mongodb://`, `mongodb+srv://` | `admin.command({ ping: 1 })` | `SSL=true` enables TLS; SRV URIs must not include a port |

## Configuration flow

The administrator opens `/config`, selects `Add Database`, and enters the display name, connect string and strict `SSL=true` or `SSL=false`. The connect string and certificate are encrypted with AES-256-GCM before SQLite persistence. The encryption key is read from `DB_ENCRYPTION_KEY` and must be at least 16 characters; use a long random value in production and do not commit it.

Discord modals cannot accept file attachments. When SSL is enabled, StatusWatcher sends the configured administrator a DM asking for an optional CA certificate file. The upload is limited to 512 KiB, must parse as an X.509 certificate, and private-key markers are rejected. The message is deleted after processing. The certificate is encrypted in SQLite; MongoDB temporarily receives a mode-0600 CA file because its Node driver option is file-based, and the file is removed when the client closes.

## State and notification semantics

A connection or probe failure starts a transient confirmation timer. The target becomes `DOWN` only after `CONFIRM_DOWN_THRESHOLD` has elapsed continuously. A recovery closes the persisted downtime session and emits `UP`. A continuing outage emits `STILL_DOWN` only when the configured backoff is due. Driver errors are converted to safe categories such as `timeout`, `connection_failed`, `authentication_failed`, `tls_error`, `protocol_error` or `probe_failed`; raw connection strings, usernames, passwords, hostnames, IP addresses and certificate paths are not logged or rendered.

## Required runtime setup

The `.env` file must contain `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `ADMIN_USER_ID` and a strong `DB_ENCRYPTION_KEY`. The bot also needs the Discord `DirectMessages` and `MessageContent` intents enabled in the application configuration to receive the certificate-upload DM. Operational monitoring values remain managed through `/config` and are applied after the SQLite snapshot reload without restarting the process.

## Verification notes

The focused parser, crypto, state-machine and security tests are intended to run in the sandbox. Full SQLite-backed tests may be blocked by the sandbox's known `better-sqlite3` native SIGSEGV under Node.js 22.13.0; production should use the Node version declared by `package.json` and rebuild native dependencies there.


Database state is also propagated through `/status`, `/recheck`, `/resend-embed`, `/list`, and status-pagination interactions. After the latest hardening, the focused database suite passes 19/19 tests. The full suite reports 64 tests, 56 passing, and 8 failures, all attributable to the known `better-sqlite3` native `SIGSEGV` under sandbox Node.js 22.13.0; the failing cases are SQLite-backed config, monitor-message, and status-message tests.

The certificate DM flow deletes a pending upload request when DM delivery fails, consumes requests only for the authorized administrator, deletes the source DM in a finally block, rejects private-key markers, validates X.509 content, and returns generic user-facing failure text. Driver-controlled TLS, certificate-path, timeout, and keepalive query overrides are stripped before connection creation; monitor-owned SSL verification and timeout policies remain authoritative.
