# Implementation Plan: MC_ENABLE Feature Flag

## Overview

Add a strict `MC_ENABLE` environment flag that controls Minecraft uptime monitoring. When enabled, the current Minecraft monitoring behavior remains available. When disabled, the bot must not require Minecraft connection settings, must not register or poll the Minecraft target, and must not render Minecraft status content or report a misleading Minecraft health value.

## Assumptions

1. `MC_ENABLE` accepts only `true` or `false` (case-insensitive, with surrounding whitespace ignored); invalid values fail fast.
2. The default is `true` to preserve the existing behavior for deployments that have not yet added the new variable.
3. Disabling the feature is non-destructive: previously persisted Minecraft records are not deleted, but the inactive runtime must not monitor or display them.
4. Existing Minecraft environment variables become conditionally required only when `MC_ENABLE=true`.

## Architecture Decisions

- Keep the flag in the existing central configuration module as `config.mcEnabled`.
- Gate Minecraft at the orchestration boundaries (`index`, `checkCycle`, and `mcMonitor`) so the disabled path avoids initialization and network polling rather than merely hiding output.
- Gate the status embed at its rendering boundary so all status entry points share the same behavior.
- Preserve the existing retry, timeout, and state-transition logic when the feature is enabled; no unrelated refactor or performance optimization is planned.

## Acceptance Criteria

- `MC_ENABLE=true` loads the current Minecraft configuration and keeps Minecraft monitoring active.
- `MC_ENABLE=false` loads without `MC_SERVER_IP`, `MC_SERVER_PORT`, or `MC_SERVER_NAME`, does not call the Minecraft status provider, and does not register/render Minecraft monitoring data.
- Invalid `MC_ENABLE` values fail fast with a clear configuration error.
- `.env.example` documents the flag and its effect.
- Existing tests pass, and new tests cover enabled, disabled, and invalid configurations plus the disabled monitoring path.

## Task List

### Phase 1: Configuration and feature boundary

- [x] Add strict boolean parsing and conditional Minecraft requirements to `src/config.js`.
- [x] Add `MC_ENABLE` documentation to `.env.example`.
- [x] Expose the flag through `config.mcEnabled`.

### Phase 2: Runtime and presentation gating

- [x] Skip Minecraft initialization and initial probe in `src/index.js` when disabled.
- [x] Skip Minecraft checks and Minecraft event handling in `src/core/checkCycle.js` when disabled.
- [x] Guard `src/monitors/mcMonitor.js` as a defensive boundary.
- [x] Omit the Minecraft status field from `src/handlers/embedBuilder.js` when disabled.
- [x] Avoid displaying stale persisted Minecraft targets in target-list/digest output when disabled, if required by the existing flow.

### Phase 3: Regression coverage

- [x] Add configuration tests for default/true, false without Minecraft settings, and invalid values.
- [ ] Add a focused test proving the check runner does not call the Minecraft monitor when disabled; direct runtime import is blocked by the repository's existing `better-sqlite3` segmentation fault on Node 22.13.0.
- [ ] Add status embed coverage for the disabled rendering path; direct renderer import is blocked by the same existing native dependency fault.

### Checkpoint: Complete

- [ ] Full test suite passes; 38/41 tests pass, while three pre-existing database-backed test files fail at module load because of `better-sqlite3` native instability.
- [x] Diff contains no unrelated feature changes.
- [x] Code review covers correctness, readability, architecture, security, and performance.
- [x] A doubt-driven adversarial pass finds no unresolved actionable issue.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Existing deployments omit `MC_ENABLE` | Minecraft monitoring unexpectedly stops | Default to `true` for backward compatibility and document the explicit setting. |
| A stale persisted Minecraft target remains visible | Users may believe disabled monitoring is active | Gate runtime registration and presentation; verify list/digest behavior. |
| Boolean parsing treats arbitrary strings as truthy | Feature may be enabled or disabled accidentally | Accept only `true` and `false`; fail fast otherwise. |
| Disabled mode still makes network calls | Unnecessary external traffic and misleading alerts | Gate initialization and check-cycle invocation, then retain a defensive guard in the monitor. |

## Verification Commands

- `npm test`
- `node --check src/config.js`
- `git diff --check`
