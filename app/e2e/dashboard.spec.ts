import { test, expect } from '@playwright/test';

test.describe('Dashboard (authenticated)', () => {
  test('dashboard loads with heading "Panou principal"', async ({ page }) => {
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');

    // Should be on the dashboard, not redirected to login
    await expect(page).toHaveURL(/\/ro\/panou/);

    // Verify the main heading
    await expect(
      page.getByRole('heading', { name: /Panou principal/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('dashboard has navigation and main content area', async ({ page }) => {
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');

    // Navigation is present
    const nav = page.locator('nav');
    await expect(nav.first()).toBeVisible({ timeout: 10_000 });

    // Main content area is present
    await expect(page.locator('main')).toBeVisible();

    // At least one heading is visible
    const headings = page.getByRole('heading');
    await expect(headings.first()).toBeVisible();
  });

  test('no error states visible on dashboard', async ({ page }) => {
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');

    // No Next.js error overlay or generic server error
    await expect(page.getByText('Application error')).not.toBeVisible();
    await expect(page.getByText('500')).not.toBeVisible();
    await expect(page.getByText('Internal Server Error')).not.toBeVisible();
  });
});
