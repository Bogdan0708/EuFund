import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, dismissCookieBanner, submitDevLogin } from './test-config';

test.describe('Authentication — Login Page', () => {
  test('login page loads with all elements (OAuth, magic link, dev login)', async ({ page }) => {
    await page.goto('/ro/autentificare');
    await dismissCookieBanner(page);

    // OAuth buttons (4 providers)
    await expect(page.locator('button:has-text("Google")')).toBeVisible();
    await expect(page.locator('button:has-text("Microsoft")')).toBeVisible();
    await expect(page.locator('button:has-text("Facebook")')).toBeVisible();
    await expect(page.locator('button:has-text("Apple")')).toBeVisible();

    // Magic link section
    await expect(page.locator('input[type="email"]').first()).toBeVisible();

    // Dev login box
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Dev Sign In")')).toBeVisible();
  });

  test('login page in English loads correctly', async ({ page }) => {
    await page.goto('/en/autentificare');
    await dismissCookieBanner(page);

    await expect(page.locator('button:has-text("Google")')).toBeVisible();
    await expect(page.locator('button:has-text("Microsoft")')).toBeVisible();
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('button:has-text("Dev Sign In")')).toBeVisible();
  });

  test('login page has correct title', async ({ page }) => {
    await page.goto('/ro/autentificare');
    await dismissCookieBanner(page);
    await expect(page).toHaveTitle(/FondEU/);
  });
});

test.describe('Authentication — Dev Login', () => {
  // Run login tests serially to avoid exhausting the rate limit (10 reqs / 15 min)
  test.describe.configure({ mode: 'serial' });

  test('dev login with valid credentials redirects to dashboard', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/ro/autentificare');
    await dismissCookieBanner(page);

    const callbackRes = await submitDevLogin(page);

    if (callbackRes?.status() === 429) {
      test.skip(true, 'Rate limited — credentials endpoint exhausted (10 reqs / 15 min)');
      return;
    }

    // Wait for client-side redirect (window.location.href = result.url)
    await expect(page).not.toHaveURL(/autentificare/, { timeout: 15_000 });
  });

  test('dev login with invalid password shows error', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/ro/autentificare');
    await dismissCookieBanner(page);

    const callbackRes = await submitDevLogin(page, ADMIN_EMAIL, 'wrong-password-123');

    if (callbackRes?.status() === 429) {
      test.skip(true, 'Rate limited — credentials endpoint exhausted (10 reqs / 15 min)');
      return;
    }

    // Should show error and remain on login page
    await expect(page.getByText(/Invalid email or password/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/autentificare/);
  });
});

test.describe('Authentication — Protected Routes', () => {
  test('unauthenticated access to /ro/panou redirects to /ro/autentificare', async ({ page }) => {
    await page.goto('/ro/panou');
    await expect(page).toHaveURL(/\/ro\/autentificare/, { timeout: 10_000 });
  });

  test('unauthenticated access to /en/panou redirects to /en/autentificare', async ({ page }) => {
    await page.goto('/en/panou');
    await expect(page).toHaveURL(/\/en\/autentificare/, { timeout: 10_000 });
  });

  test('unauthenticated API call to /api/v1/projects returns 401', async ({ request }) => {
    const response = await request.get('/api/v1/projects');
    expect(response.status()).toBe(401);
  });
});

test.describe('Authentication — Cookie Consent Banner', () => {
  test('cookie consent banner appears and can be dismissed', async ({ page }) => {
    await page.goto('/ro/autentificare');
    await page.evaluate(() =>
      localStorage.removeItem('eufund:cookie-consent-dismissed:v1')
    );
    await page.reload();
    await page.waitForLoadState('networkidle');

    const banner = page.locator('.fixed.inset-x-4.bottom-4.z-50');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    await page.evaluate(() =>
      localStorage.setItem('eufund:cookie-consent-dismissed:v1', '1')
    );
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(banner).not.toBeVisible({ timeout: 5_000 });
  });
});
