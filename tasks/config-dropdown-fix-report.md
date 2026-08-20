# Grouped `/config` Redesign — Handoff Report

## Scope

The configuration interface now groups service operations under `Add Service` and `Remove Service`. Each grouped dropdown offers `MC`, `Website`, and `Database`, after which the existing service-specific modal or removal selector is opened. Runtime settings are grouped under a `Config` dropdown containing Important Role, Monitor Channel, Log Channel, CHECK_INTERVAL, CONFIRM_DOWN_THRESHOLD, CHECK_INTERVAL_DISPLAY_LOG, STILL_DOWN_BACKOFF, MC_STATUS_TIMEOUT_MS, and DAILY_DIGEST_CRON.

## Runtime application contract

Every scalar configuration modal continues to parse and validate through `runtimeConfigSchema`, persist the serialized value in SQLite, reload the runtime snapshot, and refresh the affected monitor/status pipeline immediately. Service add/remove flows likewise persist the change and initialize or remove the corresponding monitor state before refreshing the status message. No process restart is required for a valid change to take effect.

The grouped UI preserves administrator authorization, ephemeral interaction behavior, bounded Discord component counts, back navigation, and the existing Minecraft, Website, and Database persistence contracts. Unknown service types and runtime keys are rejected without invoking a modal or performing a store write.

## Migration and language consistency

The flat service controls were removed from the top-level configuration view. Documentation and environment-example wording was updated to describe grouped service selection. The two obsolete Minecraft retry settings remain absent from the editable runtime schema and UI; the only remaining runtime reference is the intentional startup cleanup of a legacy SQLite key, with negative tests documenting that the key is rejected.

The repository scan found no Vietnamese prose in source, tests, tasks, or the environment example. The scanner excluded the intentional Vietnamese-character detector regex and non-Vietnamese Unicode fixtures such as an IDN test domain.

## Verification

The focused grouped view, interaction routing, existing configuration, and schema tests passed. The complete Node.js 24 suite passed with **156/156 tests**. JavaScript syntax checks and `git diff --check` passed. Production dependency audit with `npm audit --omit=dev` reported **0 vulnerabilities**.

The first full-suite attempt exposed a test-fixture defect rather than a product defect: `configCommandGroupedFlow.test.js` hardcoded an admin ID while another test process had already initialized runtime configuration from the exported `ADMIN_USER_ID`. The fixture was corrected to use the process bootstrap admin ID, and the full suite then passed without changing production authorization logic.

The final archive was checked with `unzip -tq`. It excludes `node_modules`, Git metadata, runtime databases, data directories, logs, and `.env` secrets. The archive SHA-256 is:

```text
277a3dad035f860e9a7bd6bc258084dd4c99cbbe30471511f41b087034cbe26a
```

## Changed areas

| Area | Result |
|---|---|
| `src/commands/configView.js` | Grouped Add Service, Remove Service, and Config dropdown builders |
| `src/commands/configCommand.js` | Strict grouped routing to existing modals/selectors and runtime-setting flow |
| `src/config/runtimeConfigSchema.js` | English-only configuration descriptions and allowlisted runtime keys |
| Tests | Grouped view/routing regressions plus corrected full-suite bootstrap fixture |
| Documentation | Cross-file control terminology and migration wording aligned |
