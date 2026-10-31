import { expect, test, type Page } from '@playwright/test';

import { BUILD_PORT } from '../playwright.config';
import { fakeBackend } from './backend';

/**
 * The layout-shift budget of the landing on a phone, on the production build (see BUILD_PORT):
 * the dev server injects CSS from scripts, so its unstyled first frame would count as a shift.
 *
 * CLS once reached 0.71 on a phone: the arrival animation of the first screen ran on the
 * `translate` property, and Chrome on the phone counted every frame of it as a shift of the whole
 * screen. Headless Chromium does not report those shifts (the old code measures 0.017 here), so
 * the budget alone would not catch that regression; the second test guards it directly.
 */
const BUDGET = 0.1;

// software WebGL on a slowed-down CPU and network
test.describe.configure({ timeout: 120_000 });
// a phone-sized window, but not Playwright's mobile emulation: with it Chrome marks the shifts of
// the first second as "after input", and CLS would leave them out
test.use({ baseURL: `http://localhost:${BUILD_PORT}`, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

/** Opens the landing like a mid-range phone on mobile data, as Lighthouse's mobile run does. */
async function openLikeAPhone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  // every shift from the very first paint; the test gives no input before it reads the sum
  await page.addInitScript(() => {
    const w = window as unknown as { cls: number };
    w.cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) w.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
}

async function layoutShift(page: Page): Promise<number> {
  await openLikeAPhone(page);
  await expect(page.locator('#s-pairs')).not.toHaveText(/^\s*$/, { timeout: 60_000 });
  // the first screen arrives with animations; wait for them to finish, then a little longer for
  // late numbers and the Telegram button
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  return page.evaluate(() => (window as unknown as { cls: number }).cls);
}

test('the landing does not jump on a slow phone', async ({ page }) => {
  await fakeBackend(page);
  const cls = await layoutShift(page);
  console.log(`CLS ${cls.toFixed(3)}`);
  expect(cls).toBeLessThan(BUDGET);
});

test('the Telegram button arriving on the first screen moves nothing', async ({ page }) => {
  await fakeBackend(page, { links: { bot: 'PulseTestBot', channel: 'pulse_test' } });
  const cls = await layoutShift(page);
  await expect(page.locator('.hero [data-tg="bot"]')).toBeVisible();
  console.log(`CLS with Telegram ${cls.toFixed(3)}`);
  expect(cls).toBeLessThan(BUDGET);
});

test('the blocks of the first screen arrive by transform and opacity only', async ({ page }) => {
  await fakeBackend(page);
  await openLikeAPhone(page);
  // which properties the arrival animations of the header and the bottom of the first screen
  // change; read as soon as they exist, before they finish
  await page.waitForFunction(() => document.querySelector('.hero-foot')!.getAnimations().length > 0, undefined, { timeout: 30_000 });
  const animated = await page.evaluate(() =>
    ['.nav', '.hero-foot'].flatMap((selector) =>
      document
        .querySelector(selector)!
        .getAnimations()
        .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
        .flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)))
        .map((property) => `${selector} ${property}`),
    ),
  );
  expect(animated.length).toBeGreaterThan(0);
  // `translate`, `top`, `margin` and the like move the block in layout, and a phone counts each
  // frame as a shift; `transform` and `opacity` are only painted
  expect(animated.filter((entry) => !/ (transform|opacity)$/.test(entry))).toEqual([]);
});
