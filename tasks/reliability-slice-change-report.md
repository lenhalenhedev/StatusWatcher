# StatusWatcher Reliability Slice: Change and Scope Report

## Scope

This slice implements the first bounded reliability improvement selected from the Uptime Kuma comparison: a unified, privacy-safe probe-evidence contract for every active monitor family. The implementation preserves the project philosophy of being Discord-first, small-team oriented, fast, low-dependency, and operationally focused.

The latest complete StatusWatcher baseline was restored from the verified `StatusWatcher-help-ping.zip` archive before implementation because the working directory was incomplete. A local pre-restore copy was preserved outside the release source. The archive restoration itself did not intentionally change product behavior; it recovered the complete current baseline so the new changes could be tested against the real application.

## Changes made

| File | Change | Reason |
|---|---|---|
| `src/utils/db.js` | Extended the latency/probe schema with `probe_status`, `error_category`, and `retry_index` columns and compatible indexes/migration logic. | Persist bounded evidence for pending, online, down, still-down, and recovery states without breaking existing rows. |
| `src/store/latencyStore.js` | Added strict validation and persistence for probe status, allowlisted error categories, and bounded retry indexes. | Prevent raw errors, unbounded values, invalid identifiers, and unsafe metadata from entering SQLite. |
| `src/services/probeEvidenceService.js` | Added a shared adapter that maps monitor success and health-event types to the unified evidence contract. | Avoid protocol-specific duplication and ensure website, Minecraft, database, and bot monitors use the same validation boundary. |
| `src/monitors/websiteMonitor.js` | Routed successful, failed, pending, confirmed-down, still-down, and recovery evidence through the shared adapter. | Preserve existing website health transitions while recording consistent evidence and duration. |
| `src/monitors/mcMonitor.js` | Added evidence for upstream failure, online, pending offline, confirmed down, still down, and recovery paths. | Extend the evidence model to Minecraft without changing its existing threshold or event semantics. |
| `src/monitors/databaseMonitor.js` | Added evidence for successful database probes and classified connection/timeout failures. | Reuse the existing safe database error classifier while preserving persistent client and health behavior. |
| `src/monitors/botMonitor.js` | Added evidence for online, pending offline, confirmed down, still down, and recovery presence states. | Make Discord bot monitoring visible in the same bounded reliability data model. |
| `test/probeEvidence.test.js` | Added integration coverage for shared-adapter status mapping and safe retry metadata. | Prove deterministic mapping, safe categories, pending behavior, recovery behavior, and absence of raw error storage. |

## New evidence contract

Each recorded sample contains only bounded operational metadata:

```text
service_id
service_type
observed_at
 duration_ms
 success
 status_code
 probe_status
 error_category
 retry_index
```

The adapter derives `probe_status` as follows:

| Input | Stored status |
|---|---|
| `success: true`, no transition | `ONLINE` |
| `success: false`, no confirmed transition | `PENDING` |
| `eventType: DOWN` | `DOWN` |
| `eventType: STILL_DOWN` | `STILL_DOWN` |
| `eventType: UP` | `UP` |

The error category is accepted only when it belongs to the existing safe allowlist. Raw exception messages, URLs, IP addresses, credentials, certificate content, driver payloads, and response bodies are not persisted by this layer.

## Why this design was selected

The evidence layer is deliberately separate from the incident manager. A monitor can produce a failed or pending probe without opening a health incident. The existing confirmation threshold continues to decide when a real `DOWN` incident is opened. This separation prevents a single transient failure from becoming an incident while still retaining enough bounded evidence to understand what happened.

The new adapter also avoids changing protocol-specific monitor contracts. HTTP, Minecraft, database, and Discord presence probes continue to own their own connection and state behavior. They only submit normalized evidence after their existing decision is made. This keeps the hot path simple and makes future retry instrumentation possible without forcing all monitors to share protocol logic.

The evidence record is bounded by the existing latency-store validation and retention mechanisms. Invalid status values, unsafe categories, oversized identifiers, negative or non-finite durations, and retry indexes outside the permitted range are rejected before SQLite mutation.

## Retry decision in this slice

