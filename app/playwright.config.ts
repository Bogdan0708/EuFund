import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: /auth\.(spec|setup)\.ts/,
    },
    {
      name: 'chromium-no-auth',
      use: {
        ...devices['Desktop Chrome'],
      },
      testMatch: /auth\.spec\.ts/,
    },
  ],

  /* Start dev server automatically if not CI */
  ...(process.env.CI
    ? {}
    : {
        webServer: {
          command: 'PORT=3002 npm run dev',
          url: `${BASE_URL}/api/health`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
