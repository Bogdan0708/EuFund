import { test, expect } from '@playwright/test';

test.describe('Admin API & Integration Endpoints', () => {
  let csrf: string;

  test.beforeEach(async ({ page }) => {
    // Visit a page first to establish session and CSRF cookies
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');

    // Extract CSRF token from cookies
    const csrfCookie = (await page.context().cookies()).find(c => c.name === 'csrf-token');
    csrf = csrfCookie?.value || '';
  });

  // --- Admin endpoints ---

  test('GET /api/v1/admin/feature-flags returns success', async ({ page }) => {
    const res = await page.request.get('/api/v1/admin/feature-flags');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('GET /api/v1/admin/programs returns 5 programs', async ({ page }) => {
    const res = await page.request.get('/api/v1/admin/programs');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(5);
  });

  test('GET /api/v1/admin/funding-ai/documents returns success', async ({ page }) => {
    const res = await page.request.get('/api/v1/admin/funding-ai/documents');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('GET /api/v1/admin/funding-ai/review-queue returns success', async ({ page }) => {
    const res = await page.request.get('/api/v1/admin/funding-ai/review-queue');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Response shape: { success: true, data: { items: [], page: 1, perPage: 20 } }
    expect(body.data).toBeDefined();
    const items = body.data.items ?? body.data;
    expect(Array.isArray(items)).toBe(true);
  });

  // --- Integration endpoints ---

  test('GET /api/integrations/cordis returns projects array', async ({ page }) => {
    const res = await page.request.get('/api/integrations/cordis?query=horizon');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.projects)).toBe(true);
  });

  test('GET /api/integrations/funding-calls returns calls array', async ({ page }) => {
    test.setTimeout(60_000);
    let res;
    try {
      res = await page.request.get('/api/integrations/funding-calls', { timeout: 55_000 });
    } catch {
      test.skip(true, 'EU portal API timed out — external dependency unavailable');
      return;
    }
    // External API may be slow or unavailable
    if (res.status() === 200) {
      const body = await res.json();
      const calls = body.calls ?? body.data ?? [];
      expect(Array.isArray(calls)).toBe(true);
    } else {
      expect([200, 502, 503]).toContain(res.status());
    }
  });

  test('GET /api/integrations/eurlex/search returns 200', async ({ page }) => {
    const res = await page.request.get('/api/integrations/eurlex/search?q=fonduri');
    expect(res.status()).toBe(200);
  });

  test('GET /api/integrations/eurostat accepts valid nutsCode', async ({ page }) => {
    test.setTimeout(60_000);
    let res;
    try {
      res = await page.request.get('/api/integrations/eurostat?nutsCode=RO', { timeout: 55_000 });
    } catch {
      test.skip(true, 'Eurostat API timed out — external dependency unavailable');
      return;
    }
    const status = res.status();

    if (status === 200) {
      // Upstream healthy — verify our response has the expected shape
      const body = await res.json();
      expect(body.nutsCode).toBe('RO');
      expect(body.data).toBeDefined();
    } else if (status === 500) {
      // 500 is only acceptable if it's an upstream Eurostat passthrough,
      // not a crash in our code. Verify the error message proves it.
      const body = await res.json();
      expect(body.error?.message).toContain('Eurostat');
    } else if (status === 503) {
      // Circuit breaker open — upstream unreachable
    } else {
      // 400 = our validation rejected valid input RO (bug), anything else unexpected
      throw new Error(`Unexpected status ${status} for valid nutsCode=RO`);
    }
  });

  // --- AI endpoints ---

  test('GET /api/ai/orchestrator/sessions returns sessions array', async ({ page }) => {
    const res = await page.request.get('/api/ai/orchestrator/sessions');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  // --- Mutation endpoints (require CSRF) ---

  test('POST /api/auth/onboarding with profile step returns 200', async ({ page }) => {
    const res = await page.request.post('/api/auth/onboarding', {
      headers: {
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      data: {
        step: 'profile',
        fullName: 'Test User',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('PUT /api/v1/user/preferences returns 200', async ({ page }) => {
    const res = await page.request.put('/api/v1/user/preferences', {
      headers: {
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      data: {},
    });
    expect(res.status()).toBe(200);
  });
});
