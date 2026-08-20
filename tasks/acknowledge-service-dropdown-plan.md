# Implementation Plan: Acknowledge by Service Dropdown

## Overview

Replace the `/acknowledge incident_id` Discord interface with a service-based string select menu. The store will expose an open-incident lookup keyed by `(service_type, service_id)`, while the command will render and handle the dropdown through the existing component interaction router.

## Architecture Decisions

1. **Service identity is composite.** The selected value encodes a normalized service type and service ID so two service classes cannot collide on the same display ID.
2. **The dropdown is generated from open incidents.** This prevents acknowledging an archived, resolved, or healthy service and avoids a second source of truth for incident state.
3. **Persistence remains incident-centric.** Existing incident IDs and incident event foreign keys stay intact because they are internal history identifiers, not the user-facing command input.
4. **Component authorization is explicit.** A component interaction is checked against the configured admin before any selected value is read or mutation is attempted.
5. **Discord option limits are bounded.** The command renders at most 25 options, with a safe empty-state response when no open incident exists.

## Task List

### Phase 1: Foundation

- [x] Inspect command, router, target registry, incident store, tests, and repository scripts.
- [x] Write the feature specification and assumptions.

### Phase 2: Core Feature

- [x] Add a service-based open-incident query and acknowledgment mutation.
- [x] Replace the `/acknowledge` integer option with a service dropdown and component handler.
- [x] Add focused tests for command registration, authorization, rendering, selection, and stale selections.

### Checkpoint: Core Feature

- [x] Focused acknowledgement and incident tests pass.
- [x] No acknowledge-specific `incident_id` references remain in source/tests/task docs.

### Phase 3: Cleanup and Verification

- [x] Update or remove historical documentation that describes the old `/acknowledge incident_id` contract.
- [x] Run the full test suite and inspect failures.
- [x] Perform code-review and simplification passes.

### Checkpoint: Complete

- [x] Full test suite passes.
- [x] The diff is limited to the requested interface and its direct tests/docs.
- [x] No accidental schema or unrelated command changes are present.
