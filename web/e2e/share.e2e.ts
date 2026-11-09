import { expect, test } from '@playwright/test';

import { fakeBackend, ROWS } from './backend';

test('a shared moment opens on its pair, timeframe and candle', async ({ page }) => {
  await fakeBackend(page);
  const step = 900;
  const at = Math.floor(Date.now() / 1000 / step) * step - 40 * step;
  await page.goto(`/app/?utm_source=share#screener:SOLUSDT:15m:${at + 120}`);
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  await expect(page.locator('#tf [data-tf="15m"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#chart')).toHaveAttribute('data-moment', String(at));
  await expect(page.locator('.ins-head')).toContainText('SOL');
});

test('Share copies a tagged link to the candle clicked last', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeBackend(page);
  await page.goto('/app/#screener:BTCUSDT');
  await expect(page.locator('#chart canvas').first()).toBeVisible();
  const box = (await page.locator('#chart').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('#share-btn').click();
  await expect(page.locator('#share-btn')).toHaveAttribute('title', 'Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/app\/\?utm_source=share#screener:BTCUSDT:5m:\d{10}$/);

  // the link leads back to that candle
  const at = Number(link.split(':').at(-1));
  await page.goto(link);
  await expect(page.locator('#chart')).toHaveAttribute('data-moment', String(Math.floor(at / 300) * 300));
});

test('an old link without a moment opens as before', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app/#screener:WIFUSDT');
  await expect(page.locator('#chart canvas').first()).toBeVisible();
  await expect(page.locator('#chart')).not.toHaveAttribute('data-moment', /.*/);
});
