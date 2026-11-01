import { expect, test, type Page } from '@playwright/test';

import { BUILD_PORT } from '../playwright.config';
import { fakeBackend, type FakeBackend } from './backend';

/** A first visit: nothing stored yet. fakeBackend marks every test a returning visitor; undo that once. */
async function firstVisit(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('fresh')) {
      sessionStorage.setItem('fresh', '1');
      localStorage.clear();
    }
  });
}

function events(backend: FakeBackend) {
  const now = Date.now();
  backend.push({ type: 'tape', items: [{ kind: 'PUMP_5M', symbol: 'SOLUSDT', time: now - 30_000, price: 120, value: 3.4 }] });
  backend.push({
    type: 'signals',
    items: [{ id: 1, type: 'PUMP', symbol: 'BTCUSDT', time: now - 5_000, price: 84_000, value: 2.6, title: 'BTC jumps 2.6% in five minutes', detail: 'Price 84,000.', direction: 1, ret5m: null, ret15m: null, ret1h: null }],
  });
  backend.push({ type: 'liquidations', items: [{ symbol: 'ETHUSDT', side: 'LONG', price: 3_000, quantity: 100, time: now - 10_000 }] });
}

test.describe('the live feed on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a first visit opens the feed, and a card opens its chart', async ({ page }) => {
    const backend = await fakeBackend(page, { links: { bot: 'PulseBot', channel: 'pulse_live' } });
    await firstVisit(page);
    await page.goto('/app/');
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'feed');
    await expect(page.locator('#live-feed')).toBeVisible();
    await expect(page.locator('#rows')).toBeHidden();

    events(backend);
    const cards = page.locator('.feed-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('BTC jumps 2.6% in five minutes');
    await expect(cards.nth(1)).toContainText('$300.0K');
    await expect(cards.first().locator('.fc-spark svg')).toBeVisible();
    // the Telegram buttons of B2, under the thumb
    await expect(page.locator('#feed-tg a[data-tg="bot"]')).toHaveAttribute('href', 'https://t.me/PulseBot?start=site');

    // what arrives while reading waits behind a button instead of pushing the cards
    backend.push({ type: 'tape', items: [{ kind: 'DUMP_1M', symbol: 'WIFUSDT', time: Date.now(), price: 2, value: -2.1 }] });
    await expect(page.locator('#feed-more')).toHaveText('New events: 1');
    await expect(cards).toHaveCount(3);
    await page.locator('#feed-more').click();
    await expect(cards).toHaveCount(4);

    await page.locator('.feed-card[data-sym="SOLUSDT"] .fc-open').click();
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'terminal');
    await expect(page).toHaveURL(/#screener:SOLUSDT$/);
    await expect(page.locator('#chart canvas').first()).toBeVisible();

    // a chart opened from a card does not change where this phone starts
    await page.goto('/app/');
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'feed');
  });

  test('the switch to the full terminal is remembered, and back', async ({ page }) => {
    await fakeBackend(page);
    await firstVisit(page);
    await page.goto('/app/');
    await page.locator('#feed-terminal').click();
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'terminal');
    await expect(page.locator('#rows tr[data-sym]').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'terminal');
    await page.locator('#feed-back').click();
    await expect(page.locator('#live-feed')).toBeVisible();
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'feed');
  });

  test('speaks Russian', async ({ page }) => {
    await fakeBackend(page);
    await firstVisit(page);
    await page.addInitScript(() => localStorage.setItem('pulse.lang', '"ru"'));
    await page.goto('/app/');
    await expect(page.locator('.feed-title')).toHaveText('Живая лента');
    await expect(page.locator('#feed-terminal')).toHaveText('Полный терминал');
  });

  test('a returning visitor and a link to a view get the terminal', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/app/');
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'terminal');

    await page.evaluate(() => localStorage.clear());
    await page.goto('/app/#heatmap');
    await expect(page.locator('body')).toHaveAttribute('data-phone', 'terminal');
  });
});

test('a computer never gets the feed', async ({ page }) => {
  await fakeBackend(page);
  await firstVisit(page);
  await page.goto('/app/');
  await expect(page.locator('body')).toHaveAttribute('data-phone', 'terminal');
  await expect(page.locator('#live-feed')).toBeHidden();
  await expect(page.locator('#feed-back')).toBeHidden();
});

test.describe('the live feed does not jump', () => {
  // the production build, like the landing's budget in speed.e2e.ts
  test.use({ baseURL: `http://localhost:${BUILD_PORT}`, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  test.describe.configure({ timeout: 90_000 });

  test('CLS stays under 0.1 while the first events and the Telegram buttons arrive', async ({ page }) => {
    const backend = await fakeBackend(page, { links: { bot: 'PulseBot', channel: 'pulse_live' } });
    await firstVisit(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const w = window as unknown as { cls: number };
      w.cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) w.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/app/');
    await expect(page.locator('#live-feed')).toBeVisible();
    events(backend);
    await expect(page.locator('.feed-card')).toHaveCount(3);
    await expect(page.locator('#feed-tg')).toBeVisible();
    // more events while reading: counted on the floating button, nothing moves
    backend.push({ type: 'tape', items: [{ kind: 'DUMP_1M', symbol: 'WIFUSDT', time: Date.now(), price: 2, value: -2.1 }] });
    await expect(page.locator('#feed-more')).toBeVisible();
    await page.waitForTimeout(1_500);
    const cls = await page.evaluate(() => (window as unknown as { cls: number }).cls);
    console.log(`feed CLS ${cls.toFixed(3)}`);
    expect(cls).toBeLessThan(0.1);
  });
});
