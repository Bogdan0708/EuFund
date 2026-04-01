import { test, expect } from '@playwright/test';

test.describe('Documents Page', () => {
  test('loads with heading "Fișiere"', async ({ page }) => {
    await page.goto('/ro/documente');
    await expect(page.getByRole('heading', { name: 'Fișiere' })).toBeVisible();
  });

  test('shows section headings', async ({ page }) => {
    await page.goto('/ro/documente');
    await expect(page.getByRole('heading', { name: 'Documente Proiect' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Conformitate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Șabloane Inteligente' })).toBeVisible();
  });

  test('has main element and no error states', async ({ page }) => {
    await page.goto('/ro/documente');
    await expect(page.locator('main')).toBeVisible();
    // Ensure no error-like text is displayed
    await expect(page.getByText('500')).not.toBeVisible();
    await expect(page.getByText('Error')).not.toBeVisible();
  });
});
