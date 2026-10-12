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
  await expect(page.locator('#keys dt')).toHaveCount(13);

  await page.keyboard.press('Escape');
  await expect(page.locator('#keys')).toBeHidden();
});

test('Pulse Setups shows its plan tools and scans the market', async ({ page }) => {
  await openTerminal(page);
  await page.locator('#ind-btn').click();
  await page.locator('#ind-menu').getByText('Pulse Setups').click();

  await page.keyboard.press('Escape');

  await expect(page.locator('#plan-tools')).toBeVisible();
  await expect(page.locator('#bt')).toContainText('Pulse Setups');
  await page.locator('#plan-scan').click();
  // the fake market is flat: nothing to trade, and the scan has to say so rather than stay silent
  await expect(page.locator('#plan-found')).toContainText('No open setups on 5m');
});

test('a line can be drawn in one drag, undone and removed with a right click', async ({ page }) => {
  await openTerminal(page);
  const box = (await page.locator('#chart').boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  const stored = () => page.evaluate(() => (JSON.parse(localStorage.getItem('pulse.draw.BTCUSDT') ?? '[]') as unknown[]).length);

  await page.locator('#tools [data-tool="trend"]').click();
  await page.mouse.move(...at(0.3, 0.3));
  await page.mouse.down();
  await page.mouse.move(...at(0.5, 0.45), { steps: 6 });
  await page.mouse.up();
  // one gesture is one drawing: nothing is left hanging on the cursor
  await expect.poll(stored).toBe(1);
  await expect(page.locator('#tools [data-tool="trend"]')).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(stored).toBe(0);

  await page.locator('#tools [data-tool="hline"]').click();
  await page.mouse.click(...at(0.4, 0.4));
  await expect.poll(stored).toBe(1);
  await page.mouse.click(...at(0.6, 0.4), { button: 'right' });
  await expect.poll(stored).toBe(0);
});

test('the setups journal lists trades and opens one on its timeframe', async ({ page }) => {
  await openTerminal(page, '#setups');
  await expect(page.locator('#su-stats')).toContainText('+4.7R');
  await expect(page.locator('#su-closed tr')).toHaveCount(1);
  // SOL trades at 115 in the fake market: one R above a long from 114 with the stop at 113, less fees
  await expect(page.locator('#su-open tr')).toContainText('+0.89R');

  await page.locator('#su-open tr[data-sym="SOLUSDT"]').click();

  await expect(selected(page)).toHaveText('SOL');
  await expect(page.locator('#tf [aria-selected="true"]')).toHaveText('15m');
});

test('a second watchlist takes its own pairs', async ({ page }) => {
  await openTerminal(page);
  const lists = page.locator('#presets .preset.watch');
  await expect(lists).toHaveCount(1);
  // the first list starts with the two majors
  await expect(lists.first().locator('.count')).toHaveText('2');

  await lists.first().click();
  await page.locator('#presets [data-act="edit-list"]').click();
  await page.locator('#flt-menu [data-act="new-list"]').click();
  await page.locator('#flt-menu input[name="name"]').fill('Memes');
  await page.locator('#flt-menu button[type="submit"]').click();

  // the new list is open and empty; the star now adds to it
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(0);
  await page.locator('#presets [data-preset="all"]').click();
  await page.locator('#rows [data-star="WIFUSDT"]').click();
  await expect(lists.nth(1).locator('.count')).toHaveText('1');
  await expect(lists.first().locator('.count')).toHaveText('2');

  await page.reload();
  await expect(page.locator('#presets .preset.watch').nth(1)).toContainText('Memes');
  await page.locator('#presets .preset.watch').nth(1).click();
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(1);
  await expect(page.locator('#rows')).toContainText('WIF');
});

test('settings keep the risk, and a saved file brings everything back', async ({ page }) => {
  await openTerminal(page);
  await page.keyboard.press(',');
  const sheet = page.locator('#settings');
  await expect(sheet).toBeVisible();
  await page.locator('#set-risk').fill('120');
  await page.locator('#set-risk').blur();
  expect(await page.evaluate(() => localStorage.getItem('pulse.planRisk'))).toBe('120');

  const download = page.waitForEvent('download');
  await page.locator('#set-export').click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toMatch(/^pulse-settings-\d{4}-\d\d-\d\d\.json$/);

  // erase everything (two clicks), then load the file back
  await page.locator('#set-reset').click();
  await expect(page.locator('#set-reset')).toHaveText('Click again to erase everything');
  await page.locator('#set-reset').click();
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  expect(await page.evaluate(() => localStorage.getItem('pulse.planRisk'))).toBeNull();

  await page.locator('#settings-btn').click();
  await page.locator('#set-file').setInputFiles(file);
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pulse.planRisk'))).toBe('120');
});

test.describe('the tab bar on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('keeps every view one tap away at the bottom of the screen', async ({ page }) => {
    await openTerminal(page);
    const bar = (await page.locator('.views').boundingBox())!;
    expect(bar.y + bar.height).toBeCloseTo(812, 0);
    const tabs = page.locator('.views .view');
    for (const tab of await tabs.all()) {
      const box = (await tab.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375.5);
    }
    await page.locator('.view[data-view="heatmap"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'heatmap');
  });
});

test('a trend line lies exactly under the mouse and survives a change of timeframe', async ({ page }) => {
  await openTerminal(page);
  const chart = (await page.locator('#chart').boundingBox())!;
  // how much of a small square around a point of the chart is covered by a drawing
  const ink = (x: number, y: number) =>
    page.evaluate(
      ([x, y]) => {
        const layer = document.querySelector<HTMLCanvasElement>('.drawlayer')!;
        const scale = window.devicePixelRatio;
        const pixels = layer.getContext('2d')!.getImageData(Math.round(x * scale) - 3, Math.round(y * scale) - 3, 7, 7).data;
        let covered = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 40) covered++;
        return covered;
      },
      [x, y],
    );

  // two clicks between candles, not on them: the points must stay where they were put
  await page.locator('#tools [data-tool="trend"]').click();
  await page.mouse.click(chart.x + 203, chart.y + 151);
  await page.mouse.move(chart.x + 300, chart.y + 190, { steps: 4 });
  await page.mouse.click(chart.x + 437, chart.y + 233);
  await expect.poll(() => ink(203, 151)).toBeGreaterThan(0);
  expect(await ink(437, 233)).toBeGreaterThan(0);
  expect(await ink(320, 192)).toBeGreaterThan(0); // the middle of the line
  expect(await ink(320, 120)).toBe(0); // and nothing where no line goes

  // on another timeframe the same two moments are elsewhere on the screen, but not at its edge
  await page.locator('#tf [data-tf="15m"]').click();
  await expect(page.locator('#tf [data-tf="15m"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#chart canvas').first()).toBeVisible();
  await page.locator('#tf [data-tf="5m"]').click();
  await expect(page.locator('#tf [data-tf="5m"]')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => ink(203, 151)).toBeGreaterThan(0);
  expect(await ink(437, 233)).toBeGreaterThan(0);
});
