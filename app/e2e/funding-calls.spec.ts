import { test, expect } from '@playwright/test';

test.describe('Funding calls page', () => {
  test('funding calls page loads with heading containing "Oportunitate"', async ({ page }) => {
    await page.goto('/ro/finantari');
    await page.waitForLoadState('networkidle');

    // Heading includes "Identifică următoarea ta Oportunitate Strategică"
    await expect(
      page.locator('h1').filter({ hasText: /Oportunitate/i })
    ).toBeVisible({ timeout: 15000 });
  });

  test('funding call cards are displayed', async ({ page }) => {
    await page.goto('/ro/finantari');
    await page.waitForLoadState('networkidle');

    // Wait for content to load
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });

    // Funding call titles render as headings inside the page
    const callHeadings = page.getByRole('heading', { level: 3 });
    await expect(callHeadings.first()).toBeVisible({ timeout: 15000 });
    expect(await callHeadings.count()).toBeGreaterThanOrEqual(1);

    // Page has multiple buttons (filter chips and actions)
    const buttons = page.getByRole('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(5);
  });

  test('API: GET /api/v1/calls returns success with calls', async ({ page }) => {
    await page.goto('/ro/finantari');
    await page.waitForLoadState('networkidle');

    const response = await page.request.get('/api/v1/calls');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();

    // Should return an array of calls
    const calls = Array.isArray(body.data) ? body.data : body.data.items || body.data.calls || [];
    expect(calls.length).toBeGreaterThan(0);

    // Each call should have basic fields
    const first = calls[0];
    expect(first.id).toBeDefined();
    expect(first.programId || first.program_id || first.title).toBeDefined();
  });

  test('API: GET /api/v1/admin/programs returns 5 programs', async ({ page }) => {
    await page.goto('/ro/finantari');
    await page.waitForLoadState('networkidle');

    const response = await page.request.get('/api/v1/admin/programs');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();

    const programs = Array.isArray(body.data) ? body.data : body.data.items || body.data.programs || [];
    expect(programs.length).toBe(5);

    // Verify known program names are present
    const names = programs.map((p: { name?: string; code?: string }) => p.name || p.code || '');
    const knownPrograms = ['HORIZON-EUROPE', 'LIFE-PLUS', 'INTERREG-VI', 'POCIDIF', 'PNRR'];
    for (const prog of knownPrograms) {
      expect(names.some((n: string) => n.includes(prog))).toBeTruthy();
    }
  });

  test('API: GET /api/integrations/funding-calls returns EU portal data', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/ro/finantari');
    await page.waitForLoadState('networkidle');

    let response;
    try {
      response = await page.request.get('/api/integrations/funding-calls', { timeout: 55_000 });
    } catch {
      test.skip(true, 'EU portal API timed out — external dependency unavailable');
      return;
    }

    // EU portal may return 200 or 503 if upstream is down — both are valid responses
    if (response.status() === 200) {
      const body = await response.json();
      // Should have some structure with calls/data
      expect(body).toBeDefined();
      // If successful, expect it to contain call data (array or object with items)
      const hasData =
        Array.isArray(body) ||
        Array.isArray(body.data) ||
        Array.isArray(body.calls) ||
        (body.data && Array.isArray(body.data.items));
      expect(hasData).toBeTruthy();
    } else {
      // External API unavailable — 503 is acceptable
      expect([200, 503, 502]).toContain(response.status());
    }
  });
});
