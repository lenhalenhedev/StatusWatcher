import { listTargets } from '../utils/uptimeTracker.js';

// Aliases that always resolve to the Minecraft target.
const MC_ALIASES = new Set(['mc', 'minecraft', 'minecraft server']);

/**
 * Resolve a free-text query (id, alias, or name) to a single target row.
 * Matching order: exact id -> Minecraft alias -> exact name -> partial name.
 * @param {string} query
 * @returns {object|null}
 */
export function resolveTarget(query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
  if (!q) return null;

  const targets = listTargets();

  const byId = targets.find((t) => t.id.toLowerCase() === q);
  if (byId) return byId;

  if (MC_ALIASES.has(q)) {
    const mc = targets.find((t) => t.type === 'minecraft');
    if (mc) return mc;
  }

  const byName = targets.find((t) => t.name.toLowerCase() === q);
  if (byName) return byName;

  const byPartial = targets.find((t) => t.name.toLowerCase().includes(q));
  return byPartial ?? null;
}

/**
 * Build Discord autocomplete choices for a target option (max 25).
 * @param {string} query - the partially typed value.
 * @returns {Array<{ name: string, value: string }>}
 */
export function buildTargetChoices(query) {
  const q = String(query ?? '').trim().toLowerCase();

  return listTargets()
    .filter((t) => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
    .slice(0, 25)
    .map((t) => ({
      name: `${t.name}${t.status === 'archived' ? ' (archived)' : ''}`.substring(0, 100),
      value: t.id,
    }));
}
