import { test as setup, expect } from '@playwright/test';
import { dismissCookieBanner, submitDevLogin } from './test-config';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate as admin via dev login', async ({ page }) => {
  setup.setTimeout(120_000);

  // Navigate to login and dismiss cookie banner
  await page.goto('/ro/autentificare');
  await dismissCookieBanner(page);

  // Submit dev login and wait for the credentials callback
  const emailInput = page.locator('input[placeholder="Email"]');
  await expect(emailInput).toBeVisible({ timeout: 5_000 });

  const callbackRes = await submitDevLogin(page);

  if (callbackRes?.status() === 429) {
    // Read the server's Retry-After header (seconds until the rate limit window resets)
    const retryAfter = parseInt(callbackRes.headers()['retry-after'] || '0', 10);
    const waitMs = Math.min((retryAfter + 2) * 1_000, 90_000); // cap at 90s, add 2s buffer
    console.log(`Rate limited — Retry-After: ${retryAfter}s, waiting ${waitMs / 1000}s...`);
    await page.waitForTimeout(waitMs);

    // Retry login after the window expires
    await page.reload();
    await page.waitForLoadState('networkidle');
    const retryRes = await submitDevLogin(page);

    if (retryRes?.status() === 429) {
      throw new Error(
        'Still rate limited after waiting for Retry-After window. ' +
        'Flush Redis before running tests: docker exec eu-funds-redis-1 redis-cli FLUSHDB'
      );
    }
  }

  // Wait for client-side redirect after successful auth callback
  await page.waitForURL(/\/(ro|en)\/(panou|bun-venit|interese)/, { timeout: 15_000 }).catch(() => {});

  // If still on login page, check for error
  if (page.url().includes('/autentificare')) {
    const errorVisible = await page.locator('text=Invalid email or password').isVisible().catch(() => false);
    if (errorVisible) {
      throw new Error('Login failed: Invalid email or password');
    }
    // Last attempt — wait for redirect
    await page.waitForURL(/\/(ro|en)\/(panou|bun-venit|interese)/, { timeout: 10_000 });
  }

  // If redirected to onboarding, navigate to dashboard (session is valid)
  if (page.url().includes('/bun-venit') || page.url().includes('/interese')) {
    await page.goto('/ro/panou');
    await page.waitForLoadState('networkidle');
  }

  await expect(page).not.toHaveURL(/autentificare/, { timeout: 5_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
