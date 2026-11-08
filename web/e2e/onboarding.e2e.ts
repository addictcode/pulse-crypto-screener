import { expect, test, type Page } from '@playwright/test';

import { fakeBackend, ROWS } from './backend';

/** A first visit: fakeBackend marks every test a returning visitor; undo that once. */
async function firstVisit(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('fresh')) {
      sessionStorage.setItem('fresh', '1');
      localStorage.removeItem('pulse.welcomed');
    }
  });
}

test('a first visit gets a short tour that does not come back', async ({ page }) => {
  await fakeBackend(page);
  await firstVisit(page);
  await page.goto('/app/');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  const card = page.locator('.tour-card');
  await expect(card).toContainText('1 of 4');
  await expect(card).toContainText('The whole market');
  for (const title of ['The chart', 'What is happening', 'Find anything']) {
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card).toContainText(title);
  }
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.tour-ring')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  await expect(page.locator('.tour-card')).toHaveCount(0);
});

test('the tour can be skipped at once', async ({ page }) => {
  await fakeBackend(page);
  await firstVisit(page);
  await page.goto('/app/');
  await page.locator('.tour-card').getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pulse.welcomed'))).toBe('true');
});

test('a word with a dotted line explains itself under the mouse', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app/');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  await page.locator('h2.p-title[data-term="liquidation"]').hover();
  await expect(page.locator('.term-tip')).toContainText('the exchange closes a position that ran out of margin');
  await page.mouse.move(5, 5);
  await expect(page.locator('.term-tip')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a tap explains a word, in Russian too', async ({ page }) => {
    await fakeBackend(page);
    await page.addInitScript(() => localStorage.setItem('pulse.lang', '"ru"'));
    await page.goto('/app/#screener');
    const liqs = page.locator('h2.p-title[data-term="liquidation"]');
    await liqs.scrollIntoViewIfNeeded();
    await liqs.tap();
    await expect(page.locator('.term-tip')).toContainText('Ликвидация — биржа закрывает позицию');
    const tip = (await page.locator('.term-tip').boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(390);
  });

  test('every card of the live feed says what the event is', async ({ page }) => {
    const backend = await fakeBackend(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fresh')) {
        sessionStorage.setItem('fresh', '1');
        localStorage.clear();
      }
    });
    await page.goto('/app/');
    backend.push({ type: 'tape', items: [{ kind: 'PUMP_5M', symbol: 'SOLUSDT', time: Date.now() - 30_000, price: 120, value: 3.4 }] });
    await expect(page.locator('.feed-card .fc-what').first()).toHaveText(/livelier than an ordinary hour, either way/);
  });
});
