# TODO: Event-driven Bot Monitoring

## RED tests first

- [x] Test startup restores an active bot row from SQLite into `botStates` when the member exists in the guild.
- [x] Test startup removes an active SQLite bot row when its ID is absent from the guild.
- [x] Test `guildMemberAdd` registers a new bot and persists its important-role flag.
- [x] Test `guildMemberRemove` removes the bot from RAM and permanently deletes its active target.
- [x] Test regular `checkBotStatuses()` uses only the runtime map and does not fetch the full guild member collection.
- [x] Test `/fetch-bot` rejects non-admin users.
- [x] Test `/fetch-bot` fetches at most 10 bots per batch and reports cumulative progress.
- [x] Test `/fetch-bot` waits between batches through an injectable sleep function.
- [x] Test fetched bots are persisted and restored into RAM, and stale rows/states are removed.
- [x] Test command registry excludes `/add-bot` and `/remove-bot` and includes `/fetch-bot`.
- [x] Test important-role bots sort before ordinary bots and page size remains 10.

## Implementation slices

### Slice 1: Persistence and state restore

- [x] Use active target listing and per-ID startup reconciliation.
- [x] Add permanent deletion reconciliation for missing guild members.
- [x] Permanently delete bot rows and dependent metadata when a bot leaves the guild, as explicitly required.
- [~] Lifecycle integration test is written but blocked by the existing native SQLite test-process failure.

### Slice 2: Gateway lifecycle

- [x] Register `guildMemberAdd` and `guildMemberRemove` handlers.
- [x] Register only actual Discord bots and exclude the monitor bot itself.
- [x] Refresh the status message after successful add/remove.
- [x] Remove full member fetch from periodic bot status checks.
- [x] Run lifecycle syntax checks; runtime lifecycle test remains native-dependency blocked.

### Slice 3: `/fetch-bot`

- [x] Add admin-only command module.
- [x] Serialize concurrent fetch jobs to avoid overlapping gateway loads.
- [x] Process bot members in batches of 10.
- [x] Sleep 10 seconds between non-final batches.
- [x] Reply/edit progress using cumulative `fetched: N bot(s)` wording.
- [x] Persist all fetched bots, then read active bot rows back from SQLite and hydrate runtime state.
- [x] Refresh embed after completion.
- [~] Command/batching test is written but blocked by the existing native SQLite test-process failure; service syntax and non-native tests pass.

### Slice 4: Commands and embed

- [x] Remove legacy command registry entries.
- [x] Remove unreachable manual command handlers, store and parser after search.
- [x] Sort important bots first with stable deterministic ordering.
- [x] Keep Minecraft section above bot sections when enabled.
- [x] Verify overflow to page 2+ for important bots after the first 10 bots.
- [x] Update `.env.example` and command descriptions.

## Final verification

- [~] Focused bot-management test is blocked by the existing native `better-sqlite3` test-process failure; pagination focused tests pass.
- [x] Full test suite run: 37 pass, 3 SQLite-backed files fail at the existing native dependency boundary.
- [x] `node --check` passes for all changed JavaScript.
- [x] `git diff --check` passes.
- [x] Search confirms no runtime references to removed commands remain.
- [x] Search confirms no `guild.members.fetch()` remains in the regular check cycle.
- [x] Five-axis single-model code review completed; cross-model review was skipped at the user's request.
- [x] Performance review confirms batch delay and no unbounded concurrent fetch.
- [ ] Archive/package contains only intended project changes.
