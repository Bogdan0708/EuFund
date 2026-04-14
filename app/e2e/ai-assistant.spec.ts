import { test, expect } from '@playwright/test';

test.describe('AI Assistant Page', () => {
  test('loads with heading "Curator Strategie Granturi"', async ({ page }) => {
    await page.goto('/ro/asistent-ai');
    await expect(page.getByRole('heading', { name: 'Curator Strategie Granturi' })).toBeVisible();
  });

  test('has canvas section with heading "Canvas Propunere de Grant"', async ({ page }) => {
    await page.goto('/ro/asistent-ai');
    await expect(page.getByRole('heading', { name: 'Canvas Propunere de Grant' })).toBeVisible();
  });

  test('has main element', async ({ page }) => {
    await page.goto('/ro/asistent-ai');
    await expect(page.locator('main')).toBeVisible();
  });

  test('API: GET /api/ai/orchestrator/sessions returns sessions array', async ({ page }) => {
    await page.goto('/ro/asistent-ai');

    const response = await page.request.get('/api/ai/orchestrator/sessions');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test('API: POST /api/ai/check-eligibility returns 400 validation error', async ({ page }) => {
    await page.goto('/ro/asistent-ai');

    const csrfCookie = (await page.context().cookies()).find(c => c.name === 'csrf-token');
    const csrf = csrfCookie?.value || '';

    const response = await page.request.post('/api/ai/check-eligibility', {
      headers: {
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      data: { projectId: '92598985-9804-46ed-a30c-c9809b2d54e0' },
    });

    expect(response.status()).toBe(400);
  });
});
