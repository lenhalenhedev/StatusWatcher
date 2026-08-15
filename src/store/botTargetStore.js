import { archiveTarget, listTargets } from '../utils/uptimeTracker.js';

export function listMonitoredBots() {
  return listTargets({ activeOnly: true }).filter((target) => target.type === 'bot');
}

export function archiveMonitoredBots(ids) {
  for (const id of ids) archiveTarget(id);
}
