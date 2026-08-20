# Website Monitoring and Minecraft Retry Migration Specification

## Scope

Add administrator-managed website targets to `/config`. Each website has a display name and an HTTP/HTTPS URL, is persisted in SQLite, is loaded into runtime configuration immediately, appears in the status embed before `🗄️ Databases`, and participates in the shared uptime event pipeline. Remove `MC_RETRY_BASE_MS` and `MC_MAX_RETRIES` from runtime configuration and stop passing them to Minecraft probes. Minecraft checks must continue once per `CHECK_INTERVAL` cycle and use the existing shared confirmation, DOWN, STILL_DOWN, and UP state flow.

## Website configuration contract

| Item | Contract |
|---|---|
| Add control | `/config` button `Add Service`, then the `Website` option, administrator only |
| Add modal | Required display name and required URL |
| Remove control | `/config` button `Remove Service`, then the `Website` option and a paginated select menu when needed |
| Persistence | SQLite table `website_targets`; stable generated ID; unique URL; created/updated timestamps |
| Immediate application | Save, register target, reload monitor state, refresh status message without restart |
| Status order | Website section first, then `🗄️ Databases`, then Minecraft, then bots |
| Probe interval | Shared monitoring cycle controlled by `CHECK_INTERVAL` |
| Probe result | Use the Fetch `Response.status` integer; status 200–399 is UP, status 400–599 is DOWN |
| Redirects | `redirect: 'error'`; redirects are not followed to prevent an unvalidated second destination |
| Response body | Never read or log the response body; cancel it when available |
| Timeout | Fixed bounded request timeout of 15 seconds; timeout maps to a safe category and DOWN flow |
| User output | Display name, URL origin/path without credentials, status code when present, uptime and downtime metrics; cap all Discord fields |

## URL validation and SSRF policy

Only `http:` and `https:` URLs are accepted. Credentials, fragments, blank hosts, unsupported schemes, control characters, and URLs longer than 2,048 characters are rejected. Query strings and paths are allowed because website monitoring commonly targets a health endpoint, but the normalized URL must never contain userinfo. The hostname is resolved before each check and every resolved IPv4/IPv6 address is rejected if it is private, loopback, link-local, multicast, documentation-only, unspecified, or otherwise reserved according to the existing network safety utility. Redirects are forbidden. Raw URL, resolved address, response body, authorization material, and raw upstream exception text must not be logged or included in Discord errors.

This policy accepts public website monitoring while preventing obvious localhost, cloud metadata, private-network, and redirect-based SSRF. Because ordinary Fetch can resolve DNS again after validation, the monitor must document that validation is best-effort and should not be treated as a complete defense against hostile DNS rebinding; the target is administrator-only and address validation occurs before every probe.

## State and event contract

Website state mirrors database state: `id`, `name`, `url`, `isConfirmedDown`, `firstSeenOffline`, `confirmedDownAt`, `lastHealthyAt`, `lastStatus`, `lastError`, `lastStillDownNotifiedAt`, and `stillDownRemindersSent`. An unsuccessful probe starts the existing `CONFIRM_DOWN_THRESHOLD` timer. Before confirmation, status is shown as CHECKING. After confirmation, the shared cycle emits DOWN and subsequent reminder events; a successful response emits UP when recovering and clears the failure state. Every website target is registered with the common uptime tracker using type `website`.

## Minecraft migration contract

`MC_RETRY_BASE_MS` and `MC_MAX_RETRIES` are removed from `RUNTIME_CONFIG_DEFINITIONS`, `/config` UI, bootstrap defaults, runtime snapshot, and scalar value display. Existing legacy SQLite rows for those keys are ignored and may be deleted during migration. `mcMonitor` calls `fetchMcStatus` without retry options; each server is probed once during each shared `CHECK_INTERVAL` cycle. Existing `MC_STATUS_TIMEOUT_MS`, `CONFIRM_DOWN_THRESHOLD`, `STILL_DOWN_BACKOFF`, uptime tracking, and alert batching remain unchanged.

## Acceptance and threat matrix

| Case | Expected behavior |
|---|---|
| Valid HTTPS/HTTP public URL | Persist, monitor, and display target |
| Missing/invalid URL | Generic configuration failure; no database row and no network call |
| URL with credentials, fragment, control character, unsupported scheme, or excessive length | Reject before network access |
| localhost, loopback, private, link-local, multicast, documentation, or unspecified address | Reject before network access |
| Public response 200, 204, 301/302 with redirect disabled, or 399 | UP based on `Response.status` |
| Response 400–599 | Failure state; eventually DOWN after threshold; status code shown safely |
| Timeout, DNS failure, connection reset, invalid response | Safe error category; no raw error text disclosed |
| Redirect response | Safe failure; no second URL request |
| Large response body | Never consumed; bounded and canceled |
| More than 25 website targets | Paginated Website selector under Remove Service and a bounded status field |
| Non-admin interaction | Rejected with ephemeral authorization response |
| Legacy MC retry settings present in SQLite or environment | Not exposed in `/config`; no retry options passed to probe client |
| Existing bot/database/Minecraft tests | No behavior regression |

## Files expected to change

`src/store/runtimeConfigStore.js`, `src/config.js`, `src/config/runtimeConfigSchema.js`, `src/commands/configView.js`, `src/commands/configCommand.js`, `src/monitors/websiteMonitor.js`, `src/services/websiteStatusClient.js`, `src/core/checkCycle.js`, `src/handlers/embedBuilder.js`, `src/services/statusMessage.js`, `src/index.js`, relevant tests, and deployment documentation if configuration examples mention removed settings.

## References

1. [Node.js Global objects documentation](https://nodejs.org/api/globals.html)
2. [Discord Message Resource — Embed Limits](https://docs.discord.com/developers/resources/message#embed-limits)
