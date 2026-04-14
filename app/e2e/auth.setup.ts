import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page, request }) => {
  setup.setTimeout(120_000); // Allow up to 2 minutes for rate limit retry

  // Check if we're rate limited before attempting browser login
  const checkResponse = await request.post('/api/auth/callback/credentials', {
    form: { email: 'godjabogdan@gmail.com', password: 'Bogdangvb0708.,' },
  }).catch(() => null);

  if (checkResponse && checkResponse.status() === 429) {
    // Parse retry-after from response body
    const body = await checkResponse.json().catch(() => ({}));
    const retryMs = body?.error?.details?.retryAfterMs || 60_000;
    const waitSec = Math.min(Math.ceil(retryMs / 1000), 90); // Cap at 90s
    console.log(`Rate limited — waiting ${waitSec}s before login attempt`);
    await page.waitForTimeout(waitSec * 1000);
  }

  await page.goto('/ro/autentificare');

  // Fill in the login form
  await page.getByLabel('Adresă de email').fill('godjabogdan@gmail.com');
  await page.getByLabel('Parolă').fill('Bogdangvb0708.,');
  await page.getByRole('button', { name: 'Autentificare' }).click();

  // Wait for redirect to dashboard after successful login
  await page.waitForURL('**/ro/panou**', { timeout: 30000 });
  await expect(page).toHaveURL(/\/ro\/panou/);

  // Save signed-in state
  await page.context().storageState({ path: AUTH_FILE });
});
