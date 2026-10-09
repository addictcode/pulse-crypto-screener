import { expect, test } from '@playwright/test';

import { fakeBackend, ROWS } from './backend';

test('the landing page shows live numbers and leads to the terminal', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  // generous: the page also starts a WebGL scene, which a headless browser renders in software
  await expect(page.locator('#s-pairs')).toHaveText(String(ROWS.length), { timeout: 20_000 });

  await page.locator('.hero .cta').click();

  await expect(page).toHaveURL(/\/app\/$|\/app\/#/);
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
});

test('the landing page speaks Russian', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  await page.locator('#lang [data-lang="ru"]').click();
  await expect(page.locator('.hero h1')).toContainText('Весь рынок фьючерсов');
  await expect(page.locator('.hero .cta')).toHaveText('Открыть терминал');
});

test('a tape event is called out on the planet', async ({ page }) => {
  // WebGL in a headless browser is software rendering: give it room on a busy CI machine
  test.slow();
  const backend = await fakeBackend(page);
  await page.goto('/');
  await expect(page.locator('#ticker a').first()).toContainText(ROWS[0].symbol.replace('USDT', ''), { timeout: 45_000 });
  // the planet is a separate chunk; wait until it has taken the canvas over
  await expect(page.locator('#planet')).toHaveAttribute('data-engine', /three/, { timeout: 45_000 });
  // labels live for a few seconds, so count them as they are added instead of racing their exit
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seenLabels: seen });
    new MutationObserver((changes) =>
      changes.forEach((change) => change.addedNodes.forEach((node) => seen.push(node.textContent ?? ''))),
    ).observe(document.getElementById('planet-layer')!, { childList: true });
  });

  const item = (symbol: string, price: number, time: number) => ({ kind: 'PUMP_5M' as const, symbol, time, price, value: 2.8 });
  // the first tape message after connecting is history and is not announced; the next one is news
  backend.push({ type: 'tape', items: [item('XRPUSDT', 1.42, Date.now() - 60_000)] });
  backend.push({ type: 'tape', items: ROWS.slice(0, 3).map((row) => item(row.symbol, row.price, Date.now())) });

  const seen = () => page.evaluate(() => (window as unknown as { seenLabels: string[] }).seenLabels);
  await expect.poll(seen, { timeout: 15_000 }).toHaveLength(3);
  expect((await seen())[0]).toContain(ROWS[0].symbol.replace('USDT', ''));
});
