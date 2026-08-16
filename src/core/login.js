/**
 * Start a Discord login and route failures to the application lifecycle instead
 * of leaving a rejected promise owned by the process-level event loop.
 *
 * @param {{ login: (token: string) => Promise<string> }} client
 * @param {string} token
 * @param {(error: unknown) => void} onError
 * @returns {Promise<string|null>}
 */
export function loginWithHandling(client, token, onError) {
  try {
    return Promise.resolve(client.login(token)).catch((error) => {
      onError(error);
      return null;
    });
  } catch (error) {
    onError(error);
    return Promise.resolve(null);
  }
}
