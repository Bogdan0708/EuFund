// ─── Client-side CSRF Token Helper ──────────────────────────────
// Read token from bootstrap meta/header (not cookies), send as X-CSRF-Token header

let csrfTokenCache: string | null = null;
let bootstrapPromise: Promise<string | null> | null = null;

function readTokenFromMeta(): string | null {
  if (typeof document === 'undefined') return null;
  const tag = document.querySelector('meta[name="csrf-token"]');
  const value = tag?.getAttribute('content')?.trim();
  return value ? value : null;
}

function cacheToken(token: string | null): void {
  if (!token) return;
  csrfTokenCache = token;

  if (typeof document === 'undefined') return;
  const tag = document.querySelector('meta[name="csrf-token"]');
  if (tag) {
    tag.setAttribute('content', token);
  }
}

function captureTokenFromResponse(response: Response): void {
  cacheToken(response.headers.get('X-CSRF-Token'));
}

async function bootstrapCSRFToken(): Promise<string | null> {
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
      return getCSRFToken();
    } catch {
      return getCSRFToken();
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
  const metaToken = readTokenFromMeta();
  if (metaToken) {
    csrfTokenCache = metaToken;
    return metaToken;
  }
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
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token);
    }
  }

  const response = await fetch(input, { ...init, headers });
  captureTokenFromResponse(response);
  return response;
}
