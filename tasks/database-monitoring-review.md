# Database Monitoring Adversarial Review

## Contract reviewed

The feature must monitor PostgreSQL, MySQL/MariaDB, Redis and MongoDB through persistent official Node.js driver clients and protocol-level health operations; provide Add/Remove Database through `/config`; support optional CA certificate upload through administrator DM; apply configuration without restart; persist secrets safely in SQLite; and never expose connect strings, credentials, endpoints, certificate contents or raw driver errors in logs or Discord UI.

## Correctness

The monitor uses `SELECT 1` for PostgreSQL, `ping()` for MySQL/MariaDB, Redis `PING` with exact `PONG` verification, and MongoDB `admin.command({ ping: 1 })`. Persistent clients are reused between probes, TCP keepalive is enabled where driver/socket options expose it, probe operations have bounded timeouts, and failed clients are closed before the next reconnect. The extracted deterministic state machine enforces the configured confirmation threshold, emits one DOWN event, emits reminders through existing backoff logic, and closes the persisted downtime session on recovery.

A final integration review found and fixed missing database-state propagation in `/status`, `/recheck`, `/resend-embed`, and `/fetch-bot`. All four commands now pass the database state provider to the shared status renderer.

## Security

Connect strings and certificates are encrypted with AES-256-GCM before SQLite persistence. The parser rejects unsupported schemes, fragments, missing hosts, invalid ports, MongoDB SRV ports, oversized names/credentials and malformed SSL values. Driver-controlled TLS, CA-path, timeout and keepalive query parameters are removed before driver construction; monitor-owned TLS verification and timeout policy therefore cannot be disabled by URI query flags. CA uploads are bounded to 512 KiB, validated as X.509, reject private-key markers, are scoped to the configured administrator and an expiring target request, and are deleted from the source DM in a finally block. MongoDB's temporary CA file is mode 0600 and removed during client close.

Runtime logs and embeds use safe error categories or bounded redacted messages. Configuration and certificate failure responses are generic and do not echo raw exceptions. Dropdowns display only target name, engine and SSL metadata. `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.

## Performance and lifecycle

Database probes run in parallel with `Promise.all`, so one slow database does not serialize the rest of the monitoring cycle. Connection creation is single-flight per target, teardown awaits in-flight handshakes, and MongoDB pool size is bounded to one connection for uptime probes. Existing check-cycle overlap protection and graceful shutdown remain in force.

## Verification

Syntax check for all JavaScript files: PASS. Driver import smoke test for `pg`, `mysql2`, `redis` and `mongodb`: PASS. Database-focused suite: **21/21 PASS**, covering URI parsing, TLS policy sanitization, redaction, certificate policy, AES-GCM tamper detection, deterministic state transitions, security source checks and command propagation. Full suite: 64 tests, 56 pass, 8 fail; all failures are the known native `better-sqlite3` SIGSEGV in sandbox Node.js 22.13.0 affecting SQLite-backed config, monitor-message and status-message tests. The declared project engine is Node.js `>=24.0.0`; production must install/rebuild native dependencies under that runtime.

## Remaining operational caveats

The system cannot guarantee deletion of a Discord DM if Discord permissions or transport fail; the handler attempts deletion in `finally` and does not log the attachment URL. Certificate upload is intentionally DM-based because Discord modals do not support file inputs. The encryption key remains a bootstrap secret in `.env` and is not managed by `/config`; losing it makes encrypted database credentials unrecoverable, so it must be backed up securely outside the repository.
