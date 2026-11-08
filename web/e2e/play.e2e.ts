import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { BUILD_PORT } from '../playwright.config';
import { fakeBackend } from './backend';

/** The first pack: every new player starts with it. */
const PACK = JSON.parse(readFileSync('public/play/rounds-01.json', 'utf8')) as Array<{ coin: string; hour: number }>;

async function playAll(page: Page, pick: 'Higher' | 'Lower') {
  for (let i = 0; i < 10; i++) {
    await expect(page.locator('#pl-step')).toHaveText(`Round ${i + 1} of 10`);
    // the coin and the day stay hidden until the answer
    await expect(page.locator('#pl-round')).not.toContainText(PACK[i].coin);
    await page.getByRole('button', { name: pick }).click();
    await expect(page.locator('#pl-reveal')).toContainText(`It was ${PACK[i].coin}`);
    await expect(page.locator('#pl-verdict')).toContainText(PACK[i].hour > 0 === (pick === 'Higher') ? 'Right.' : 'Not this time.');
    await page.locator('#pl-next').click();
  }
}

test('ten rounds against a coin, an honest result and a card to share', async ({ page }) => {
  const backend = await fakeBackend(page);
  await page.goto('/play/');
  await page.getByRole('button', { name: 'Play ten rounds' }).click();
  await playAll(page, 'Higher');

  // half the rounds of a pack went up: "always higher" is worth exactly a coin
  await expect(page.locator('#pl-total')).toHaveText(/^You guessed 5 of 10\. The coin: \d+\.$/);
  await expect(page.locator('#pl-word')).not.toContainText(/talent|trader/);
  await expect(page.locator('#pl-card')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => backend.hits.map((h) => h.page)).toEqual(['play', 'play-done']);

  // the next game deals the next pack, and the page remembers the totals
  await page.reload();
  await expect(page.locator('#pl-history')).toContainText('Played so far: 1 games, you guessed 5 of 10');
});

test('a reload in the middle of a series continues it', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/play/');
  await page.getByRole('button', { name: 'Play ten rounds' }).click();
  await page.getByRole('button', { name: 'Lower' }).click();
  await page.locator('#pl-next').click();
  await page.reload();
  await expect(page.locator('#pl-step')).toHaveText('Round 2 of 10');
  await expect(page.locator('#pl-score')).toContainText(/^You \d · coin \d$/);
});

test('the game speaks Russian', async ({ page }) => {
  await fakeBackend(page);
  await page.addInitScript(() => localStorage.setItem('pulse.lang', '"ru"'));
  await page.goto('/play/');
  await expect(page.locator('.pl-title')).toHaveText('Угадай, что дальше');
  await page.getByRole('button', { name: 'Сыграть 10 раундов' }).click();
  await page.getByRole('button', { name: 'Выше' }).click();
  await expect(page.locator('#pl-reveal')).toContainText('Это была');
});

test('the landing leads to the game', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  await page.locator('.nav a[href="play/"]').click();
  await expect(page).toHaveURL(/\/play\/$/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the whole series fits the screen and the buttons sit under the chart', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/play/');
    await page.getByRole('button', { name: 'Play ten rounds' }).click();
    const chart = (await page.locator('.pl-chart').boundingBox())!;
    const higher = (await page.getByRole('button', { name: 'Higher' }).boundingBox())!;
    expect(higher.y).toBeGreaterThan(chart.y + chart.height);
    expect(higher.y + higher.height).toBeLessThanOrEqual(844);
    await playAll(page, 'Lower');
    await expect(page.locator('#pl-total')).toContainText('You guessed 5 of 10');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('does not jump', () => {
  test.use({ baseURL: `http://localhost:${BUILD_PORT}`, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

  test('CLS stays under 0.1 from the first paint to the first question', async ({ page }) => {
    await fakeBackend(page);
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
    await page.goto('/play/');
    await page.getByRole('button', { name: 'Play ten rounds' }).click();
    await expect(page.locator('#pl-step')).toHaveText('Round 1 of 10');
    await page.getByRole('button', { name: 'Higher' }).click();
    await page.waitForTimeout(3_000);
    const cls = await page.evaluate(() => (window as unknown as { cls: number }).cls);
    console.log(`play CLS ${cls.toFixed(3)}`);
    expect(cls).toBeLessThan(0.1);
  });
});
