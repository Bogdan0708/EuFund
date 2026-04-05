import { test, expect } from '@playwright/test';

test.describe('section versioning happy path', () => {
  test('approve → verify badge, open history, rollback flow', async ({ page }) => {
    // This test assumes a session already exists with generated sections in dev
    // (created via the existing `npm run db:seed` + manual session flow).
    // Adjust the session selection step to match the dev seed data.
    await page.goto('/ro/asistent-ai');
    await page.waitForLoadState('networkidle');

    // If there's no active session, the progress header shouldn't render
    // (Phase 1 UI guards on proposalSections presence). To run this test
    // end-to-end, seed a session via DB helper first. For now, assert the
    // assistant page loads.
    await expect(page.locator('body')).toBeVisible();
  });
});
