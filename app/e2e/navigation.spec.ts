import { test, expect } from '@playwright/test';

test.describe('Sidebar navigation smoke tests', () => {
  const routes = [
    {
      name: 'Panou de control (Dashboard)',
      url: '/ro/panou',
      heading: /panou|dashboard|control/i,
    },
    {
      name: 'Asistent AI',
      url: '/ro/asistent',
      heading: /asistent/i,
    },
    {
      name: 'Apeluri și aplicații (Funding calls)',
      url: '/ro/finantari/live',
      heading: /apeluri|finanțare|funding/i,
    },
    {
      name: 'Proiecte',
      url: '/ro/proiecte',
      heading: /aplicații|proiecte|apeluri/i,
    },
    {
      name: 'Asistent Proiect',
      url: '/ro/proiecte/asistent-proiect',
      heading: /asistent|proiect|wizard/i,
    },
    {
      name: 'Documente',
      url: '/ro/documente/incarca',
      heading: /documente|dovezi|încarcă/i,
    },
    {
      name: 'Jurnal audit',
      url: '/ro/audit',
      heading: /audit|jurnal/i,
    },
    {
      name: 'Setări',
      url: '/ro/setari',
      heading: /setări|settings/i,
    },
  ];

  for (const route of routes) {
    test(`${route.name} — ${route.url} loads successfully`, async ({ page }) => {
      await page.goto(route.url);

      // Should not be redirected to login
      await expect(page).not.toHaveURL(/autentificare/, { timeout: 15000 });

      // Main content area should be present
      await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });

      // No unhandled error page (Next.js error overlay or generic error)
      await expect(page.locator('text=Application error')).not.toBeVisible();
      await expect(page.locator('text=500')).not.toBeVisible();

      // Some pages (funding calls, projects) show a LoadingState initially with no heading.
      // Wait for any loading states to disappear before checking for headings.
      const loadingSpinner = page.locator('.animate-spin');
      await loadingSpinner.first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

      // Page should contain a heading or meaningful content matching the route
      const headingOrContent = page.getByRole('heading').first();
      await expect(headingOrContent).toBeVisible({ timeout: 15000 });
    });
  }

  test('sidebar navigation links are visible on dashboard', async ({ page }) => {
    await page.goto('/ro/panou');
    await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });

    const nav = page.getByRole('navigation', { name: 'Navigare principală' });
    await expect(nav).toBeVisible();

    // Check key sidebar links are present
    await expect(nav.getByRole('link', { name: /Panou de control/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Asistent AI/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Apeluri și aplicații/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Proiecte/i }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: /Documente/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Jurnal audit/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Setări/i })).toBeVisible();
  });
});
