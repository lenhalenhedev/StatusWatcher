import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);

function run(script) {
  const env = {
    ...process.env,
    TOKEN: 'test-token',
    CLIENT_ID: '123456789012345678',
    GUILD_ID: '123456789012345678',
    ADMIN_USER_ID: '123456789012345678',
    DB_PATH: path.join('/tmp', `statuswatcher-maintenance-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  }));
}

test('validates maintenance windows and applies the half-open active interval', () => {
  const result = run(`
    import { isInMaintenance, listMaintenanceWindows, scheduleWindow } from './src/store/maintenanceStore.js';
    const invalidType = scheduleWindow({ serviceId: 'website_1', serviceType: 'unknown', startsAt: 1000, endsAt: 2000, reason: 'x', createdBy: '123456789012345678' });
    const invalidOrder = scheduleWindow({ serviceId: 'website_1', serviceType: 'website', startsAt: 2000, endsAt: 1000, reason: 'x', createdBy: '123456789012345678' });
    const window = scheduleWindow({ serviceId: 'website_1', serviceType: 'website', startsAt: 1000, endsAt: 2000, reason: 'Planned maintenance', createdBy: '123456789012345678', createdAt: 900 });
    process.stdout.write(JSON.stringify({
      invalidType,
      invalidOrder,
      window,
      before: isInMaintenance('website_1', 'website', 999),
      active: isInMaintenance('website_1', 'website', 1000),
      activeBeforeEnd: isInMaintenance('website_1', 'website', 1999),
      atEnd: isInMaintenance('website_1', 'website', 2000),
      listed: listMaintenanceWindows({ now: 1500 }).map(({ id, service_id, reason }) => ({ id, service_id, reason })),
    }));
  `);

  assert.equal(result.invalidType, null);
  assert.equal(result.invalidOrder, null);
  assert.equal(result.window.service_id, 'website_1');
  assert.equal(result.before, false);
  assert.equal(result.active, true);
  assert.equal(result.activeBeforeEnd, true);
  assert.equal(result.atEnd, false);
  assert.deepEqual(result.listed, [{ id: result.window.id, service_id: 'website_1', reason: 'Planned maintenance' }]);
});

test('cancels a maintenance window exactly once and hides expired windows by default', () => {
  const result = run(`
    import { cancelWindow, isInMaintenance, listMaintenanceWindows, scheduleWindow } from './src/store/maintenanceStore.js';
    const expired = scheduleWindow({ serviceId: 'database_1', serviceType: 'database', startsAt: 100, endsAt: 200, reason: 'Old', createdBy: '123456789012345678' });
    const future = scheduleWindow({ serviceId: 'database_1', serviceType: 'database', startsAt: 3000, endsAt: 4000, reason: 'Future', createdBy: '123456789012345678' });
    const cancelled = cancelWindow(future.id);
    process.stdout.write(JSON.stringify({
      cancelled,
      repeated: cancelWindow(future.id),
      expiredDefault: listMaintenanceWindows({ now: 1000 }).map(({ id }) => id),
      expiredIncluded: listMaintenanceWindows({ includeExpired: true, now: 1000 }).map(({ id }) => id),
      cancelledActive: isInMaintenance('database_1', 'database', 3500),
      expiredActive: isInMaintenance('database_1', 'database', 150),
      expiredId: expired.id,
    }));
  `);

  assert.equal(result.cancelled, true);
  assert.equal(result.repeated, false);
  assert.deepEqual(result.expiredDefault, []);
  assert.deepEqual(result.expiredIncluded, [result.expiredId]);
  assert.equal(result.cancelledActive, false);
  assert.equal(result.expiredActive, true);
});
