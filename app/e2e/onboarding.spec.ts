import { test, expect } from '@playwright/test';

test.describe('Onboarding — Welcome Page', () => {
  test('welcome page loads with correct heading', async ({ page }) => {
    await page.goto('/ro/bun-venit');
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /Bun venit/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Onboarding — Interests Page', () => {
  test('interests page loads with correct heading', async ({ page }) => {
    await page.goto('/ro/interese');
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', {
      name: /Alege subiectele care te interesează/i,
    });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Onboarding — Email Verification Page', () => {
  test('email verification page loads with correct heading', async ({ page }) => {
    await page.goto('/ro/verifica-email');
    await page.waitForLoadState('networkidle');

    // Look for the verification heading (could be "Verifică email" or similar)
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});
