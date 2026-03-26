/**
 * Auth-aware fetch helpers for the Document Manager API.
 *
 * Uses the Stack Auth backend integration pattern documented at
 * https://docs.stack-auth.com/concepts/backend-integration:
 *
 *   const { accessToken } = await user.getAuthJson();
 *   const response = await fetch('/api/...', {
 *     headers: { 'x-stack-access-token': accessToken },
 *   });
 */
import { stackApp } from './stack';

/**
 * Build the Stack Auth request headers for the current user.
 * Returns an empty object when no user is signed in.
 */
export async function getAuthHeaders() {
  const user = await stackApp.getUser();
  if (!user) return {};
  const { accessToken } = await user.getAuthJson();
  return accessToken ? { 'x-stack-access-token': accessToken } : {};
}

/**
 * Drop-in replacement for `fetch` that automatically attaches the
 * Stack Auth access token header to every request.
 */
export async function apiFetch(url, options = {}) {
  const authHeaders = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers || {}),
    },
  });
}
