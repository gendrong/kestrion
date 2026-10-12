import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests. They build and start the production server on port 3100.
 * The full live scan test only runs with E2E_LIVE=1 (it calls the chain and takes ~1–2 min).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx next build && npx next start -p 3100',
    url: 'http://localhost:3100',
    timeout: 300_000,
    reuseExistingServer: true,
  },
});
