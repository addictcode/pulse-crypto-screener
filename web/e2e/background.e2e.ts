import { expect, test, type Page } from '@playwright/test';

import { fakeBackend } from './backend';

// A tab in the background lets its stream go after a minute and takes it back when looked at,
// so a forgotten tab does not hold a place under the server's client limit. The page's clock is
// fake: a minute passes in an instant.

/** document.hidden as the test says, with the event a real tab switch fires. */
async function controllableVisibility(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { testHidden: boolean };
    w.testHidden = false;
    Object.defineProperty(document, 'hidden', { get: () => w.testHidden });
    Object.defineProperty(document, 'visibilityState', { get: () => (w.testHidden ? 'hidden' : 'visible') });
  });
}

const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((value) => {
    (window as unknown as { testHidden: boolean }).testHidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

test('a tab in the background lets the stream go and takes it back when looked at', async ({ page }) => {
  await controllableVisibility(page);
  await page.clock.install();
  const backend = await fakeBackend(page);
  await page.goto('/app/');
  await expect(page.locator('#rows tr[data-sym]').first()).toBeVisible();
  expect(backend.openStreams()).toBe(1);

  await setHidden(page, true);
  // a short look elsewhere keeps it
  await page.clock.fastForward(30_000);
  expect(backend.openStreams()).toBe(1);
  await page.clock.fastForward(31_000);
  await expect.poll(() => backend.openStreams()).toBe(0);
  // and it does not come back by itself while nobody looks
  await page.clock.fastForward(60_000);
  expect(backend.streams()).toBe(1);

  await setHidden(page, false);
  await expect.poll(() => backend.openStreams()).toBe(1);
  expect(backend.streams()).toBe(2);
});

test('a waiting price alert keeps the stream in the background', async ({ page }) => {
  await controllableVisibility(page);
  await page.addInitScript(() =>
    localStorage.setItem('pulse.alerts', JSON.stringify([{ id: 1, symbol: 'BTCUSDT', level: 90_000, above: true, created: 1 }])),
  );
  await page.clock.install();
  const backend = await fakeBackend(page);
  await page.goto('/app/');
  await expect(page.locator('#rows tr[data-sym]').first()).toBeVisible();

  await setHidden(page, true);
  await page.clock.fastForward(120_000);
  expect(backend.openStreams()).toBe(1);

  // the price gets there: the alert fires, nothing waits any more, and within a minute the stream goes
  backend.push({ type: 'delta', ts: Date.now(), rows: [{ symbol: 'BTCUSDT', price: 91_000 }] });
  await page.clock.fastForward(5_000);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pulse.alerts'))).toBe('[]');
  await page.clock.fastForward(61_000);
  await expect.poll(() => backend.openStreams()).toBe(0);
});
