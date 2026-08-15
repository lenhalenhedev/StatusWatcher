import http from 'http';
import config from '../config.js';
import { logError, logInfo } from '../utils/logger.js';

/**
 * Start a tiny HTTP health-check server so an external uptime monitor can watch
 * this monitor bot itself.
 *
 * GET /health (or /healthz) returns JSON describing liveness. The HTTP status
 * is 200 when the gateway connection is healthy and 503 when degraded, so
 * standard uptime checks can alert on the monitor going dark.
 *
 * @param {() => object} getSnapshot - returns a serializable health snapshot
 *   that must include a boolean `connected` field.
 * @returns {import('http').Server|null} the server, or null when disabled.
 */
export function startHealthServer(getSnapshot) {
  if (!config.healthPort) {
    logInfo('HealthServer', 'Disabled (HEALTH_PORT is 0 or unset).');
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
      const snapshot = getSnapshot();
      const healthy = Boolean(snapshot.connected);
      const body = JSON.stringify({ status: healthy ? 'ok' : 'degraded', ...snapshot });
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', (err) => logError('HealthServer', err));
  server.listen(config.healthPort, () => {
    logInfo('HealthServer', `Listening on port ${config.healthPort} at /health`);
  });

  return server;
}
