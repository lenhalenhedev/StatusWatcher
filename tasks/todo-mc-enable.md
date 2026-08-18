# MC_ENABLE Checklist

## Configuration

- [x] Parse `MC_ENABLE` strictly as a boolean.
- [x] Keep backward-compatible default behavior when the variable is absent.
- [x] Require Minecraft connection settings only when enabled.
- [x] Document the flag in `.env.example`.

## Runtime behavior

- [x] Do not initialize or probe Minecraft when disabled.
- [x] Do not poll Minecraft during monitoring cycles when disabled.
- [x] Do not emit Minecraft alerts when disabled.
- [x] Do not render a Minecraft status field when disabled.
- [x] Do not report a misleading Minecraft health field when disabled.

## Verification

- [x] Configuration tests cover enabled, disabled, and invalid values.
- [ ] Runtime tests cover the disabled check path (blocked by existing `better-sqlite3` native segfault in this Node runtime).
- [ ] Embed tests cover the disabled presentation path (blocked by existing `better-sqlite3` native segfault in this Node runtime).
- [ ] `npm test` passes (38/41 pass; three existing SQLite-backed test files are blocked by the same native segfault).
- [x] Syntax checks and `git diff --check` pass.
- [x] Five-axis review and adversarial review have no unresolved required findings; cross-model review was explicitly skipped by the user.
