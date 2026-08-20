# Config Service Dropdown Checklist

## Slice 1: View contract

- [ ] Replace separate service items with Add Service, Remove Service, and Config.
- [ ] Add bounded service-type select menu builders.
- [ ] Add bounded runtime-config select menu builder.
- [ ] Preserve website-before-database ordering in descriptions and remove selectors.
- [ ] RED/GREEN focused view tests.

## Slice 2: Interaction routing

- [ ] Route Add Service selections to the existing MC, Website, and Database modals.
- [ ] Route Remove Service selections to the existing MC, Website, and Database selectors.
- [ ] Route Config selections to the existing scalar modal builder.
- [ ] Reject unknown service/config values safely.
- [ ] Preserve admin authorization and ephemeral/deferred interaction behavior.
- [ ] RED/GREEN focused command tests.

## Slice 3: Immediate application contract

- [ ] Verify all scalar modal keys use schema parsing and serialization.
- [ ] Verify SQLite write precedes runtime reload.
- [ ] Verify monitor initialization/removal and status-message refresh remain wired.
- [ ] Add outcome-based tests for each setting family and service type.

## Slice 4: Repository audit

- [ ] Search source and tests for old top-level service labels/custom IDs.
- [ ] Search all tracked source/test/docs for Vietnamese text and translate findings.
- [ ] Scan for secrets, raw connection strings, certificate material, and unsafe logs.
- [ ] Run syntax checks on all changed modules.
- [ ] Run focused suites, then full Node.js 24 suite.
- [ ] Run npm audit and validate archive contents if packaging is requested.

## Final checkpoint

- [ ] All acceptance criteria in `config-service-dropdown-plan.md` are satisfied.
- [ ] No unrelated behavior changed.
- [ ] Report exact tests and any non-blocking findings to the user.
