import { describe, it, expect, vi } from 'vitest';

// Mock the auth wrapper so middleware can run synchronously
vi.mock('@/lib/auth/edge', () => ({
  auth: (handler: any) => handler,
}));
vi.mock('@/lib/monitoring/metrics', () => ({
  trackRequest: vi.fn(),
}));

const makeReq = (overrides: {
  pathname?: string;
  method?: string;
  authorization?: string;
  authed?: boolean;
} = {}) => {
  const url = `https://example.run.app${overrides.pathname ?? '/api/v1/admin/discovery/run'}`;
  const headers = new Headers();
  if (overrides.authorization) headers.set('authorization', overrides.authorization);
  return {
    nextUrl: { pathname: overrides.pathname ?? '/api/v1/admin/discovery/run' },
    method: overrides.method ?? 'POST',
    headers,
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
    url,
    auth: overrides.authed ? { user: { emailVerified: true, onboardingCompleted: true } } : undefined,
  };
};

describe('middleware Scheduler bypass', () => {
  it('does NOT 401 when Authorization is Bearer for the discovery endpoint', async () => {
    const middleware = (await import('@/middleware')).default as any;
    const res = await middleware(makeReq({ authorization: 'Bearer abc.def.ghi' }));
    expect(res?.status ?? 200).not.toBe(401);
  });

  it('does NOT 403 (CSRF_REQUIRED) when Authorization is Bearer for the discovery endpoint', async () => {
    const middleware = (await import('@/middleware')).default as any;
    const res = await middleware(makeReq({ authorization: 'Bearer abc.def.ghi' }));
    if (res && typeof res.json === 'function') {
      const body = await res.json().catch(() => null);
      if (body) expect(body.code).not.toBe('CSRF_REQUIRED');
    }
  });

  it('still 401s for unauthenticated requests to other API routes', async () => {
    const middleware = (await import('@/middleware')).default as any;
    const res = await middleware(makeReq({ pathname: '/api/v1/projects', authed: false, method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('still requires CSRF for POSTs to other API routes', async () => {
    const middleware = (await import('@/middleware')).default as any;
    const res = await middleware(makeReq({ pathname: '/api/v1/projects', authed: true, method: 'POST' }));
    const body = await res.json().catch(() => null);
    expect(body?.code).toBe('CSRF_REQUIRED');
  });

  it('still 401s when the discovery endpoint is hit WITHOUT a Bearer header', async () => {
    const middleware = (await import('@/middleware')).default as any;
    const res = await middleware(makeReq({ authorization: undefined }));
    expect(res.status).toBe(401);
  });
});
