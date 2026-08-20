# `/config` Checklist

## Discovery and Design

- [ ] Identify the environment keys that move into SQLite.
- [ ] Keep bootstrap secrets and infrastructure outside `/config`.
- [ ] Finalize the runtime-configuration and Minecraft-server schemas.
- [ ] Finalize the custom-ID namespace, modal field IDs, and pagination state.

## Persistence and Runtime

- [ ] Create the key/value configuration table with an idempotent migration.
- [ ] Create the Minecraft-server table and required indexes.
- [ ] Seed environment values only when an SQLite key does not exist.
- [ ] Validate input before calling the store.
- [ ] Atomically reload the snapshot after every change.
- [ ] Apply monitoring interval, cron, channels, role, Minecraft targets, and retry policy immediately.

## Discord UI

- [ ] Register `/config`.
- [ ] Enforce administrator authorization during execution and component submission.
- [ ] Show descriptions and current values in the embed.
- [ ] Select MC through Add Service and open a modal with name and host:port.
- [ ] Select MC through Remove Service and show a selector containing current servers.
- [ ] Provide modals for Important Role, Monitor Channel, and Log Channel.
- [ ] Provide modals for all numeric, backoff, and cron settings.
- [ ] Support 23 configuration buttons per page and PREV/NEXT when needed.
- [ ] Ensure modal cancellation, closing, and validation errors do not lose the interaction.

## Testing

- [ ] RED tests for parsing and validation.
- [ ] RED tests for SQLite round trips and non-overwriting seeds.
- [ ] RED tests for adding/removing Minecraft servers.
- [ ] RED tests for administrator gating and modal/select routing.
- [ ] RED tests for pagination at or below 23 and above 23 items.
- [ ] GREEN focused tests after each slice.
- [ ] Run syntax checks and `git diff --check`.
- [ ] Run the full suite and document any remaining native baseline failure.

## Handoff

- [ ] Update `.env.example` to remove keys moved to `/config` or document their migration.
- [ ] Update the README with bootstrap and `/config` instructions.
- [ ] Package source without node_modules, `.git`, or runtime data.
- [ ] Document deploy commands and restart/migration instructions.
