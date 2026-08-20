# Website Monitoring and Minecraft Retry Migration — Handoff Report

## Scope

This change adds administrator-managed Website targets to `/config`, monitors them in the shared uptime cycle, renders them above the `🗄️ Databases` section, and removes the obsolete Minecraft retry settings. Website targets are stored in SQLite and become active immediately after configuration reload.

## Website configuration

The `/config` view now contains grouped `Add Service` and `Remove Service` controls before the database controls. Each grouped dropdown offers the `Website` option. Selecting it opens the existing add modal or paginated removal selector. Website target identifiers, names, and normalized URLs are persisted through the existing SQLite runtime-config store.

Website status uses Node.js Fetch and reads `Response.status` without consuming the response body. Status codes from 200 through 399 are considered healthy; 400 through 599 are recorded as bounded HTTP failures and are subject to the existing confirmation threshold before a DOWN event is emitted. Redirects are not followed automatically.

## Security behavior

Website URLs are limited to HTTP and HTTPS, reject credentials, fragments, control characters, invalid syntax, and forbidden literal IP addresses. Before Fetch, hostnames are resolved with an all-address lookup and every resolved address is checked against the existing private, loopback, link-local, multicast, and reserved-address policy. Any forbidden address fails closed. Requests use a bounded AbortSignal timeout, `redirect: 'error'`, and response-body cancellation. Embeds and logs do not expose query strings, raw upstream errors, or response bodies.

## Monitoring lifecycle

Website targets are initialized at startup and after runtime configuration changes. Each website receives exactly one probe per shared `CHECK_INTERVAL` cycle. The monitor emits the same confirmation, DOWN, STILL_DOWN, UP, uptime, and stale-state cleanup semantics used by the database monitor. Website event batches are included in the existing notification pipeline, and website state is passed through status-message refresh and pagination.

## Minecraft migration

`MC_RETRY_BASE_MS` and `MC_MAX_RETRIES` were removed from the editable runtime schema, configuration UI, runtime snapshot, and Minecraft monitor call. Legacy SQLite rows are deleted during configuration initialization. `fetchMcStatus` now performs one bounded provider probe per cycle; legacy retry options are ignored. A service failure is not treated as authoritative server-down, and the next probe occurs on the next `CHECK_INTERVAL`, matching the requested database/bot cadence. `MC_STATUS_TIMEOUT_MS` remains available for the single probe timeout.

## Verification

The complete Node.js 24 test suite passed with **147/147 tests**. The new website service, persistence, monitor, embed, configuration-view, and Minecraft migration tests pass. Syntax checks passed for all changed modules. Production dependency audit with `npm audit --omit=dev` reported **0 vulnerabilities** across 149 production dependencies.

The source audit found no live obsolete retry configuration references; remaining occurrences are intentional migration deletion, negative regression assertions, and specification text. URL credential scan found only documentation/test fixtures that are not runtime secrets. The archive excludes `node_modules`, Git metadata, databases, runtime data, logs, and environment-secret files.

## Authoritative references

- [Node.js Fetch and Response documentation](https://nodejs.org/api/globals.html)
- [Discord message and embed limits](https://docs.discord.com/developers/resources/message#embed-limits)
- [Node.js URL documentation](https://nodejs.org/api/url.html)
