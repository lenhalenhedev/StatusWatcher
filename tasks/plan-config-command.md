# `/config` Implementation Plan

## Scope

Build the administrator-only Discord `/config` command to manage runtime configuration in SQLite without using environment variables for keys that the operator must edit through Discord.

## Design Principles

1. `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `ADMIN_USER_ID`, `DB_PATH`, and `HEALTH_PORT` remain bootstrap/runtime infrastructure from the environment; tokens are never stored in SQLite.
2. Business configuration includes monitor/log channels, important role, monitoring timings, retry policy, digest cron, and the Minecraft server list; these values are stored in SQLite.
3. SQLite configuration is loaded into an atomically replaceable runtime snapshot; every consumer reads the latest snapshot while running.
4. `/config` is restricted to `ADMIN_USER_ID`, validates data at the boundary, and uses prepared statements.
5. Minecraft is enabled when at least one active server exists in SQLite; deleting a server stops its monitor and removes it from the embed.
6. The Config UI uses its own custom-ID namespace, modals for entered data, and select menus for server removal.
7. A page displays at most 23 configuration buttons; when more than 23 items exist, the first row is reserved for PREV/NEXT and the same embed is edited when the page changes.

## Slices

### Slice 1: Configuration schema/store

- Add a `runtime_config` key/value table or an equivalent schema.
- Add a `minecraft_servers` table with ID, name, host, port, active flag, and timestamps.
- Provide transaction-safe get/set/list/delete operations.
- Seed values from the environment only during first-time migration; never overwrite SQLite values on every startup.

### Slice 2: Runtime configuration manager

- Expose an immutable snapshot and `reloadRuntimeConfig()`.
- Parse and validate integers, cron expressions, Discord snowflakes, `domain:port`, and backoff lists.
- Provide getters for consumers.
- Allow the monitoring interval/check schedule and Minecraft monitor to update after configuration changes.

### Slice 3: RED/GREEN configuration interactions

- Enforce the `/config` administrator gate.
- Show an embed describing each function and its current value.
- Open a modal for each scalar setting.
- Add Service selects MC, then opens a modal for server name plus `host:port`.
- Remove Service selects MC, then shows a menu to choose and delete an existing server.
- On modal submit, save to SQLite, reload the snapshot, apply runtime changes, and update the embed.

### Slice 4: Pagination

- Allow at most 23 configuration buttons per page.
- If the list exceeds 23 items, put PREV/NEXT in the first row and the configuration buttons after it; page switches use `interaction.update`.
- Never create a component set that exceeds Discord limits.

### Slice 5: Consumer migration

- `embedBuilder`, `notifier`, `digest`, target utilities, and administrator commands read the runtime snapshot.
- The Minecraft monitor supports multiple servers, each with its own state and stable target ID.
- Check interval, cron, retry, and backoff values come from the snapshot.
- Channel and role updates apply immediately to the status embed and notifier.

## Acceptance Criteria

- When an administrator invokes `/config`, it displays an embed with descriptions, current values, and controls.
- Non-administrators cannot open or submit configuration changes.
- Add Service -> MC accepts a valid `name` and `host:port`, writes SQLite, and appears in the uptime embed immediately.
- Remove Service -> MC uses a dropdown, removes the target/server from SQLite, RAM, and the embed immediately.
- Important role/channel and all numeric/cron settings are stored in SQLite and take effect on the next operation without a restart.
- Restarting does not lose SQLite configuration; environment values only seed missing keys.
- More than 23 items shows PREV/NEXT; 23 or fewer items does not.
- Invalid input is rejected with a clear message and does not crash the process.
- Focused tests pass; the full suite runs, and any recurring native-dependency limit is documented separately.
