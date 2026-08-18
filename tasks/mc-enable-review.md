# MC_ENABLE Review Record

## Contract

`MC_ENABLE` controls Minecraft uptime monitoring. The value must be explicit: `true` or `false`, case-insensitive and whitespace-tolerant; an absent variable preserves the current deployment behavior. When disabled, Minecraft settings are not required, Minecraft is not registered or polled, Minecraft alerts and status fields are not emitted, and stale persisted Minecraft targets are hidden from user-facing target views. No new dependency or unrelated persistence change is allowed.

## Five-Axis Review

| Axis | Finding | Disposition |
|---|---|---|
| Correctness | Configuration gates Minecraft-specific required variables and runtime boundaries. The initial adversarial pass identified that whitespace-only `MC_ENABLE` was accidentally treated as the default; this was corrected and covered by a regression test. | Fixed |
| Readability and simplicity | Direct guards at existing orchestration boundaries are clearer than a new feature-flag framework. Repeated one-line target filters are limited to the user-facing command/digest boundaries and avoid coupling persistence to configuration. | No required change |
| Architecture | The flag remains centralized in `src/config.js`; monitor, cycle, startup, presentation, digest, and target resolution consume the existing config object. Persistence remains feature-agnostic. | No required change |
| Security | Arbitrary environment values are rejected instead of being coerced by JavaScript truthiness. No secrets or user-controlled input are added. | No required change |
| Performance | Disabled mode skips the Minecraft initial probe, periodic monitor invocation, alert processing, and Minecraft rendering. The extra in-memory filters occur only in list/digest/autocomplete paths and are bounded by the existing target result set. | No required change |

## Verification Evidence

The focused configuration suite passes 7/7 tests. Syntax checks pass for every modified JavaScript file, and `git diff --check` passes. The full suite reports 38/41 passing tests; three existing database-backed test files fail at module load because `better-sqlite3` segfaults under the supplied Node.js 22.13.0 runtime. Rebuilding the native dependency did not resolve the segfault. This failure is outside the MC_ENABLE diff and prevents direct runtime/embed tests from importing the SQLite-backed modules.

## Adversarial Questions

- Can an invalid or empty value silently enable Minecraft? No; the parser exits before runtime configuration is created.
- Can disabled mode still require Minecraft credentials? No; Minecraft variables are appended to the required list only when enabled.
- Can startup or the cycle still make a Minecraft status request? No; both orchestration and monitor boundaries are guarded.
- Can stale Minecraft rows appear in `/list`, daily digest, resolve, or autocomplete? No; those views filter Minecraft targets when disabled.
- Can status health claim Minecraft is online while disabled? No; the `minecraftOnline` property is omitted and the embed omits its field.
- Can the default break existing deployments? No; absent `MC_ENABLE` defaults to true.

## Review Result

No unresolved required finding remains in the MC_ENABLE change. Runtime-level verification remains environment-blocked by the pre-existing native SQLite segmentation fault.
