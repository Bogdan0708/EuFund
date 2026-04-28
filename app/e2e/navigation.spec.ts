import { test, expect } from '@playwright/test';

test.describe('Navigation — browser-critical edges', () => {
  test('404 page shows custom error content', async ({ page }) => {
    const response = await page.goto('/ro/nonexistent');
    expect(response?.status()).toBe(404);

    await expect(page.getByRole('heading', { name: '404' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Pagina nu a fost găsită')).toBeVisible();
  });

  test('locale root /ro redirects to /ro/panou', async ({ page }) => {
    await page.goto('/ro');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/ro\/panou/, { timeout: 10_000 });
  });
});
