# Incident ID Alert Fix — Three-Pass Verification

## User-reported symptom

The Discord log alert showed only:

- `EternalGhost is now DOWN`
- `EternalGhost` / `Server Bot`
- `EternalGhost — Still DOWN`
- `Server Bot — down for 1 min`

Neither the DOWN nor STILL_DOWN alert exposed the durable incident identifier needed for incident correlation and history. The current `/acknowledge` flow does not require operators to enter that identifier; it uses a service dropdown.

## Audit findings

The project was traced through four boundaries:

1. `incidentManager` creates or reuses the SQLite incident and returns the row with its numeric `id`.
2. `checkCycle` receives the transition and attaches `transition.incident.id` to DOWN, STILL_DOWN, and UP items for bots, Minecraft, websites, and databases.
3. `notifier` passes the items to the alert embed builders without removing fields.
4. The alert embed builders render the ID when present. A final fallback now resolves the active `OPEN` or `ACKNOWLEDGED` incident by deterministic service type and item ID if an upstream payload arrives without `incidentId`.

The previous test suite covered synthetic embed items and captured check-cycle arrays, but it did not exercise the real bot → SQLite incident → check runner → notifier → Discord-like channel path. That coverage gap allowed the user-visible symptom to go undetected.

## Corrected behavior

For a real bot outage, the DOWN alert now contains:

```text
Server Bot
Incident ID: `<id>`
```

The STILL_DOWN alert contains the same durable ID. The ID remains available while the incident is `ACKNOWLEDGED`; selecting the service suppresses repeated STILL_DOWN communication but does not remove or replace the incident. The same ID is retained for UP recovery correlation.

The final renderer fallback is fail-safe. It accepts only a positive safe integer from the payload or an active SQLite incident lookup. It does not print raw endpoints, credentials, exception text, or other sensitive values.

## Changed files

| File | Change |
|---|---|
| `src/handlers/embedBuilder.js` | Alert builders now resolve an active incident ID from `type` + `id` when the payload lacks `incidentId`; documentation updated accordingly. |
| `test/incidentAlertIntegration.test.js` | Added real SQLite/check-cycle/notifier/channel regression coverage for bot DOWN and STILL_DOWN alerts, plus final-renderer fallback coverage. |
| `tasks/incident-alert-id-three-pass-verification.md` | Added this report. |

## Three independent verification passes

| Pass | Scope | Result |
|---|---|---:|
| 1 | Incident manager, SQLite store, check cycle, notifier, bot alert integration, acknowledgment, commands, and persistent embed tests | **19/19 passed** |
| 2 | Complete repository test suite | **233/233 passed** |
| 3 | Production-path source audit, dependency audit, whitespace scan, and sensitive-value scan | **Passed**; `npm audit --omit=dev` found **0 vulnerabilities** |

Runtime: **Node.js v24.19.0 via NVM**.

The only token-like text found in the test corpus is the intentional redaction fixture `token=do-not-show-this`; no credential or secret was added.
