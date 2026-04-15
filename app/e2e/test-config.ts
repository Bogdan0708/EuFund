/**
 * Single source of truth for E2E test configuration.
 * PLAYWRIGHT_ADMIN_PASSWORD must match the ADMIN_PASSWORD used by
 * scripts/seed-admin.ts in the same environment (local .env.local,
 * or CI secret). No literal fallback — tests fail fast on a missing
 * env var rather than silently seeding a known credential.
 */
export const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'godjabogdan@gmail.com';

const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error('PLAYWRIGHT_ADMIN_PASSWORD is required for e2e tests.');
}
export const ADMIN_PASSWORD = adminPassword;

/** Dismiss cookie consent banner so it doesn't block clicks. */
export async function dismissCookieBanner(page: import('@playwright/test').Page) {
  await page.evaluate(() =>
    localStorage.setItem('eufund:cookie-consent-dismissed:v1', '1')
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Submit the dev login form and wait for the credentials callback response.
 * Returns the callback response, or null on timeout.
 */
export async function submitDevLogin(
  page: import('@playwright/test').Page,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
) {
  await page.locator('input[placeholder="Email"]').fill(email);
  await page.locator('input[placeholder="Password"]').fill(password);

  const callbackPromise = page.waitForResponse(
    (res) => res.url().includes('/callback/credentials'),
    { timeout: 15_000 }
  ).catch(() => null);

  await page.locator('button:has-text("Dev Sign In")').click();
  return callbackPromise;
}
