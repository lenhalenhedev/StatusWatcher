# Database monitoring research notes

## Scope decision

The requested URI examples include `postgres://`, `mongodb://`, `redis://`, and `mysql://`. Therefore the implementation scope includes PostgreSQL, MySQL/MariaDB, Redis, and MongoDB, even though the first support list omitted MongoDB. MongoDB must be supported because the user explicitly specified its URI scheme.

## PostgreSQL

The PostgreSQL libpq documentation states that URI connection strings are accepted and that a successful connection must be checked before sending queries. PostgreSQL's startup flow begins with a frontend opening a TCP connection and sending a startup message; the server then authenticates and ends startup with `ReadyForQuery`. A pure TCP connect therefore proves reachability only, while a protocol-aware probe can prove that the endpoint speaks PostgreSQL and completed startup.

PostgreSQL SSL documentation distinguishes encryption from server identity verification. `require` encrypts but does not provide MITM protection, while `verify-ca` and especially `verify-full` verify trust; `verify-full` is recommended in security-sensitive environments. The node-postgres SSL documentation warns that SSL options in a connection string can replace the separately supplied SSL object, so certificate/SSL override handling must be deliberate.

Sources:

- https://www.postgresql.org/docs/current/libpq-connect.html
- https://www.postgresql.org/docs/current/libpq-ssl.html
- https://www.postgresql.org/docs/current/protocol-flow.html
- https://node-postgres.com/features/ssl

## MySQL/MariaDB

Search results identified official MySQL Developer Zone pages describing the connection-phase handshake, but the two guessed result URLs returned Page Not Found when opened. Do not cite those 404 pages as evidence. The node-mysql2 documentation result was `https://sidorares.github.io/node-mysql2/docs/examples/connections/create-connection`, and the official MySQL reference result was `https://dev.mysql.com/doc/dev/mysql-server/9.7.0/page_protocol_connection_phase_packets_protocol_handshake.html`; both require a follow-up with a valid current URL before implementation claims are made.

MariaDB search results identified official documentation for TLS and the MariaDB Node.js connector. The implementation should avoid relying on a generic TCP success alone and should at minimum validate the database-specific initial handshake or use a maintained official-compatible Node driver.

## Design implication

The monitor should separate `tcp_reachable` from `database_online`. A TCP socket that opens but does not complete the expected protocol handshake must not be reported as healthy. Every probe needs a bounded connect/handshake timeout, deterministic close, redacted errors, and no query that can mutate user data.

## Security implication

Connect strings and certificate contents are secrets. They must never be placed in Discord embeds, interaction replies, logs, exception messages, archive files, or test output. The database list UI should expose only name, engine, host/port-safe metadata or a redacted endpoint, and SSL state. Any certificate upload must be size/type constrained and stored outside source control with restrictive permissions, or the feature must reject unsupported certificate material rather than silently storing it insecurely.

## Redis

Redis official documentation says `PING` returns `PONG` and is useful for testing whether a connection is still alive, verifying the server can serve data, and measuring latency. This supports a non-mutating protocol-level health probe after TCP connect. Redis client TLS configuration requires reconnecting existing connections when TLS parameters change.

Sources:

- https://redis.io/docs/latest/commands/ping/
- https://redis.io/docs/latest/develop/clients/nodejs/connect/
- https://redis.io/docs/latest/operate/rs/security/encryption/tls/enable-tls/

## MongoDB

MongoDB Node.js driver documentation lists `connectTimeoutMS` as the time to establish an individual TCP socket and distinguishes it from `serverSelectionTimeoutMS`, which bounds the overall server selection/connect operation. MongoDB's `hello` command is the protocol-level command for determining server role and status. The driver supports TLS options and connection strings, so the monitor should use the official driver for `mongodb://` and `mongodb+srv://` rather than implementing the wire protocol.

Sources:

- https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/
- https://www.mongodb.com/docs/drivers/node/current/security/tls/
- https://www.mongodb.com/docs/manual/reference/command/hello/
