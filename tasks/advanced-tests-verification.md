# Advanced Test Coverage Verification

## Scope

This slice adds advanced unit coverage for SQLite migration durability and network failure edge cases. No production implementation files were changed in this slice. The tests exercise the existing safety contracts rather than bypassing them.

## SQLite migration durability

`test/migrationDurability.test.js` adds six cases covering fresh schema bootstrap, legacy `latency_samples` upgrades, preservation of existing rows, idempotent reopening, partial metadata migrations, post-migration evidence writes, and foreign-key cascade behavior. An incompatible `latency_samples` shape is also verified to fail closed instead of being silently rewritten.

The migration tests use isolated temporary databases and child-process imports so SQLite state and ESM module caching cannot leak between cases.

## Network edge cases

`test/networkEdgeCases.test.js` adds seventeen cases covering:

- HTTP DNS failures, malformed DNS results, IPv6 SSRF rejection, URL-length boundaries, invalid status values, timeout-code mapping, body-cancellation failures, and non-callable fetch implementations.
- DNS client capability validation, null/non-array/oversized responses, MX priority bounds, TXT chunk joining, empty and overlong values, timeout separation, safe upstream-error mapping, and validation-code preservation.
- TLS lookup and connection error mapping, forbidden destinations, missing and invalid certificates, authorization reporting, timeout and hard-timer cleanup, socket destruction, and double-settlement protection.

All assertions target bounded error codes and safe messages; raw endpoint, credential, and upstream error text is not accepted in returned results.

## Verification results

| Check | Result |
|---|---:|
| Focused migration and network tests | **23/23 passed** |
| Full repository suite | **226/226 passed** |
| English-source and deprecation checks | **2/2 passed** |
| `npm audit --omit=dev --audit-level=moderate` | **0 vulnerabilities** |
| Runtime used | **Node.js v24.19.0 via NVM** |

Commands used:

```bash
. "$HOME/.nvm/nvm.sh" && nvm use 24
TOKEN=test-token CLIENT_ID=123456789012345678 \
GUILD_ID=123456789012345678 ADMIN_USER_ID=123456789012345678 \
node --test test/migrationDurability.test.js test/networkEdgeCases.test.js

TOKEN=test-token CLIENT_ID=123456789012345678 \
GUILD_ID=123456789012345678 ADMIN_USER_ID=123456789012345678 \
npm test

node --test test/englishSource.test.js
npm audit --omit=dev --audit-level=moderate
```

The incompatible-schema test intentionally emits the SQLite diagnostic on the child process's standard error while asserting that the parent test observes a failed bootstrap. This is expected fail-closed behavior, not an unhandled test failure.

The repository still contains three unrelated pre-existing trailing-whitespace lines in `src/commands/configView.js`, `src/handlers/notifier.js`, and `test/databaseSchema.test.js`; they were not changed because they are outside this advanced-test slice.
