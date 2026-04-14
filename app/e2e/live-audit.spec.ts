import { test, expect } from '@playwright/test';

const BASE_URL = 'https://fondeu-platform-857599941951.europe-west2.run.app';

test.describe('Live Site Audit', () => {
  // ─── Public Pages ────────────────────────────────────

  test('homepage loads and redirects to /ro', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toContain('/ro');
    await expect(page.locator('text=FondEU')).toBeVisible({ timeout: 15000 });
  });

  test('login page has OAuth and email options', async ({ page }) => {
    await page.goto(`${BASE_URL}/ro/autentificare`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Google/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Microsoft/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/email/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('login page loads', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/ro/autentificare`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
  });

  test('English locale works', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/en`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toContain('/en');
  });

  test('pricing page loads with tiers', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/ro/preturi`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Enterprise' })).toBeVisible({ timeout: 15000 });
  });

  // ─── Auth Redirects ──────────────────────────────────

  test('dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE_URL}/ro/proiecte`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/autentificare', { timeout: 15000 });
    expect(page.url()).toContain('/autentificare');
  });

  test('finantari redirects to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE_URL}/ro/finantari`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/autentificare', { timeout: 15000 });
    expect(page.url()).toContain('/autentificare');
  });

  // ─── API Health ──────────────────────────────────────

  test('health endpoint responds', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.status()).toBeLessThan(500);
  });

  test('auth providers endpoint responds', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/providers`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('google');
  });

  test('auth csrf endpoint responds', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/csrf`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('csrfToken');
  });

  test('auth session endpoint responds', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/session`);
    expect(response.status()).toBe(200);
  });

  test('protected API returns 401 without auth', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/admin/feature-flags`);
    expect(response.status()).toBe(401);
  });

  test('orchestrator message API returns 401 without auth', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/ai/orchestrator/message`, {
      data: { message: 'test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(401);
  });

  // ─── Security Headers ───────────────────────────────

  test('security headers are present', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/ro`);
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['content-security-policy']).toBeTruthy();
    expect(headers['x-csrf-token']).toBeTruthy();
  });

  // ─── Console Errors ─────────────────────────────────

  test('no console errors on homepage', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE_URL}/ro`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    console.log('Console errors found:', errors);
    expect(errors).toHaveLength(0);
  });

  test('no console errors on login page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${BASE_URL}/ro/autentificare`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    console.log('Login page console errors:', errors);
    expect(errors).toHaveLength(0);
  });

  // ─── 404 Handling ────────────────────────────────────

  test('404 page renders for unknown routes', async ({ page }) => {
    await page.goto(`${BASE_URL}/ro/nonexistent-page-xyz`, { waitUntil: 'domcontentloaded' });
    // Should render something, not a blank page
    const bodyText = await page.textContent('body');
    expect(bodyText?.length).toBeGreaterThan(0);
  });

  // ─── AI Gateway ──────────────────────────────────────

  test('AI gateway health check', async ({ request }) => {
    const response = await request.get('https://ai-gateway-j3dqdqxnyq-lm.a.run.app/health');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.providers).toContain('openai');
    expect(data.providers).toContain('claude');
    console.log('AI Gateway health:', JSON.stringify(data));
  });

  // ─── Performance ─────────────────────────────────────

  test('homepage loads within 15s', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}/ro`, { waitUntil: 'domcontentloaded' });
    const loadTime = Date.now() - start;
    console.log(`Homepage load time: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(15000);
  });
});
