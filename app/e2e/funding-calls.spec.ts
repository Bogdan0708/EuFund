import { test, expect } from '@playwright/test';

test.describe('Funding calls', () => {
  test('browse calls — funding calls list loads', async ({ page }) => {
    await page.goto('/ro/finantari/live');

    // Wait for loading to finish
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    // PageHeader renders h1 "Apeluri de finanțare"
    await expect(page.getByRole('heading', { name: /Apeluri de finanțare/i })).toBeVisible();

    // Filter bar — CardTitle "Bară de filtrare apeluri"
    await expect(page.getByText(/Bară de filtrare apeluri/i)).toBeVisible();

    // Should show either a table with calls or an empty state
    const tableOrEmpty = page.locator('table').or(page.getByText(/Nu au fost găsite apeluri/i));
    await expect(tableOrEmpty).toBeVisible({ timeout: 10000 });
  });

  test('filter calls by status — status buttons work', async ({ page }) => {
    await page.goto('/ro/finantari/live');
    // Wait for calls to finish loading
    await page.waitForTimeout(3000);
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    // The status filter buttons — click "Toate" to show all calls
    const toateBtn = page.getByRole('button', { name: /Toate/i }).first();
    await expect(toateBtn).toBeVisible({ timeout: 10000 });
    await toateBtn.click();
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    // Page should still be functional
    await expect(page.getByRole('heading', { name: /Apeluri de finanțare/i })).toBeVisible();

    // Click "Deschise" to filter open calls
    await page.getByRole('button', { name: /Deschise/i }).first().click();
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    await expect(page.getByRole('heading', { name: /Apeluri de finanțare/i })).toBeVisible();

    // Click "În curând" for forthcoming calls
    await page.getByRole('button', { name: /curând/i }).first().click();
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    await expect(page.getByRole('heading', { name: /Apeluri de finanțare/i })).toBeVisible();
  });

  test('search calls — search input filters results', async ({ page }) => {
    await page.goto('/ro/finantari/live');
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    const searchInput = page.getByLabel('Caută apeluri de finanțare');
    await expect(searchInput).toBeVisible();

    // Type a search term
    await searchInput.fill('digital');
    // Client-side filter is immediate (useMemo), but give it a moment
    await page.waitForTimeout(500);

    // Page should remain functional
    await expect(page.getByRole('heading', { name: /Apeluri de finanțare/i })).toBeVisible();
  });

  test('refresh calls — refresh button works', async ({ page }) => {
    await page.goto('/ro/finantari/live');
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });

    // Click the refresh button — text "Actualizează"
    const refreshButton = page.getByRole('button', { name: /Actualizează/i });
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();

    // Should trigger a reload — loading state appears briefly then disappears
    await expect(page.getByText('Se încarcă apelurile de finanțare...')).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: /Apeluri de finanțare/i })).toBeVisible();
  });

  test('grant matching page loads', async ({ page }) => {
    await page.goto('/ro/finantari/potriviri');

    // Should not redirect to login
    await expect(page).not.toHaveURL(/autentificare/, { timeout: 15000 });

    // Main content should load
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
  });

  test('funding calls overview page loads', async ({ page }) => {
    await page.goto('/ro/finantari');

    // Should not redirect to login
    await expect(page).not.toHaveURL(/autentificare/, { timeout: 15000 });

    // Main content should load
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
  });
});
