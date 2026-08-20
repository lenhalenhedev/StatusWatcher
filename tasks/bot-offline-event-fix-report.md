# Automatic Bot Offline Event Fix

## Reproduction

A monitored Discord bot was made offline. The automatic monitoring loop did not deliver the expected DOWN alert, while `/recheck` detected the outage.

## Root cause

The bot monitor relied on a cached member wrapper as the primary presence source and had no explicit `presenceUpdate` gateway listener. Discord.js maintains the authoritative presence in `guild.presences.cache`; a member may therefore appear stale to a monitor path that does not retain the gateway transition. The manual command happened to expose the updated state, which made the issue look like a `/recheck`-specific capability.

## Corrected behavior

The production process now subscribes to Discord's `presenceUpdate` event. For monitored bots, the handler stores the latest gateway status in the bot runtime state and triggers the same re-entrancy-safe monitoring runner used by the normal interval. The existing confirmation threshold remains active; an offline event begins or continues the threshold rather than bypassing the configured policy.

Each normal bot check now prefers the latest presence event, then the authoritative `guild.presences.cache`, then the member presence fallback. This preserves gateway evidence when another object is stale and still supports the test and degraded-cache cases.

When the configured threshold is satisfied, the normal cycle emits DOWN, persists the downtime session, creates the incident, and sends the log-channel alert without requiring `/recheck`. When the gateway later reports online, the next check emits UP and resets the bot state.

## Changed files

| File | Change |
|---|---|
| `src/monitors/botMonitor.js` | Added `presenceStatus`, `handlePresenceUpdate()`, authoritative presence-source selection, and preserved threshold/recovery behavior. |
| `src/index.js` | Added the `presenceUpdate` listener and routed eligible events to the normal monitoring runner. |
| `test/botManagementCommands.test.js` | Added tests for stale member data, guild presence-cache DOWN detection, gateway-driven DOWN detection, and gateway-driven UP recovery without `/recheck`. |
| `test/deprecationRegression.test.js` | Added a source-wiring regression assertion for the production presence listener. |

## Verification

| Check | Result |
|---|---:|
| Bot-monitor and source-wiring tests | **15/15 passed** |
| Full repository suite | **232/232 passed** |
| Dependency audit | **0 vulnerabilities** |
| Changed-file whitespace scan | **Passed** |
| Changed-file sensitive-value scan | **Passed** |
| Runtime | **Node.js v24.19.0 via NVM** |

The implementation does not log raw presence payloads, endpoints, credentials, or upstream error details. It preserves the configured confirmation threshold and does not introduce a full-guild fetch into the hot path.
