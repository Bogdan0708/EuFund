import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test('loads with heading "Cont și Preferințe"', async ({ page }) => {
    await page.goto('/ro/setari');
    await expect(page.getByRole('heading', { name: 'Cont și Preferințe' })).toBeVisible();
  });

  test('has main element', async ({ page }) => {
    await page.goto('/ro/setari');
    await expect(page.locator('main')).toBeVisible();
  });

  test('API: GET /api/v1/user/preferences returns valid preferences', async ({ page }) => {
    await page.goto('/ro/setari');

    const response = await page.request.get('/api/v1/user/preferences');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('defaultModel');
    expect(body).toHaveProperty('responseStyle');
    expect(body).toHaveProperty('autoApprove');
  });

  test('API: PUT /api/v1/user/preferences updates successfully', async ({ page }) => {
    await page.goto('/ro/setari');

    const csrfCookie = (await page.context().cookies()).find(c => c.name === 'csrf-token');
    const csrf = csrfCookie?.value || '';

    const response = await page.request.put('/api/v1/user/preferences', {
      headers: {
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      data: { defaultModel: 'auto' },
    });

    expect(response.status()).toBe(200);
  });
});
