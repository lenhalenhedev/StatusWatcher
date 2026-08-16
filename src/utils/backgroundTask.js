import { logError } from './logger.js';

/**
 * Execute non-critical background work without creating an unhandled rejection.
 * The task result is preserved on success; failures are logged and converted to
 * an undefined result so timer and cron callers can safely use `void`.
 *
 * @template T
 * @param {string} context
 * @param {() => T | PromiseLike<T>} task
 * @returns {Promise<T | undefined>}
 */
export function runBackgroundTask(context, task) {
  return Promise.resolve()
    .then(task)
    .catch((error) => {
      void Promise.resolve()
        .then(() => logError(context, error))
        .catch(() => undefined);
      return undefined;
    });
}
