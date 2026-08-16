# StatusWatcher Refactor Checklist

## Persistence foundation

- [x] Replace `better-sqlite3` import and dependency with `node:sqlite`.
- [x] Preserve schema initialization, named parameters, result shapes, and `changes` checks.
- [x] Verify monitor-message, bot-management, and status-message tests.

## Async and lifecycle safety

- [x] Add a safe background-task helper with contextual rejection logging.
- [x] Apply it to monitoring intervals and cron callbacks.
- [x] Preserve refresh serialization and check-cycle reentrancy behavior.
- [x] Verify no new unhandled rejections in focused tests.

## Structural cleanup

- [x] Extract interaction dispatch into a focused module without changing dispatch order.
- [x] Keep command module interfaces stable.
- [x] Remove only confirmed dead or duplicate code introduced by the focused refactor.

## Verification

- [x] Run `npm test`.
- [x] Run syntax checks for all JavaScript files.
- [x] Run targeted imports with temporary environment values.
- [x] Run `npm audit --omit=dev` if dependency metadata changes.
- [x] Review correctness, readability, architecture, security, and performance.
- [x] Perform an adversarial doubt pass and resolve actionable findings.
- [x] Package the project and write the diagnostic report.
