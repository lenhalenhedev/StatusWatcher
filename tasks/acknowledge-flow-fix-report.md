# `/acknowledge` Incident Flow Fix

## Previous behavior and root cause

`/acknowledge` changed an incident from `OPEN` to `ACKNOWLEDGED`, but the monitoring cycle did not consult that state when deciding whether to deliver `STILL_DOWN` reminders. The command previously required a SQLite incident ID, which made the operator locate and copy an internal identifier from an alert. The command now presents a service dropdown and resolves the current open incident by `(service_type, service_id)`.

## Correct behavior

Acknowledgment is a **communication control**, not a health-state override. The service continues to be probed normally. Acknowledged incidents remain active in SQLite and remain eligible for recovery detection. Repeated `STILL_DOWN` reminders are suppressed while the incident is `ACKNOWLEDGED`.

When the next successful probe emits `UP`, the incident transitions to `RESOLVED` with the `HEALTH_RECOVERY` timeline reason, regardless of whether it was acknowledged. An UP recovery alert is still delivered. The incident does not remain acknowledged forever.

## Implementation changes

| File | Change |
|---|---|
| `src/core/checkCycle.js` | Retains the incident transition result, adds `incidentId` to DOWN/STILL_DOWN/UP alert items, and suppresses STILL_DOWN delivery for acknowledged incidents only. |
| `src/incidents/incidentManager.js` | Preserves `ACKNOWLEDGED` across duplicate DOWN transitions instead of silently reverting it to OPEN. UP still always resolves the incident. |
| `src/handlers/embedBuilder.js` | Displays the durable incident ID in DOWN, STILL_DOWN, and UP summary fields for incident correlation and history. |
| `src/commands/acknowledge.js` | Explains that reminders are suppressed, monitoring continues, and UP automatically resolves the incident. |
| `test/incidentAcknowledgementFlow.test.js` | Adds regression coverage for acknowledgment semantics, incident ID propagation, and recovery. |
| `test/incidentCommands.test.js` | Verifies the command response documents the behavior accurately. |

## Verification

| Check | Result |
|---|---:|
| Focused incident tests | **16/16 passed** |
| Full repository suite | **229/229 passed** |
| English/deprecation checks | **2/2 passed** |
| Dependency audit | **0 vulnerabilities** |
| Changed-file whitespace scan | **Passed** |
| Changed-file sensitive-value scan | **Passed** |
| Runtime | **Node.js v24.19.0 via NVM** |

The fix does not add raw endpoint, credential, or upstream-error data to logs or Discord responses. Incident IDs remain bounded SQLite identifiers for internal correlation and history; the administrator-facing `/acknowledge` flow no longer requires operators to enter them.
