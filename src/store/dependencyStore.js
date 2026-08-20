import db from '../utils/db.js';

const MAX_ID_LENGTH = 200;
const MAX_GROUP_LENGTH = 80;
const ID_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;
const GROUP_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

const insertDependency = db.prepare(`
  INSERT INTO service_dependencies (service_id, depends_on_service_id, dependency_group_id, created_by, created_at)
  VALUES (@serviceId, @dependsOnServiceId, @dependencyGroupId, @createdBy, @createdAt)
`);
const selectDependencies = db.prepare(`
  SELECT id, service_id, depends_on_service_id, dependency_group_id, created_by, created_at
  FROM service_dependencies ORDER BY id ASC LIMIT @limit
`);
const deleteDependency = db.prepare('DELETE FROM service_dependencies WHERE id = @id');

function normalizeId(value) {
  const id = String(value ?? '').trim();
  return id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id) ? id : null;
}

function normalizeGroup(value) {
  if (value === null || value === undefined || value === '') return null;
  const group = String(value).trim();
  return group.length <= MAX_GROUP_LENGTH && GROUP_PATTERN.test(group) ? group : null;
}

function createsCycle(edges, serviceId, dependsOnServiceId) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.service_id)) adjacency.set(edge.service_id, []);
    adjacency.get(edge.service_id).push(edge.depends_on_service_id);
  }
  if (!adjacency.has(serviceId)) adjacency.set(serviceId, []);
  adjacency.get(serviceId).push(dependsOnServiceId);

  const pending = [dependsOnServiceId];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === serviceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export function listDependencies(limit = 5000) {
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 10_000) : 5000;
  return selectDependencies.all({ limit: bounded });
}

export function addDependency({ serviceId, dependsOnServiceId, dependencyGroupId = null, createdBy, createdAt = Date.now() } = {}) {
  const normalizedServiceId = normalizeId(serviceId);
  const normalizedDependencyId = normalizeId(dependsOnServiceId);
  const normalizedGroup = normalizeGroup(dependencyGroupId);
  const actor = normalizeId(createdBy);
  if (!normalizedServiceId || !normalizedDependencyId || normalizedServiceId === normalizedDependencyId || !actor || !Number.isInteger(createdAt) || (dependencyGroupId !== null && dependencyGroupId !== undefined && dependencyGroupId !== '' && !normalizedGroup)) return null;
  if (createsCycle(listDependencies(), normalizedServiceId, normalizedDependencyId)) return null;
  try {
    const result = insertDependency.run({
      serviceId: normalizedServiceId,
      dependsOnServiceId: normalizedDependencyId,
      dependencyGroupId: normalizedGroup,
      createdBy: actor,
      createdAt,
    });
    return db.prepare('SELECT * FROM service_dependencies WHERE id = ?').get(result.lastInsertRowid);
  } catch {
    return null;
  }
}

export function removeDependency(id) {
  if (!Number.isInteger(id) || id < 1) return false;
  return deleteDependency.run({ id }).changes === 1;
}
