# Config Service Dropdown Redesign

## Goal

Replace the six separate service buttons in `/config` with two grouped flows: `Add Service` and `Remove Service`. Each flow first presents a service-type dropdown containing `MC`, `Website`, and `Database`, then delegates to the existing add modal or remove selector. Replace the flat scalar-setting buttons with one `Config` button that opens a dropdown containing the nine supported runtime settings. Every successful change must remain SQLite-backed and apply immediately through the existing runtime reload and monitor/status refresh pipeline.

## Dependency graph

1. `src/config/runtimeConfigSchema.js` remains the single source of truth for the nine editable runtime keys and validation.
2. `src/commands/configView.js` exposes the top-level buttons and second-level dropdown components.
3. `src/commands/configCommand.js` routes grouped component IDs, shows existing modals/selectors, persists values, and calls `refreshAfterConfigChange`.
4. Existing stores and monitor refresh functions remain the persistence/runtime boundary; no direct environment mutation is introduced.
5. Existing status-message callbacks continue to receive all bot, Minecraft, database, and website providers.

## Acceptance criteria

- [ ] Top-level config controls contain exactly `Add Service`, `Remove Service`, and `Config` for service/config management; legacy separate add/remove service controls are absent.
- [ ] Add Service dropdown offers exactly MC, Website, Database and opens the corresponding existing modal.
- [ ] Remove Service dropdown offers exactly MC, Website, Database and opens the corresponding existing bounded selector.
- [ ] Config dropdown offers exactly the nine runtime settings: Important Role, Monitor Channel, Log Channel, CHECK_INTERVAL, CONFIRM_DOWN_THRESHOLD, CHECK_INTERVAL_DISPLAY_LOG, STILL_DOWN_BACKOFF, MC_STATUS_TIMEOUT_MS, DAILY_DIGEST_CRON.
- [ ] Each scalar setting continues to validate through `RUNTIME_CONFIG_DEFINITIONS`, persist in SQLite, call `reloadRuntimeConfig()`, refresh applicable monitor state, and refresh the status message in the same interaction.
- [ ] Component IDs are namespaced under `config:` and are bounded to Discord component limits.
- [ ] Non-admin users remain rejected for every new and legacy-looking `config:` interaction.
- [ ] No credentials, certificate data, connection strings, raw endpoint secrets, or internal stack traces are exposed by the new flow.
- [ ] Repository source and tests contain no Vietnamese text after the change.

## Compatibility policy

The new custom-ID contract is authoritative. Existing persisted targets and runtime values remain untouched. A defensive handler may reject old action IDs rather than exposing an alternate untested UI path; no obsolete button is rendered.

## Verification

Focused tests cover view shape, dropdown options, routing, modal/select delegation, persistence and immediate refresh. The full Node.js 24 suite, syntax checks, source-language scan, secret scan, and production dependency audit are required before delivery.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Discord component limits | Use three top-level buttons plus second-level select menus; keep each select to three options. |
| Wrong service routing | Use explicit allowlists for service type values and test each branch. |
| Runtime value saved but not applied | Assert the existing reload and monitor/status refresh path for every scalar key. |
| Authorization bypass through custom IDs | Keep the admin check at the start of `handleInteraction`; test all grouped routes as non-admin. |
| Accidental legacy control leakage | Add source and view tests asserting old IDs/labels are not rendered. |
| Mixed-language source | Scan all tracked source, test, and task-relevant text and translate any discovered Vietnamese strings. |
