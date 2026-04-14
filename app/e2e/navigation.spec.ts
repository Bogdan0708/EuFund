import { test, expect } from '@playwright/test';

test.describe('Sidebar navigation', () => {
  const sidebarLinks = [
    { href: '/ro/panou', label: /Acasă/i },
    { href: '/ro/proiecte', label: /Proiecte/i },
    { href: '/ro/finantari', label: /Apeluri de finanțare/i },
    { href: '/ro/documente', label: /Fișiere/i },
    { href: '/ro/asistent-ai', label: /Asistent AI/i },
    { href: '/ro/setari', label: /Setări/i },
  ];

  test('all 6 sidebar navigation links are visible on dashboard', async ({ page }) => {
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');

    for (const link of sidebarLinks) {
      const anchor = page.locator(`a[href="${link.href}"]`).first();
      await expect(anchor).toBeVisible({ timeout: 10_000 });
    }
  });

  const routes = [
    { href: '/ro/panou', heading: /Panou principal/i },
    { href: '/ro/proiecte', heading: /Proiecte/i },
    { href: '/ro/finantari', heading: /Oportunitate Strategică/i },
    { href: '/ro/documente', heading: /Fișiere/i },
    { href: '/ro/asistent-ai', heading: /Curator Strategie Granturi/i },
    { href: '/ro/setari', heading: /Cont și Preferințe/i },
  ];

  for (const route of routes) {
    test(`sidebar link navigates to ${route.href} with correct heading`, async ({ page }) => {
      // Start on dashboard
      await page.goto('/ro/panou');
      await page.waitForLoadState('networkidle');

      // Click the sidebar link
      await page.locator(`a[href="${route.href}"]`).first().click();
      await page.waitForLoadState('networkidle');

      // Verify URL
      await expect(page).toHaveURL(new RegExp(route.href));

      // Verify heading
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible({
        timeout: 10_000,
      });
    });
  }

  for (const route of routes) {
    test(`${route.href} has <main> element and at least one heading`, async ({ page }) => {
      await page.goto(route.href);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

      const headings = page.getByRole('heading');
      await expect(headings.first()).toBeVisible({ timeout: 10_000 });
    });
  }

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
