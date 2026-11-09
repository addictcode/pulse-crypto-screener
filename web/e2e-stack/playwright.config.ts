import { defineConfig, devices } from '@playwright/test';

// The stack walk: a real browser over the production stack (compose.prod.yaml + Caddy + the Java
// backend on FakeExchange), not over the fake backend of web/e2e. It catches what those tests cannot:
// layout with real data, Caddy's templates and headers, the real stream, console errors in the build.
// Start the stack first: loadtest/run.sh --local-build up (CI does it in the "stack" job).
export const STACK = process.env.STACK_URL ?? 'http://localhost:8088';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../stack-report' }]] : 'list',
  outputDir: '../stack-results',
  globalSetup: './global-setup.ts',
  // one snapshot set for every machine: the screenshots are taken in the same Chromium in CI and here
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  use: {
    baseURL: STACK,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone-320', testIgnore: /edge/, use: { viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true } },
    { name: 'phone-390', testIgnore: /edge/, use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
