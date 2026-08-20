# `/config` final review

## Correctness

- `/config` is registered in the command map and routed through button, select-menu, and modal interactions.
- Add Service -> MC validates `name` and `host:port`, persists the server in SQLite, registers the target, reloads runtime config, and refreshes the status message.
- Remove Service -> MC uses a Discord select menu, deletes the server row, target row, target-scoped metadata, and in-memory monitor state, then refreshes the runtime embed.
- Scalar settings are validated by `runtimeConfigSchema`, persisted in `runtime_config`, reloaded immediately, and applied to schedules, monitoring thresholds, alerts, role priority, and channels.
- Config view uses five action rows at most. It shows up to 23 configuration buttons without navigation; when navigation is required, it uses a navigation row plus at most 20 configuration buttons (four rows of five).
- Empty Monitor/Log Channel configuration is handled safely at startup; Discord channel fetches are skipped until configured.
- `/status`, `/list`, and `/recheck` now consume all Minecraft states rather than only the first server.

## Security

- `/config` is restricted to the configured admin user.
- Discord IDs, integer ranges, cron expressions, and Minecraft host/port are validated before SQLite writes.
- SQLite writes use prepared statements; no user input is interpolated into SQL.
- Modal replies and configuration errors do not expose secrets.

## Performance

- Runtime settings use one SQLite snapshot and prepared statements.
- Configuration reload coalesces status refreshes through the existing status refresh guard.
- Monitoring schedules are restarted only when configuration changes.
- Remove Service selectors are paginated in groups of 25 per service type.

## Verification

- Full JavaScript syntax check: pass.
- `git diff --check`: pass.
- Focused schema, pagination, and interaction tests: 13/13 pass.
- SQLite-backed config/status tests remain blocked by the pre-existing `better-sqlite3` native SIGSEGV in the sandbox's Node.js 22.13 runtime.

## Remaining operational step

After deployment, run the project's command deployment script so Discord registers `/config` and removes any stale command definitions. Configure `MONITOR_CHANNEL_ID`, `LOG_CHANNEL_ID`, and other initial values through `/config`; operational values are persisted in SQLite.