This slice adds the **data contract** for `retry_index` and verifies its bounds, but it does not introduce automatic transport retries in production monitors. Real monitor calls currently record retry index `0`.

This is intentional for three reasons:

1. StatusWatcher previously removed the old Minecraft retry settings and explicitly aligned failure handling with `CHECK_INTERVAL` plus the confirmation threshold.
2. Retrying a complete monitor function can accidentally mutate health state more than once, duplicate database connection work, or change incident timing.
3. The safer next step is to introduce a pure, bounded retry runner with explicit idempotency and per-protocol tests rather than silently changing alert timing in the monitoring hot path.

Therefore, `PENDING` currently means that the probe failed or the target is in the existing confirmation window, not that an unbounded transport retry loop is running.

## Security and privacy controls preserved

The implementation continues to use the incident manager's safe error-category allowlist and the latency store's strict service-type and identifier validation. Database failures use the existing database error classifier. Minecraft failures are recorded only as `MINECRAFT_CONNECTION_FAILED`. Bot presence failures use the generic safe `UNKNOWN` category because no more specific network error exists.

No new log output contains raw errors. No evidence row contains raw endpoint data, connection strings, passwords, response bodies, certificate contents, or upstream diagnostic payloads. Duration and status code are retained only as bounded operational metadata.

## Performance characteristics

The shared adapter performs one prepared SQLite insert per actual monitor probe. It does not add network requests, does not read response bodies, does not create additional timers, and does not introduce a new background worker. Existing per-service retention caps continue to prevent unbounded growth.

The database monitor retains its existing persistent-client behavior. The Minecraft monitor retains its current sequential configured-server checks. The bot monitor remains cache-based and does not reintroduce guild-wide member fetching.

## Intentionally unchanged

The following areas were deliberately not changed in this slice:

| Area | Why unchanged |
|---|---|
| Discord-only notification strategy | The project is intentionally not expanding into Telegram, Gotify, Slack, Pushover, SMTP, or other provider integrations. |
| Incident state machine | Existing `OPEN`, `ACKNOWLEDGED`, and health `RESOLVED` semantics are already a core strength and were not rewritten. |
| Confirmation threshold behavior | It remains the authority for converting transient failures into confirmed incidents. |
| Automatic network retry timing | Deferred until a dedicated idempotent retry runner is specified and tested. |
| Maintenance recurrence | Current maintenance windows remain one-shot. Recurring schedules require timezone, restart recovery, occurrence identity, and overlap semantics that deserve a separate slice. |
| Housekeeping scheduler | No new background deletion worker was added. Existing bounded pruning remains in place until a single coordinated housekeeping policy is specified. |
| Web dashboard and public status page | These would materially expand authentication, frontend, API, and deployment scope and do not fit the current small-team Discord-first goal. |
| Generic webhook | Deferred until a concrete second-channel requirement exists. |
| Monitor protocol breadth | No new monitor types were added merely to match Uptime Kuma's feature count. |
| TLS, SLO, dependency, audit, ownership, and dry-run contracts | Existing implementations were preserved; this slice only feeds normalized probe evidence into the existing reporting foundation. |

## Verification

The implementation was checked under Node.js `v24.19.0` using the project's pinned runtime.

| Check | Result |
|---|---:|
| Focused probe, latency, website, database-state, and Minecraft tests | Passed |
| Full repository test suite | **203/203 passed** |
| Test failures | **0** |
| JavaScript syntax checks for changed runtime modules | Passed |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Raw error/secret persistence tests | Passed |
| Invalid evidence/category/retry boundary tests | Passed |

## Recommended next slice

The next implementation should be a dedicated pure bounded retry runner, not ad hoc retries inside each monitor. It should accept an injected probe function, a maximum attempt count, a bounded delay policy, an allowlisted retry decision, and an idempotent result contract. It should be integrated one monitor family at a time, beginning with website probes, and must prove that pending failures do not create duplicate incidents or duplicate notifications.

Recurring maintenance and centralized housekeeping should follow only after their persistence contracts are specified. This sequencing keeps the project small, avoids state explosion, and preserves the principle that every new feature must be bounded, observable, testable, and useful to the intended Discord-based operator group.
