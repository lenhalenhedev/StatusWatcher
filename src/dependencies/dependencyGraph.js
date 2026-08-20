function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

export function buildDependencyGraph(edges = []) {
  const adjacency = new Map();
  for (const edge of edges) {
    const serviceId = edge?.service_id ?? edge?.serviceId;
    const dependencyId = edge?.depends_on_service_id ?? edge?.dependsOnServiceId;
    if (!validId(serviceId) || !validId(dependencyId) || serviceId === dependencyId) continue;
    if (!adjacency.has(serviceId)) adjacency.set(serviceId, new Set());
    adjacency.get(serviceId).add(dependencyId);
  }

  return Object.freeze({
    dependenciesOf(serviceId) {
      if (!validId(serviceId)) return [];
      return [...(adjacency.get(serviceId) ?? new Set())].sort();
    },
    hasCycle() {
      const visiting = new Set();
      const visited = new Set();
      const visit = (node) => {
        if (visiting.has(node)) return true;
        if (visited.has(node)) return false;
        visiting.add(node);
        for (const dependency of adjacency.get(node) ?? []) if (visit(dependency)) return true;
        visiting.delete(node);
        visited.add(node);
        return false;
      };
      return [...adjacency.keys()].some(visit);
    },
  });
}

export function findCandidateRoots({ incidents = [], dependencies = [], correlationWindowMs = 5 * 60 * 1000 } = {}) {
  if (!Array.isArray(incidents) || !Array.isArray(dependencies) || !Number.isInteger(correlationWindowMs) || correlationWindowMs < 0) return [];
  const edges = dependencies
    .map((edge) => ({
      serviceId: edge?.service_id ?? edge?.serviceId,
      dependsOnServiceId: edge?.depends_on_service_id ?? edge?.dependsOnServiceId,
    }))
    .filter((edge) => validId(edge.serviceId) && validId(edge.dependsOnServiceId) && edge.serviceId !== edge.dependsOnServiceId);
  const rows = incidents
    .map((incident) => ({ serviceId: incident?.service_id ?? incident?.serviceId, openedAt: Number(incident?.opened_at ?? incident?.openedAt) }))
    .filter((row) => validId(row.serviceId) && Number.isInteger(row.openedAt));
  const byService = new Map(rows.map((row) => [row.serviceId, row]));
  const results = [];

  for (const row of rows) {
    const upstreamEdges = edges.filter((edge) => edge.serviceId === row.serviceId);
    const hasEarlierDependency = upstreamEdges.some((edge) => {
      const dependencyIncident = byService.get(edge.dependsOnServiceId);
      return dependencyIncident && dependencyIncident.openedAt <= row.openedAt && row.openedAt - dependencyIncident.openedAt <= correlationWindowMs;
    });
    if (hasEarlierDependency) continue;

    const affected = edges
      .filter((edge) => edge.dependsOnServiceId === row.serviceId)
      .map((edge) => byService.get(edge.serviceId))
      .filter((dependent) => dependent && dependent.openedAt >= row.openedAt && dependent.openedAt - row.openedAt <= correlationWindowMs)
      .map((dependent) => dependent.serviceId)
      .sort();
    if (affected.length) results.push({ serviceId: row.serviceId, affects: affected, wording: 'possibly affected downstream services' });
  }

  return results.sort((left, right) => left.serviceId.localeCompare(right.serviceId));
}
