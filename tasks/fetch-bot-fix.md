# `/fetch-bot` pagination fix

## Symptom

`/fetch-bot` reported only one bot even though the guild contained multiple Discord bots.

## Root cause

The service used a hand-built REST request with a plain JavaScript object in `options.query`. In the installed discord.js/@discordjs/rest stack, the public supported member-list API is `guild.members.list({ limit, after })`; using the public method avoids query serialization and pagination ambiguity.

## Fix

`src/services/botFetchService.js` now prefers `guild.members.list({ limit: 1000, after })`, which returns the next member page using Discord's supported `after` cursor. A compatibility fallback remains for guild-like test objects and passes a real `URLSearchParams` instance to REST. The service still filters only `user.bot === true`, processes bot records in groups of ten, waits 10 seconds between non-final batches, and reports cumulative progress.

The regression test now supplies the public `members.list()` interface and verifies that 11 bot records produce cumulative progress `[10, 11]` and are persisted/loaded correctly. The SQLite-backed test process is still blocked by the pre-existing native `better-sqlite3` failure in this sandbox; syntax checks and non-native focused tests pass.
