import { test, expect } from '@playwright/test';

test.describe('Infrastructure & Health Endpoints', () => {
  test.beforeEach(async ({ page }) => {
    // Visit a page first to establish session and CSRF cookies
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');
  });

  test('GET /api/health returns healthy status with services', async ({ page }) => {
    const res = await page.request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.services).toBeDefined();
    expect(body.services).toHaveProperty('database');
    expect(body.services).toHaveProperty('redis');
    expect(body.services).toHaveProperty('ai');
    expect(body.services).toHaveProperty('storage');
  });

  test('GET /api/ready returns ready status', async ({ page }) => {
    const res = await page.request.get('/api/ready');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  test('GET /api/metrics returns Prometheus format text', async ({ page }) => {
    const res = await page.request.get('/api/metrics');
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('http_request');
  });

  test('GET /api/billing/pricing returns 3 tiers with expected prices', async ({ page }) => {
    const res = await page.request.get('/api/billing/pricing');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Response may be a direct array or wrapped in { tiers: [...] }
    const tiers = Array.isArray(body) ? body : body.tiers;
    expect(tiers).toBeDefined();
    expect(tiers).toHaveLength(3);

    const free = tiers.find((t: { tier?: string }) => t.tier === 'free');
    const pro = tiers.find((t: { tier?: string }) => t.tier === 'pro');
    const enterprise = tiers.find((t: { tier?: string }) => t.tier === 'enterprise');

    expect(free).toBeDefined();
    expect(free.monthlyPriceEur).toBe(0);
    expect(pro).toBeDefined();
    expect(pro.monthlyPriceEur).toBe(29);
    expect(enterprise).toBeDefined();
  });

  test('GET /api/billing/info returns userId and tier', async ({ page }) => {
    const res = await page.request.get('/api/billing/info');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('userId');
    expect(body).toHaveProperty('tier');
  });

  test('GET /api/v1/user/preferences returns preferences object', async ({ page }) => {
    const res = await page.request.get('/api/v1/user/preferences');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Response may be a flat preferences object or wrapped in { preferences: {...} }
    const hasPrefs = body.preferences !== undefined || body.defaultModel !== undefined;
    expect(hasPrefs).toBe(true);
  });

  test('GET /api/auth/consent returns success with data array', async ({ page }) => {
    const res = await page.request.get('/api/auth/consent');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/v1/audit returns success with data array', async ({ page }) => {
    const res = await page.request.get('/api/v1/audit');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/v1/audit/integrity returns success with totalChecked', async ({ page }) => {
    const res = await page.request.get('/api/v1/audit/integrity');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('totalChecked');
  });
});
