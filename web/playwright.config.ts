import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real frontend in a real browser against a fake backend: the market
// stream and the API are played from fixtures (e2e/backend.ts), so the tests are deterministic
// and need neither Java nor the exchange.
const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: !process.env.CI,
  },
});
