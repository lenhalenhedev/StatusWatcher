# Implementation Plan: Event-driven Discord Bot Monitoring

## Overview

Move uptime bot management from scanning every member during each monitoring cycle to an event-driven model. The bot automatically adds Discord bots on `guildMemberAdd`, archives and removes them from runtime on `guildMemberRemove`, and restores active bots from SQLite at startup. The `/add-bot` and `/remove-bot` commands are removed; `/fetch-bot` is a manual reconciliation mechanism that fetches members in batches of up to 10 bots, waits 10 seconds between batches, stores results in SQLite, and loads them into RAM.

## Architecture Decisions

1. **SQLite is the durable data source; `botStates` is the runtime cache.** At startup, read active bot targets from SQLite, check whether each ID is still in the guild, delete missing targets from SQLite, and create runtime state for valid targets.
2. **Gateway events are the regular update path.** `guildMemberAdd` registers a member only when the member is a bot; `guildMemberRemove` archives the corresponding bot. The monitoring cycle no longer calls `guild.members.fetch()`.
3. **`/fetch-bot` is controlled reconciliation.** The command fetches members in batches of 10, reports cumulative `fetched: N bot`, waits 10 seconds between batches, uses the existing Discord.js member-cache/chunking API, and updates SQLite/RAM after each batch or after completion.
4. **The embed prioritizes `hasImportantRole`.** When `IMPORTANT_ROLE_ID` exists in a member's roles, the bot is ordered before ordinary bots. Minecraft remains before bots on page 1 when `MC_ENABLE=true`. Each page contains at most 10 bots; important bots that exceed the remaining space on page 1 naturally move to page 2 or later.
5. **Do not retain the old administration path.** Remove `/add-bot`, `/remove-bot`, their input parsers, and removal menus only after reference searches confirm that no call sites remain; replace old tests with event-lifecycle, startup-reconciliation, fetch-batching, and ordering tests.

## Task List

### Phase 1: Foundation
- [ ] Confirm that the `targets` schema stores `type`, `has_important_role`, and `status`, and that archive/list helpers already exist.
- [ ] Separate the helper that creates runtime state from a SQLite row and the helper that creates state from a GuildMember.
- [ ] Write RED tests for startup restore, missing-guild archival, member add/remove, and the absence of full fetches during a cycle.

### Phase 2: Fetch command
- [ ] Write RED tests for `/fetch-bot`: admin gate, batch size 10, cumulative progress, 10-second delay, persistence, and RAM restore.
- [ ] Implement the fetch service with injectable clock/sleep functions so tests do not wait 10 real seconds.
- [ ] Register `/fetch-bot` and remove old commands from the command registry.

### Phase 3: Embed and lifecycle integration
- [ ] Sort bot states by important role first while preserving deterministic tie-break order.
- [ ] Ensure Minecraft field remains first and bot pagination stays at 10 bots/page.
- [ ] Refresh status embed after member add/remove and after fetch completes.
- [ ] Remove full `guild.members.fetch()` from `checkBotStatuses()`.

### Checkpoint: Core behavior
- [ ] Focused tests pass for bot lifecycle, command registry, fetch batching and pagination.
- [ ] Syntax checks pass for all changed JavaScript.
- [ ] No call site invokes full member fetch during regular monitoring cycles.

### Phase 4: Polish and verification
- [ ] Remove orphaned manual command modules only after reference search confirms they are unreachable.
- [ ] Review correctness, readability, architecture, security and performance.
- [ ] Run full suite; record any pre-existing native dependency failures separately.
- [ ] Update `.env.example` with `IMPORTANT_ROLE_ID` semantics and operational notes for `/fetch-bot`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Presence cache is not complete after startup | Medium | Keep Gateway intents and restore state from SQLite; `/fetch-bot` is explicit reconciliation, not a cycle hot path. |
| Bot leaves before `guildMemberRemove` is received | High | Startup reconciliation archives missing IDs; `/fetch-bot` provides manual reconciliation. |
| Fetching hundreds/thousands of members overloads gateway/API | High | Batch at 10, wait 10 seconds, report cumulative progress, serialize concurrent fetch commands. |
| Archived bot re-joins guild | Medium | Decide event policy explicitly: re-register on join because membership proves it is a current monitorable bot. |
| Runtime state and SQLite diverge after partial fetch | Medium | Persist each accepted bot before/while adding it to RAM, and expose errors in command reply/logs. |
| Discord embed field/page limits | Medium | Keep max 10 bots/page and deterministic priority ordering; preserve existing field value limit handling. |

## Acceptance Criteria

- [ ] No `/add-bot` or `/remove-bot` command appears in command registry or deployed command payload.
- [ ] A bot joining the monitored guild is automatically active in uptime monitoring and appears in the embed after refresh.
- [ ] A bot leaving the monitored guild is removed from RAM, archived/removed from active SQLite records, and disappears from the embed.
- [ ] Startup restores active bot rows from SQLite, archives rows whose IDs are absent from the guild, and does not perform a full member fetch as part of the regular check cycle.
- [ ] `/fetch-bot` processes at most 10 bots per batch, waits 10 seconds between batches, reports cumulative `fetched: N bot`, persists all fetched bots to SQLite and loads them into RAM.
- [ ] Important-role bots are ordered before ordinary bots, Minecraft remains first when enabled, and the page size remains 10 bots.

## Open Questions / Assumptions

- `fetch-bot` is assumed to be admin-only, matching the removed manual management commands.
- “Remove from SQLite” is implemented as physical deletion, including dependent downtime sessions through the existing foreign-key cascade. This follows the explicit requirement; a bot that rejoins is treated as a new active target.
- A bot that leaves and later rejoins is assumed to be automatically reactivated because the new requirement says bots entering the guild should be added automatically.
