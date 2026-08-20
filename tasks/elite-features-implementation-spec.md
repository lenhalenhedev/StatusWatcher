# StatusWatcher Elite Features Implementation Specification

## Scope

Implement the 12 features selected in `StatusWatcher-idea-funnel.md` as production-safe vertical slices:

1. Alert grouping and deduplication.
2. Incident timeline.
3. Discord acknowledge and communication-resolve controls.
4. Maintenance windows that suppress notifications but never stop probes.
5. Weekly/monthly reliability reports.
6. Bounded latency percentile tracking.
7. Dependency graph and cautious correlated diagnosis.
8. Dry-run validation before adding a monitor.
9. Configuration audit log.
10. Role-based monitor ownership.
11. SLO and error-budget calculations.
12. TLS certificate-expiry forecasting.

The implementation must preserve existing monitor health semantics. A human communication resolve must never force a service health transition to UP. Only a successful probe may recover health.

## Shared contracts

### Health transition

All monitor results entering the core cycle must normalize to:

```js
{
  serviceId,
  serviceType,
  name,
  eventType: 'ONLINE' | 'DOWN' | 'STILL_DOWN' | 'UP' | null,
  occurredAt,
  confirmedDownAt,
  downSince,
  errorCategory,
  statusCode,
  durationMs,
  dependencyGroupId
}
```

`errorCategory` is allowlisted and never contains raw endpoint, URL query, credentials, certificate content, response body, or exception message.

### Incident

Incident status is `OPEN`, `ACKNOWLEDGED`, or `RESOLVED`. `ACKNOWLEDGED` is a communication state; it does not alter health. `RESOLVED` by a human closes communication only and is retained until probe recovery or reopened by a later confirmed DOWN transition according to explicit state rules.

The incident key is deterministic and privacy-safe: `serviceType:targetId` by default, optionally `dependencyGroup:<id>` only when the dependency relationship is explicitly configured and the grouping window is active. The implementation must never auto-assert a root cause; UI wording must use `candidate root` or `possibly affected`.

### Storage

Add idempotent SQLite tables and indexes through the central database bootstrap/store layer:

- `incidents`
- `incident_events`
- `maintenance_windows`
- `latency_samples`
- `service_dependencies`
- `config_audit_log`
- `slos`
- `dry_run_attempts` with bounded retention metadata if needed
- `service_ownership` or an ownership column on each service target table
- TLS forecast fields or a dedicated `tls_certificate_snapshots` table

Every mutation uses prepared statements and is safe to run again after process restart.

## Cross-file implementation map

| Concern | Files/modules | Contract |
|---|---|---|
| Event normalization | `src/core/checkCycle.js`, `src/monitors/*` | All transitions enter one incident/metrics pipeline. |
| Incident domain | `src/incidents/incidentKey.js`, `incidentTimeline.js`, `incidentManager.js` | No raw errors or endpoints; append-only event history. |
| Incident storage | `src/store/incidentStore.js` | Idempotent schema, indexes, retention, open-incident recovery. |
| Notification grouping | `src/handlers/notifier.js`, `src/handlers/embedBuilder.js` | One grouped notification per incident batch; preserve existing safe embeds. |
| Discord actions | `src/commands/incident.js`, `src/handlers/interactionRouter.js` | Allowlisted custom IDs, actor authorization, nonce/expiry, idempotent actions. |
| Maintenance | `src/store/maintenanceStore.js`, `src/maintenance/maintenanceService.js`, `src/commands/maintenance.js` | Suppress notifications only; auto-expire on time. |
| Reliability | `src/reporting/reliabilityReport.js`, `src/reporting/percentiles.js`, `src/commands/reliability.js` | Pure calculations separated from Discord formatting; UTC windows and bounded output. |
| Latency | `src/store/latencyStore.js`, `src/services/websiteStatusClient.js`, `src/monitors/websiteMonitor.js` | One bounded total-duration sample per probe; retention and sample caps. |
| Dependencies | `src/store/dependencyStore.js`, `src/dependencies/dependencyGraph.js` | Cycle rejection, authorized visibility, cautious correlation. |
| Dry run | `src/services/dryRunService.js`, `src/commands/configCommand.js` | Same SSRF guards as real monitor; no persistence before confirmation. |
| Audit | `src/store/auditStore.js`, `src/commands/configCommand.js` | Hash/redact values; mutation and audit are atomic where possible. |
| Ownership | `src/auth/serviceAccess.js`, service stores, config/incident commands | Central `canManageService`; admin bypass; deleted-role safe behavior. |
| SLO | `src/store/sloStore.js`, `src/reporting/sloCalculator.js`, `src/commands/reliability.js` | Explicit no-data state, UTC windows, maintenance policy. |
| TLS forecast | `src/services/tlsForecastService.js`, `src/monitors/websiteMonitor.js`, `src/store/tlsForecastStore.js` | Threshold deduplication, safe certificate metadata, recovery events. |
| Runtime wiring | `src/config.js`, `src/index.js`, `src/core/checkCycle.js` | Reload without restart; background jobs are bounded and idempotent. |
| Tests | `test/*Incident*.test.js`, `test/*Maintenance*.test.js`, `test/*Report*.test.js`, `test/*Dependency*.test.js`, `test/*DryRun*.test.js`, `test/*Audit*.test.js`, `test/*Ownership*.test.js`, `test/*Slo*.test.js`, `test/*TlsForecast*.test.js` | Fail-first, migration, restart, replay, timeout, PII, permission, and Discord-bound tests. |

## Acceptance criteria

1. Existing 156+ tests remain green; each feature adds deterministic regression coverage.
2. No monitor sends a duplicate alert for repeated transitions within the same incident.
3. Incident timeline records detected, notified, acknowledged, update, and resolved events with UTC timestamps.
4. Acknowledge and communication-resolve actions are permissioned, nonce-protected, replay-safe, and do not change health state.
5. Maintenance windows continue probes and uptime accounting while suppressing notification delivery.
6. Reliability and SLO reports use deterministic UTC calculations, bounded Discord output, and explicit no-data states.
7. Latency samples and incident/audit tables have bounded retention and indexes.
8. Dependency graph rejects cycles and only emits cautious candidate-root wording to authorized users.
9. Dry-run uses the same SSRF and timeout guards and creates no target row on failure or preview.
10. Audit entries never contain plaintext secrets, certificates, credentials, raw response bodies, or URL queries.
11. Ownership checks are centralized, admin bypass is explicit, and deleted roles fail closed.
12. TLS expiry forecast deduplicates 30/14/7/1-day warnings and never logs certificate contents.
13. Runtime reload applies changes without restart and startup restoration is idempotent.
14. Full source/test/task scan contains no Vietnamese prose, raw sensitive diagnostics, or obsolete feature references.
15. Archive excludes `node_modules`, `.git`, databases, runtime logs, `.env`, and secret artifacts.

## Delivery slices

- Slice A: event normalization, incident store/timeline, grouping/dedup.
- Slice B: Discord acknowledge/resolve and maintenance suppression.
- Slice C: latency, percentiles, reliability report, and SLO calculator.
- Slice D: dry-run, audit, ownership, and dependency graph.
- Slice E: TLS forecast, full runtime wiring, retention jobs, security review, and package verification.
