import { test, expect } from '@playwright/test';

test.describe('Security Headers', () => {
  test('security headers present on /api/health', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );
    expect(headers['content-security-policy']).toBeDefined();
  });

  test('CSP header contains nonce pattern', async ({ request }) => {
    const res = await request.get('/api/health');
    const csp = res.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/'nonce-[A-Za-z0-9_-]+'/);
    expect(csp).toContain("'strict-dynamic'");
  });

  test('x-request-id header is a UUID on responses', async ({ request }) => {
    const res = await request.get('/api/health');
    const requestId = res.headers()['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test('X-CSRF-Token header is set on page responses', async ({ page }) => {
    const response = await page.goto('/ro/panou');
    expect(response).not.toBeNull();
    const csrfToken = response!.headers()['x-csrf-token'];
    expect(csrfToken).toBeDefined();
    expect(csrfToken!.length).toBeGreaterThan(0);
  });
});

test.describe('CSRF Protection', () => {
  test('POST /api/v1/projects without X-CSRF-Token returns 403', async ({
    request,
  }) => {
    const res = await request.post('/api/v1/projects', {
      data: { name: 'Test Project' },
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('CSRF_REQUIRED');
  });
});

test.describe('Public Endpoints (Unauthenticated)', () => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002';

  // Fresh request context without auth cookies — Playwright's request
  // fixture carries storageState from auth.setup, so we need a clean one.
  test('/api/health accessible without auth', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const res = await ctx.get('/api/health');
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });

  test('/api/ready accessible without auth', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const res = await ctx.get('/api/ready');
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });

  test('GET /api/v1/projects without auth returns 401', async ({ playwright }) => {
    // storageState: undefined ensures no cookies/localStorage leak from auth.setup
    const ctx = await playwright.request.newContext({ baseURL, storageState: undefined });
    const res = await ctx.get('/api/v1/projects');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Authentication required');
    await ctx.dispose();
  });
});
