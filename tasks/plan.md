# Implementation Plan: StatusWatcher Reliability and Modularization

## Overview

This plan addresses the architecture, async-safety, testability, and runtime reliability issues identified in the Discord.js v14 uptime-monitoring bot. The intended behavior is preserved: monitor Discord bots and a Minecraft server, persist uptime and subscriptions, send notifications, expose status embeds and interactions, and retain command features.

The baseline suite currently passes 30 of 33 tests. Three test files fail because importing the SQLite-backed modules causes a native `better-sqlite3` segmentation fault in the supplied Node.js 22.13.0 environment. Static inspection also identified several module-level concerns: the persistence layer is a native crash boundary; asynchronous timer and cron callbacks rely on implicit promise handling; Discord component routing is centralized in the application entrypoint; and stateful operations are spread across modules without explicit lifecycle boundaries.

## Architecture Decisions

1. **Replace the crashing native SQLite binding with Node's built-in `node:sqlite` API.** The project already requires Node.js 22+, and the supplied runtime exposes `DatabaseSync`. This removes a native dependency and preserves the existing synchronous store contracts. The database utility will adapt pragma calls and close semantics while keeping store SQL and behavior stable.
2. **Keep the existing module boundaries unless a focused extraction materially improves ownership.** The codebase is already split into commands, handlers, monitors, services, stores, and utilities. Refactoring will prioritize shared async/error helpers and lifecycle-safe orchestration rather than gratuitous file churn.
3. **Make background work explicitly observed.** Interval and cron callbacks will invoke a safe async wrapper that catches and logs failures. Event listeners will remain bounded by one top-level error boundary, with response failures handled separately.
4. **Preserve interaction and persistence contracts first.** Existing tests define exact user-facing error strings and status pagination behavior. New regression tests will cover queue recovery, database CRUD, and callback rejection containment where practical.
5. **Optimize only measured bottlenecks.** The primary measurable issue is the crashing persistence dependency, not an evidenced hot-path latency problem. No speculative memoization or broad caching will be introduced.

## Audit Findings

| Area | Finding | Severity | Planned treatment |
|---|---|---:|---|
| Persistence | `better-sqlite3` segfaults on direct import under Node 22.13.0, preventing three test files from running | Critical | Migrate to `node:sqlite`; remove the native dependency |
| Async lifecycle | Timer/cron callbacks call async functions without an explicit catch boundary | Required | Add a reusable safe background-task wrapper and use it for scheduled work |
| Shutdown | Shutdown is generally bounded, but close operations and login failure paths should be idempotent and consistently observed | Required | Tighten lifecycle helper usage while preserving current order |
| State coordination | Monitor state is module-global and database writes are synchronous; cycle reentrancy is guarded but individual state updates are not abstracted | Medium | Preserve state model; document and test the cycle guard and persistence contracts |
| Interaction routing | Entry-point routing contains fallback scanning and command-specific behavior | Medium | Extract a small interaction router without changing command interfaces |
| Discord.js modernization | Builder usage is already present in most command modules; intents include only currently used gateway capabilities | Low | Verify rather than rewrite; avoid unnecessary changes |
| Performance | The check cycle is already non-reentrant; status message updates have a serial queue | Low/Positive | Retain these guards and add regression coverage rather than speculative optimization |

## Task List

### Phase 1: Persistence Foundation

- [ ] Task 1: Replace `better-sqlite3` with `node:sqlite` in the database utility and package metadata.
- [ ] Task 2: Run database-backed tests in isolation and verify CRUD semantics, schema creation, pragmas, and close behavior.

### Checkpoint: Persistence

- [ ] All database-backed tests pass without a native crash.
- [ ] No store API changes are required by existing callers.

### Phase 2: Async and Lifecycle Hardening

- [ ] Task 3: Add a focused safe background-task helper that observes rejected promises and logs context.
- [ ] Task 4: Route interval and cron callbacks through the helper; preserve the existing check-cycle reentrancy guard and refresh queue.

### Checkpoint: Runtime Safety

- [ ] Existing tests pass.
- [ ] A focused rejection test proves scheduled callback failures do not become unhandled rejections.

### Phase 3: Routing and Structural Cleanup

- [ ] Task 5: Extract interaction dispatch from `src/index.js` into a focused module with the same command/component contracts.
- [ ] Task 6: Remove only confirmed duplication or dead code discovered during implementation; keep unrelated behavior unchanged.

### Checkpoint: Architecture

- [ ] Command, component, and autocomplete dispatch behavior remains covered by tests or direct smoke checks.
- [ ] The entrypoint remains readable and owns lifecycle setup only.

### Phase 4: Verification and Review

- [ ] Task 7: Run the full test suite, syntax checks, package audit, and targeted runtime imports.
- [ ] Task 8: Perform a five-axis code review and an adversarial doubt pass; fix actionable findings and simplify only behavior-preserving changes.
- [ ] Task 9: Record measured results and package the refactored repository.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `node:sqlite` is experimental in the supplied runtime | Medium | Pin the minimum Node version to the first supported built-in API range and test all existing SQL operations |
| SQLite API differences in named parameters or result metadata | High | Run every database-backed test and add focused smoke checks for `run().changes`, `.get()`, and `.all()` |
| Background wrapper hides failures | Medium | Log every rejection with a task label and keep the wrapper return contract explicit |
| Router extraction changes interaction behavior | Medium | Move logic mechanically first and preserve the existing dispatch order and fallback behavior |
| Refactoring scope expands beyond the prompt | Medium | Keep changes limited to proven failures, async boundaries, and clearly owned structural improvements |

## Open Questions

- None blocking implementation. The supplied prompt asks for implementation delivery, so the work will proceed with the existing business behavior as the compatibility contract.
