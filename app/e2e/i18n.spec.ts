import { test, expect } from '@playwright/test';

/** Dismiss the cookie consent banner via localStorage to prevent click-blocking. */
async function dismissCookieBanner(page: import('@playwright/test').Page) {
  await page.evaluate(() =>
    localStorage.setItem('eufund:cookie-consent-dismissed:v1', '1')
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test.describe('i18n — Login Page Titles', () => {
  test('Romanian login page has correct title', async ({ page }) => {
    await page.goto('/ro/autentificare');
    await expect(page).toHaveTitle('FondEU \u2013 Platforma de Finan\u021b\u0103ri Europene');
  });

  test('English login page has correct title', async ({ page }) => {
    await page.goto('/en/autentificare');
    await expect(page).toHaveTitle('FondEU \u2013 European Funding Platform');
  });
});

test.describe('i18n — Login Page Content', () => {
  test('Romanian login page has "Continu\u0103 cu Google" text', async ({ page }) => {
    await page.goto('/ro/autentificare');
    await dismissCookieBanner(page);
    await expect(page.locator('text=Continu\u0103 cu Google')).toBeVisible();
  });

  test('Romanian login page has "Conecteaz\u0103-te cu un link magic" text', async ({
    page,
  }) => {
    await page.goto('/ro/autentificare');
    await dismissCookieBanner(page);
    await expect(
      page.locator('text=Conecteaz\u0103-te cu un link magic')
    ).toBeVisible();
  });

  test('English login page has "Continue with Google" text', async ({
    page,
  }) => {
    await page.goto('/en/autentificare');
    await dismissCookieBanner(page);
    await expect(page.locator('text=Continue with Google')).toBeVisible();
  });

  test('English login page has "Sign in with a magic link" text', async ({
    page,
  }) => {
    await page.goto('/en/autentificare');
    await dismissCookieBanner(page);
    await expect(
      page.locator('text=Sign in with a magic link')
    ).toBeVisible();
  });
});

test.describe('i18n — Locale Routing', () => {
  test('/ro redirects to /ro/panou (dashboard)', async ({ page }) => {
    await page.goto('/ro');
    await page.waitForURL('**/ro/panou');
    expect(page.url()).toContain('/ro/panou');
  });

  test('/en redirects to /en/panou (dashboard)', async ({ page }) => {
    await page.goto('/en');
    await page.waitForURL('**/en/panou');
    expect(page.url()).toContain('/en/panou');
  });
});

test.describe('i18n — 404 Page', () => {
  test('404 page shows Romanian text', async ({ page }) => {
    await page.goto('/ro/pagina-care-nu-exista');
    await dismissCookieBanner(page);
    await expect(
      page.locator('text=Pagina nu a fost g\u0103sit\u0103')
    ).toBeVisible();
  });
});
