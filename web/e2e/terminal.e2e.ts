import { expect, test, type Page } from '@playwright/test';

import { fakeBackend, ROWS, type FakeBackend } from './backend';

let backend: FakeBackend;

async function openTerminal(page: Page, hash = '') {
  backend = await fakeBackend(page);
  await page.goto(`/app/${hash}`);
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  await expect(page.locator('#chart canvas').first()).toBeVisible();
}

const selected = (page: Page) => page.locator('#ins-sym');

test('shows the market and follows the selection', async ({ page }) => {
  await openTerminal(page);
  await expect(selected(page)).toHaveText('BTC');
  await expect(page.locator('#st-conn')).toHaveText('Connected');

  await page.locator('#rows tr[data-sym="SOLUSDT"]').click();

  await expect(selected(page)).toHaveText('SOL');
  await expect(page.locator('#ins-price')).toHaveText('115.00');
  await expect(page).toHaveURL(/#screener:SOLUSDT$/);
});

test('a link with a pair opens that pair', async ({ page }) => {
  await openTerminal(page, '#screener:WIFUSDT');
  await expect(selected(page)).toHaveText('WIF');
});

test('live prices reach the list and the header', async ({ page }) => {
  await openTerminal(page);
  backend.push({ type: 'delta', ts: Date.now(), rows: [{ symbol: 'BTCUSDT', price: 84_321.5 }] });
  await expect(page.locator('#ins-price')).toHaveText('84,321.5');
  await expect(page.locator('#rows tr[data-sym="BTCUSDT"]')).toContainText('84,321.5');
});

test('switches to Russian and remembers it', async ({ page }) => {
  await openTerminal(page);
  await expect(page.locator('.view[data-view="screener"]')).toHaveText('Terminal');

  await page.locator('#lang [data-lang="ru"]').click();

  await expect(page.locator('.view[data-view="screener"]')).toHaveText('Терминал');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.reload();
  await expect(page.locator('.view[data-view="heatmap"]')).toHaveText('Карта рынка');
});

test('the command palette jumps to a pair', async ({ page }) => {
  await openTerminal(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();

  await page.locator('#pal-q').fill('wif');
  await expect(page.locator('#pal-list .pal-item').first()).toContainText('WIF');
  await page.keyboard.press('Enter');

  await expect(page.locator('#palette')).toBeHidden();
  await expect(selected(page)).toHaveText('WIF');
});

test('number keys change the timeframe', async ({ page }) => {
  await openTerminal(page);
  await page.keyboard.press('3');
  await expect(page.locator('#tf [data-tf="15m"]')).toHaveAttribute('aria-selected', 'true');
});

test('a price alert fires once when the price gets there', async ({ page }) => {
  await openTerminal(page);
  await page.locator('#al-btn').click();
  await page.locator('#al-level').fill('84000');
  await page.locator('#al-menu button[type="submit"]').click();
  await expect(page.locator('#al-menu .al-list li')).toHaveCount(1);
  await expect(page.locator('#al-btn .count')).toHaveText('1');

  backend.push({ type: 'delta', ts: Date.now(), rows: [{ symbol: 'BTCUSDT', price: 83_900 }] });
  await expect(page.locator('.toast')).toHaveCount(0);
  backend.push({ type: 'delta', ts: Date.now(), rows: [{ symbol: 'BTCUSDT', price: 84_010 }] });

  await expect(page.locator('.toast')).toContainText('BTC rose to 84,000.0');
  await expect(page.locator('#al-btn .count')).toHaveText('');
  backend.push({ type: 'delta', ts: Date.now(), rows: [{ symbol: 'BTCUSDT', price: 84_500 }] });
  await expect(page.locator('.toast')).toHaveCount(1);
});

test('a drawing is stored for the pair and survives a reload', async ({ page }) => {
  await openTerminal(page);
  const clear = page.locator('#tools [data-act="clear"]');
  await expect(clear).toBeDisabled();

  await page.locator('#tools [data-tool="hline"]').click();
  await expect(page.locator('#chart')).toHaveClass(/drawing/);
  await page.locator('#chart').click({ position: { x: 300, y: 180 } });

  await expect(clear).toBeEnabled();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pulse.draw.BTCUSDT') ?? '[]'));
  expect(stored).toHaveLength(1);
  expect(stored[0].type).toBe('hline');
  expect(stored[0].points[0].p).toBeGreaterThan(70_000);

  await page.reload();
  await expect(page.locator('#chart canvas').first()).toBeVisible();
  await expect(clear).toBeEnabled();
  // another pair has its own drawings
  await page.locator('#rows tr[data-sym="ETHUSDT"]').click();
  await expect(clear).toBeDisabled();
});

test('a two-point drawing takes two clicks and can be deleted', async ({ page }) => {
  await openTerminal(page);
  await page.locator('#tools [data-tool="trend"]').click();
  await page.locator('#chart').click({ position: { x: 200, y: 150 } });
  await expect(page.locator('#tools [data-act="clear"]')).toBeDisabled();
  await page.locator('#chart').click({ position: { x: 420, y: 230 } });

  const remove = page.locator('#tools [data-act="delete"]');
  await expect(remove).toBeEnabled(); // a fresh drawing is selected
  await page.keyboard.press('Delete');
  await expect(page.locator('#tools [data-act="clear"]')).toBeDisabled();
});

test('a custom filter narrows the list and is kept', async ({ page }) => {
  await openTerminal(page);
  await page.locator('#presets [data-act="new"]').click();
  const form = page.locator('#flt-menu form');
  await form.locator('input[name="name"]').fill('Runners');
  await form.locator('select[name="metric"]').selectOption('ch24h');
  await form.locator('select[name="op"]').selectOption('gte');
  await form.locator('input[name="value"]').fill('5');
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('#presets [aria-selected="true"]')).toContainText('Runners');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(2);
  await expect(page.locator('#rows')).toContainText('WIF');
  await expect(page.locator('#rows')).toContainText('DOGE');

  await page.reload();
  await expect(page.locator('#presets')).toContainText('Runners');
});

test('a filter without a number is not saved', async ({ page }) => {
  await openTerminal(page);
  await page.locator('#presets [data-act="new"]').click();
  const form = page.locator('#flt-menu form');
  await form.locator('input[name="name"]').fill('Broken');
  await form.locator('input[name="value"]').fill('lots');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.al-note')).toHaveText('Every condition needs a number.');
  await expect(page.locator('#presets')).not.toContainText('Broken');
});

test('chosen columns appear in the list', async ({ page }) => {
  await openTerminal(page);
  const funding = page.locator('#head th[data-sort="funding"]');
  await expect(funding).toBeHidden();

  await page.locator('#list-cols').click();
  await page.locator('#cols-menu input[value="funding"]').check();

  await expect(funding).toBeVisible();
});

test('the heatmap shows every pair and selects on click', async ({ page }) => {
  await openTerminal(page, '#heatmap');
  await expect(page.locator('#heat .tile')).toHaveCount(ROWS.length);
  await page.locator('#heat .tile[data-sym="DOGEUSDT"]').click();
  await expect(selected(page)).toHaveText('DOGE');
});

test('the search box filters the list', async ({ page }) => {
  await openTerminal(page);
  await page.keyboard.press('/');
  await page.keyboard.type('xr');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(1);
  await expect(page.locator('#rows')).toContainText('XRP');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const view of ['screener', 'grid', 'heatmap', 'densities', 'signals']) {
    test(`${view} fits the screen without sideways scrolling`, async ({ page }) => {
      backend = await fakeBackend(page);
      await page.goto(`/app/#${view}`);
      await expect(page.locator('body')).toHaveAttribute('data-view', view);
      await expect(page.locator('#st-conn')).toHaveText('Connected');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test('the chart can be saved as a picture', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app/');
  await expect(page.locator('#chart canvas').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.locator('#shot-btn').click();

  expect((await download).suggestedFilename()).toMatch(/^pulse-BTCUSDT-5m-\d{4}-\d{2}-\d{6}\.png$/);
});

test('a question mark lists the shortcuts', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app/');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);

  await page.keyboard.press('?');
  await expect(page.locator('#keys')).toBeVisible();
  await expect(page.locator('#keys dt')).toHaveCount(10);

  await page.keyboard.press('Escape');
  await expect(page.locator('#keys')).toBeHidden();
});
