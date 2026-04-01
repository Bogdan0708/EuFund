import { test, expect } from '@playwright/test';

test.describe('Projects page', () => {
  test('projects page loads with heading "Proiecte"', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await expect(page.getByRole('heading', { name: /Proiecte/i })).toBeVisible({ timeout: 15000 });
  });

  test('project cards are displayed', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await expect(page.getByRole('heading', { name: /Proiecte/i })).toBeVisible({ timeout: 15000 });

    // Verify project titles appear as headings (stable locator, not CSS class)
    const projectHeadings = page.getByRole('heading', { level: 3 });
    await expect(projectHeadings.first()).toBeVisible({ timeout: 10000 });
    expect(await projectHeadings.count()).toBeGreaterThanOrEqual(1);
  });

  test('project detail page loads with tabs', async ({ page }) => {
    await page.goto('/ro/proiecte/92598985-9804-46ed-a30c-c9809b2d54e0');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15000 });

    // Verify the 4 tabs exist
    await expect(page.getByRole('tab', { name: /Prezentare/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: /Documente/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Sarcini/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Cronologie/i })).toBeVisible();
  });

  test('project detail tabs are navigable', async ({ page }) => {
    await page.goto('/ro/proiecte/92598985-9804-46ed-a30c-c9809b2d54e0');
    await page.waitForLoadState('networkidle');

    const prezentareTab = page.getByRole('tab', { name: /Prezentare/i });
    await expect(prezentareTab).toBeVisible({ timeout: 15000 });

    // Prezentare tab active by default
    await expect(page.getByRole('tabpanel')).toBeVisible({ timeout: 10000 });

    // Click each tab and wait for panel content to update (not a fixed sleep)
    for (const tabName of ['Documente', 'Sarcini', 'Cronologie']) {
      const tab = page.getByRole('tab', { name: new RegExp(tabName, 'i') });
      await tab.click();
      await expect(page.getByRole('tabpanel')).toBeVisible({ timeout: 5000 });
    }

    // Navigate back to Prezentare
    await prezentareTab.click();
    await expect(page.getByRole('tabpanel')).toBeVisible({ timeout: 5000 });
  });

  test('API: GET /api/v1/projects returns success with items', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('networkidle');

    const response = await page.request.get('/api/v1/projects');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.items).toBeInstanceOf(Array);
    expect(body.data.items.length).toBeGreaterThan(0);

    const first = body.data.items[0];
    expect(first.id).toBeDefined();
    expect(first.title).toBeDefined();
    expect(first.status).toBeDefined();
  });

  test('API: POST /api/v1/projects with invalid title returns 400', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('networkidle');

    const cookies = await page.context().cookies();
    const csrfCookie = cookies.find(c => c.name === 'csrf-token');
    const csrf = csrfCookie?.value || '';

    const response = await page.request.post('/api/v1/projects', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      data: {
        title: 'short', // Less than 10 chars — should fail validation
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success === false || body.error !== undefined).toBeTruthy();
  });
});
