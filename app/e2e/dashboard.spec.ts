import { test, expect } from '@playwright/test';

test.describe('Dashboard (authenticated)', () => {
  test('dashboard loads after login', async ({ page }) => {
    await page.goto('/ro/panou');

    // Should be on the dashboard, not redirected to login
    await expect(page).toHaveURL(/\/ro\/panou/);
    await expect(page.getByLabel('Adresă de email')).not.toBeVisible();
  });

  test('navigation elements are present', async ({ page }) => {
    await page.goto('/ro/panou');

    // Verify key navigation links exist
    await expect(page.getByRole('navigation', { name: 'Navigare principală' })).toBeVisible();

    // Check for common dashboard nav items
    await expect(page.getByRole('link', { name: /proiecte/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /documente/i })).toBeVisible();
  });

  test('key dashboard sections are visible', async ({ page }) => {
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');

    // The dashboard should have meaningful content (headings, sections)
    const headings = page.getByRole('heading');
    await expect(headings.first()).toBeVisible();

    // The main content area should be present
    await expect(page.getByRole('main')).toBeVisible();
  });
});
