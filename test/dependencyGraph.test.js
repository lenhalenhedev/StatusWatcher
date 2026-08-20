import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { buildDependencyGraph, findCandidateRoots } from '../src/dependencies/dependencyGraph.js';

const cwd = path.resolve(new URL('..', import.meta.url).pathname);

function run(script) {
  const env = {
    ...process.env,
    TOKEN: 'test-token',
    CLIENT_ID: '123456789012345678',
    GUILD_ID: '123456789012345678',
    ADMIN_USER_ID: '123456789012345678',
    DB_PATH: path.join('/tmp', `statuswatcher-dependency-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`),
  };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env, encoding: 'utf8' }));
}

test('rejects cycles and persists only validated dependency edges', () => {
  const result = run(`
    import { addDependency, listDependencies, removeDependency } from './src/store/dependencyStore.js';
    const first = addDependency({ serviceId: 'website:frontend', dependsOnServiceId: 'database:primary', dependencyGroupId: 'payments', createdBy: 'admin' });
    const duplicate = addDependency({ serviceId: 'website:frontend', dependsOnServiceId: 'database:primary', dependencyGroupId: 'payments', createdBy: 'admin' });
    const invalid = addDependency({ serviceId: 'bad/id', dependsOnServiceId: 'database:primary', createdBy: 'admin' });
    const second = addDependency({ serviceId: 'database:primary', dependsOnServiceId: 'redis:cache', createdBy: 'admin' });
    const cycle = addDependency({ serviceId: 'redis:cache', dependsOnServiceId: 'website:frontend', createdBy: 'admin' });
    const rows = listDependencies();
    const removed = removeDependency(first?.id);
    process.stdout.write(JSON.stringify({ first: Boolean(first), duplicate, invalid, second: Boolean(second), cycle, count: rows.length, removed, remaining: listDependencies().length }));
  `);
  assert.equal(result.first, true);
  assert.equal(result.duplicate, null);
  assert.equal(result.invalid, null);
  assert.equal(result.second, true);
  assert.equal(result.cycle, null);
  assert.equal(result.count, 2);
  assert.equal(result.removed, true);
  assert.equal(result.remaining, 1);
});

test('builds graph and emits only cautious candidate-root language inside the correlation window', () => {
  const graph = buildDependencyGraph([
    { service_id: 'website:frontend', depends_on_service_id: 'database:primary' },
    { service_id: 'database:primary', depends_on_service_id: 'redis:cache' },
  ]);
  assert.deepEqual(graph.dependenciesOf('website:frontend'), ['database:primary']);
  assert.deepEqual(graph.dependenciesOf('database:primary'), ['redis:cache']);
  assert.deepEqual(graph.dependenciesOf('unknown'), []);

  const candidates = findCandidateRoots({
    incidents: [
      { service_id: 'redis:cache', opened_at: 1_000 },
      { service_id: 'database:primary', opened_at: 1_500 },
      { service_id: 'website:frontend', opened_at: 1_600 },
    ],
    dependencies: [
      { service_id: 'website:frontend', depends_on_service_id: 'database:primary' },
      { service_id: 'database:primary', depends_on_service_id: 'redis:cache' },
    ],
    correlationWindowMs: 1_000,
  });
  assert.deepEqual(candidates, [
    { serviceId: 'redis:cache', affects: ['database:primary'], wording: 'possibly affected downstream services' },
  ]);
});
