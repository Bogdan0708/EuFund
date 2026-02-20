// ─── Client-side CSRF Token Helper ──────────────────────────────
// Double-submit cookie pattern: read csrf-token cookie, send as X-CSRF-Token header

/**
 * Read the CSRF token from the cookie (set by middleware).
 */
export function getCSRFToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Returns headers object including CSRF token for state-changing requests.
 */
export function csrfHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const token = getCSRFToken();
  return {
    ...(token ? { 'X-CSRF-Token': token } : {}),
    ...extraHeaders,
  };
}

/**
 * Wrapper around fetch that automatically includes CSRF token
 * for state-changing methods (POST, PUT, DELETE, PATCH).
 */
export async function csrfFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const needsCSRF = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  if (needsCSRF) {
    const token = getCSRFToken();
    const headers = new Headers(init?.headers);
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token);
    }
    return fetch(input, { ...init, headers });
  }

  return fetch(input, init);
}
