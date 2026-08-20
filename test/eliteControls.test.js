import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { calculateSlo } from '../src/reporting/sloCalculator.js';
import { forecastCertificateWarnings } from '../src/services/tlsForecastService.js';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);

function run(script) {
  const env = {
    ...process.env,
    TOKEN: 'test-token',
    CLIENT_ID: '123456789012345678',
    GUILD_ID: '123456789012345678',
    ADMIN_USER_ID: '123456789012345678',
    DB_PATH: path.join('/tmp', `statuswatcher-controls-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env, encoding: 'utf8' }));
}

test('stores only hashed audit values and ownership fails closed for missing roles', () => {
  const result = run(`
    import { recordAudit, listAudit } from './src/store/auditStore.js';
    import { setOwnership, canManageService } from './src/auth/serviceAccess.js';
    const audit = recordAudit({ action: 'SET_DATABASE', actorId: '123456789012345678', targetType: 'database', targetId: 'database:primary', value: 'postgres://user:password@example.test/db' });
    const rows = listAudit();
    const ownership = setOwnership({ serviceType: 'website', serviceId: 'website:frontend', roleId: '999999999999999999', updatedBy: '123456789012345678' });
    process.stdout.write(JSON.stringify({ audit: Boolean(audit), rows, ownership: Boolean(ownership), allowed: canManageService({ serviceType: 'website', serviceId: 'website:frontend', userId: '123456789012345678', isAdmin: false, roleIds: [] }), roleAllowed: canManageService({ serviceType: 'website', serviceId: 'website:frontend', userId: '222222222222222222', isAdmin: false, roleIds: ['999999999999999999'] }) }));
  `);
  assert.equal(result.audit, true);
  assert.equal(result.rows[0].value_hash.includes('password'), false);
  assert.equal(result.rows[0].value_hash.length, 64);
  assert.equal(result.ownership, true);
  assert.equal(result.allowed, false);
  assert.equal(result.roleAllowed, true);
});

test('calculates an SLO error budget with maintenance exclusion', () => {
  const result = calculateSlo({
    windowStart: 0,
    windowEnd: 100_000,
    targetPercent: 99,
    incidents: [{ opened_at: 20_000, resolved_at: 40_000 }],
    maintenanceWindows: [{ starts_at: 25_000, ends_at: 35_000 }],
    maintenancePolicy: 'exclude',
  });
  assert.equal(result.noData, false);
  assert.equal(result.downtimeMs, 10_000);
  assert.equal(result.errorBudgetMs, 900);
  assert.equal(result.errorBudgetRemainingMs, -9_100);
});

test('deduplicates TLS threshold warnings and never returns certificate contents', () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  const result = forecastCertificateWarnings({ expiresAt: now + 13 * 24 * 60 * 60 * 1000, now, notifiedMask: 0 });
  assert.equal(result.daysRemaining, 13);
  assert.deepEqual(result.warnings.map((warning) => warning.thresholdDays), [30, 14]);
  const deduped = forecastCertificateWarnings({ expiresAt: now + 13 * 24 * 60 * 60 * 1000, now, notifiedMask: result.warningMask });
  assert.deepEqual(deduped.warnings, []);
  assert.equal(JSON.stringify(result).includes('BEGIN CERTIFICATE'), false);
});
