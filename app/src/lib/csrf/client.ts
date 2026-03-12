// ─── Client-side CSRF Token Helper ──────────────────────────────
// Read token from bootstrap meta/header (not cookies), send as X-CSRF-Token header

let csrfTokenCache: string | null = null;
let bootstrapPromise: Promise<string | null> | null = null;

function cacheToken(token: string | null): void {
  if (!token) return;
  csrfTokenCache = token;
}

function captureTokenFromResponse(response: Response): void {
  cacheToken(response.headers.get('X-CSRF-Token'));
}

export async function bootstrapCSRFToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      captureTokenFromResponse(response);
      return csrfTokenCache;
    } catch {
      return csrfTokenCache;
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

/**
 * Read the CSRF token from in-memory cache or meta bootstrap.
 */
export function getCSRFToken(): string | null {
  if (csrfTokenCache) return csrfTokenCache;
  return null;
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
  const method = (
    init?.method ||
    (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const needsCSRF = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  const headers = new Headers(
    init?.headers ||
    (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
  );

  if (needsCSRF) {
    const token = getCSRFToken() || await bootstrapCSRFToken();
    if (!token) {
      throw new Error('CSRF token unavailable. Please reload the page and try again.');
    }
    if (!headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token);
    }
  }

  const response = await fetch(input, { ...init, headers });
  captureTokenFromResponse(response);
  return response;
}
