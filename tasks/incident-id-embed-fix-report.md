# Persistent Incident ID Embed Fix

## Reported issue

The long-lived System Status Monitor embed did not display the durable incident identifier for confirmed-down services. The alert embeds already carried incident metadata, but the persistent status embed did not query or render it. The identifier remains useful for incident correlation and history, although the current `/acknowledge` command now uses a service dropdown instead of requiring operators to enter it.

## Root cause

`buildStatusEmbed()` received monitor state only. Its DOWN branches rendered service status, duration, error, and uptime metrics, but did not resolve the active incident from SQLite. Consequently, the status message could show DOWN without exposing the ID needed by `/acknowledge`.

## Corrected behavior

For every confirmed-down website, database, Minecraft server, and Discord bot, the persistent status embed now derives the deterministic incident key and calls the existing active-incident lookup. The lookup includes both `OPEN` and `ACKNOWLEDGED` incidents. A valid positive SQLite ID is rendered as:

`Incident ID: \`<id>\``

The ID remains visible after a service is selected in `/acknowledge`; acknowledgment suppresses repeated STILL_DOWN communication but does not remove the active incident or its identifier. Pending failures that have not crossed `CONFIRM_DOWN_THRESHOLD` do not receive an ID because no incident has been created yet. After recovery, the incident becomes RESOLVED and is no longer shown as active in the persistent DOWN section.

The lookup is fail-safe: a database lookup error or invalid result omits the identifier rather than exposing internal details or breaking the status embed. No endpoint, credential, raw exception, or sensitive service data is added.

## Changed files

| File | Change |
|---|---|
| `src/handlers/embedBuilder.js` | Added active incident lookup using the shared incident-key helper and rendered IDs for confirmed-down website, database, Minecraft, and bot sections. |
| `test/websiteEmbed.test.js` | Added regression coverage proving a confirmed-down website shows its exact SQLite incident ID and continues showing it after acknowledgment. |
| `tasks/incident-id-embed-fix-report.md` | Added this implementation and verification report. |

## Verification

| Check | Result |
|---|---:|
| Focused incident/embed tests | **7/7 passed** |
| Full repository suite | **232/232 passed** |
| Dependency audit | **0 vulnerabilities** |
| Changed-file whitespace scan | **Passed** |
| Sensitive-value scan | **Passed**; the only token-like text is the intentional URL-redaction fixture `token=do-not-show-this`. |
| Runtime | **Node.js v24.19.0 via NVM** |
