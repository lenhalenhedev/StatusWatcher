# Spec: `/acknowledge` Service Dropdown

## Objective

Change the administrator-only Discord `/acknowledge` command so it no longer accepts the SQLite `incident_id` option. The command must instead display a Discord string-select dropdown containing currently open incidents, labeled with the monitored service name and type (`bot`, `website`, `database`, or `minecraft`). Selecting a service acknowledges that service's current open incident and preserves the existing incident state transition and reminder-suppression behavior.

The incident database continues to use its internal numeric primary key for event history and persistence. This change is limited to the Discord acknowledgement interface and its service-based lookup path; unrelated incident history, embeds, and `/resolve-incident` behavior remain unchanged.

## Assumptions

1. The dropdown should show only services with an incident currently in `OPEN` state, because acknowledging a service without an active problem is not useful.
2. The existing configured-admin restriction remains unchanged.
3. The existing acknowledgment transition remains `OPEN` → `ACKNOWLEDGED`, with the same event audit fields and response semantics.
4. Discord's maximum of 25 select options applies; the command will cap options at 25 and return a clear message when no open incidents exist.
5. Service identity is the pair `(service_type, service_id)`, not the display name and not the internal incident primary key.

## Commands

- Focused tests: `npm test -- --test-name-pattern='acknowledge|incident'`
- Full tests: `npm test`
- Syntax/build-equivalent verification: `npm test`

## Project Structure

- `src/commands/acknowledge.js`: slash-command definition, dropdown rendering, and component handler.
- `src/store/incidentStore.js`: service-based open-incident query and acknowledgment mutation.
- `test/incidentCommands.test.js`: command registration, authorization, dropdown, selection, and error paths.
- `test/incidentAcknowledgementFlow.test.js`: state/event regression coverage.
- `tasks/`: implementation plan, checklist, and historical task notes.

## Code Style

Use the repository's ESM JavaScript style and Discord.js builders. Keep the service value opaque to users while encoding both service type and service ID in a bounded select value. Validate the selected service against the store rather than trusting display text.

```js
const selectedService = interaction.values?.[0];
const incident = acknowledgeIncidentForService(selectedService, interaction.user.id);
```

## Testing Strategy

Tests will cover command shape (no `incident_id` option), administrator authorization, empty dropdown state, option labels/values for all supported service types, successful service selection, unknown/stale selection, repeated acknowledgment, and preservation of the incident event/state transition. Existing full-suite tests must remain green.

## Boundaries

- Always: retain admin authorization, validate service identity, preserve incident audit behavior, and run focused plus full tests.
- Ask first: database schema changes, dependency changes, or changing `/resolve-incident`.
- Never: delete the incident primary key from persistence, remove incident event history, trust arbitrary component values, or weaken authorization.

## Success Criteria

- `/acknowledge` registers with no `incident_id` option and presents a service dropdown.
- Dropdown options represent only currently open incidents and identify the service type/name without exposing a required incident ID.
- Selecting an option acknowledges exactly the matching `(service_type, service_id)` incident.
- Non-admin users are rejected for both command and component interactions.
- Empty, stale, invalid, and repeated selections receive safe ephemeral responses.
- No acknowledge-specific source, test, or task documentation still requires `incident_id`.
- The focused and full test suites pass.

## Open Questions

None blocking implementation. The existing `/resolve-incident` command remains intentionally out of scope because the request specifically targets `/acknowledge`.
