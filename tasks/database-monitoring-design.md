# Database uptime monitoring design

## Scope

The feature supports `postgres://` and `postgresql://`, `mysql://`, `redis://` and `rediss://`, `mongodb://`, and `mongodb+srv://`. A `mysql://` target is monitored through the MySQL-compatible protocol and is labeled MySQL/MariaDB because the URI scheme alone cannot reliably distinguish the server vendor.

## Persistence model

A new `database_targets` table stores only metadata and encrypted secret material:

| Column | Purpose |
|---|---|
| `id` | Stable opaque target ID used by `targets` and interaction values. |
| `name` | User-visible database name, length-limited and normalized. |
| `engine` | Parsed engine: `postgres`, `mysql`, `redis`, or `mongodb`. |
| `connection_ciphertext`, `connection_iv`, `connection_tag` | AES-256-GCM encrypted connect string. |
| `ssl_enabled` | Explicit boolean selected in `/config`. |
| `certificate_ciphertext`, `certificate_iv`, `certificate_tag` | Optional encrypted PEM CA certificate. |
| `created_at`, `updated_at`, `certificate_uploaded_at` | Audit timestamps; no secret values. |

The existing generic `targets` and `downtime_sessions` tables remain the uptime source of truth. Each database row registers a target with `type = 'database'`; deletion removes the target and its history transactionally.

## Secret handling

The connect string and certificate are encrypted at rest with AES-256-GCM. The key is derived with `scryptSync` from the bootstrap `DB_ENCRYPTION_KEY` and a fixed application salt. The raw key, plaintext connect string, certificate body, password, host, and port are never included in logs, Discord embeds, interaction replies, error messages, test snapshots, or archives. If `DB_ENCRYPTION_KEY` is absent, the process may boot without database targets but Add Database fails closed with a generic configuration error. Existing encrypted targets remain unmonitorable until the key is supplied.

The `/config` list shows only database name, engine, SSL state, and configured/unconfigured certificate state. Remove dropdown labels contain no host, port, username, password, or URI.

## Certificate upload workflow

Discord modals cannot contain file upload fields. Add Database therefore accepts name, connect string, and SSL in a modal. If SSL is enabled, the bot sends the admin a one-time DM asking for an optional CA certificate attachment. Only a DM from `ADMIN_USER_ID` is accepted. The attachment is constrained to a small maximum size, downloaded with an abort timeout, validated as PEM/DER certificate material, and rejected if it contains private-key markers. The source message is deleted after processing; the attachment URL and content are never logged. The encrypted certificate is stored in SQLite, and the active probe is rebuilt immediately.

The request is bound to a target ID, admin user ID, random token hash, and short expiry. Expired requests cannot update a target. A certificate is treated as a CA trust certificate, not a client private key; client certificate/key authentication is deliberately not accepted through this UI.

## Probe contract

Every target maintains one long-lived protocol connection. Each monitoring cycle sends a bounded, non-mutating liveness operation over that connection. On socket/protocol/auth failure, the connection is closed and rebuilt on the next probe. The state machine follows the existing Minecraft semantics: transient failures start a confirmation timer, sustained failures become `DOWN` after `CONFIRM_DOWN_THRESHOLD`, reminders use the existing backoff, and a successful probe records `UP` and closes the persisted downtime session.

| Engine | Connection and probe | SSL behavior |
|---|---|---|
| PostgreSQL | `pg.Client` persistent connection and `SELECT 1`; driver startup must complete before probe is healthy. | `ssl: { rejectUnauthorized: true, ca }` when enabled; system trust applies if no CA is supplied. |
| MySQL/MariaDB | `mysql2/promise` persistent connection and `ping()`; handshake/protocol response is required. | TLS is enabled with certificate verification; supplied CA is used when present. |
| Redis | `node-redis` persistent client and `PING`; requires `PONG`. | `rediss://` or SSL option enables TLS with certificate verification and optional CA. |
| MongoDB | `MongoClient` persistent client and `admin().command({ ping: 1 })`; driver server selection and handshake are bounded. | `tls: true` with system trust or a securely materialized CA path. |

TCP reachability alone is never reported as database online. A socket must complete the appropriate driver/protocol handshake and liveness operation.

## Redaction contract

Driver errors are converted into a safe error message before logging. Redaction removes URI userinfo, passwords, query secrets, DSN tokens, filesystem paths containing certificate names, IPv4/IPv6 literals, hostnames parsed from target metadata, and certificate content. Only a stable engine code and generic reason such as `timeout`, `refused`, `authentication_failed`, or `protocol_error` may reach logs and Discord alerts.

## Runtime lifecycle

`initDatabaseMonitor()` hydrates encrypted targets and creates state objects. `checkDatabaseTargets()` probes all active targets serially or with bounded concurrency, never overlaps a prior cycle, and returns normalized events to `checkCycle`. Runtime config reload destroys/rebuilds database clients when necessary. Graceful shutdown closes every client before the Discord client and SQLite handle.

## Verification gates

The implementation must pass syntax checks, parser/schema tests, crypto round-trip and tamper tests, redaction tests, store tests, config component tests, DM attachment policy tests, state-machine tests with fake drivers, lifecycle tests for reconnect/close, and integration tests for normalized notifications. A separate source scan must assert that plaintext DSNs, certificate bodies, passwords, and attachment URLs do not occur in log/UI paths.
