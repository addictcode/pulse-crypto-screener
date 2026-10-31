import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real frontend in a real browser against a fake backend: the market
// stream and the API are played from fixtures (e2e/backend.ts), so the tests are deterministic
// and need neither Java nor the exchange.
const PORT = 5199;
/**
 * The production build, for measurements that only make sense on it: the dev server injects CSS
 * from scripts, so its first frame is unstyled and every page "shifts" when the styles land.
 */
export const BUILD_PORT = 5198;

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
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/app/`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${BUILD_PORT} --strictPort`,
      url: `http://localhost:${BUILD_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
