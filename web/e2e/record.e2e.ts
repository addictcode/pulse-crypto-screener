import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

test('the record says what the numbers mean and links the study behind it', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/record/');
  const shows = page.locator('#rec-shows');
  await expect(shows.locator('h2')).toHaveText('What the record shows');
  await expect(shows).toContainText('not what comes next');
  const study = shows.locator('a.rec-study').first();
  await expect(study).toHaveAttribute('href', /research\/signals-2026-10\.md$/);
  await expect(shows.locator('a.rec-study-2')).toHaveAttribute('href', /research\/oi-funding-2026-11\.md$/);
  await expect(shows).toContainText('market waking up');

  await page.locator('#lang [data-lang="ru"]').click();
  await expect(shows.locator('h2')).toHaveText('Что показывает статистика');
  await expect(shows).toContainText('а не что будет дальше');
  await expect(study).toHaveText('Исследование целиком и как оно сделано');
  await expect(shows).toContainText('рынок просыпается');
});

test('the record says how many signals the exchange candles confirmed', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/record/');
  await expect(page.locator('#rec-meta')).toContainText('checked against exchange candles: 37 of 38');
});

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' });

  test('the candle check is translated', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/ru/record/');
    await expect(page.locator('#rec-meta')).toContainText('сверено со свечами биржи: 37 из 38');
  });
});

test.describe('when Pulse was down for part of the period', () => {
  const down = [{ from: '2026-11-02T13:45:00Z', to: '2026-11-05T09:00:00Z' }];

  test('the record names the gap before the numbers', async ({ page }) => {
    await fakeBackend(page, { down });
    await page.goto('/record/');
    const note = page.locator('#rec-down');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Pulse was not running for 3 d of these 30 days (11-02 13:45 – 11-05 09:00, UTC)');
  });

  test('and says nothing about a full week', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/record/');
    await expect(page.locator('#rec-meta')).toContainText('checked against');
    await expect(page.locator('#rec-down')).toBeHidden();
  });

  for (const width of [320, 360, 390]) {
    test(`the note fits a ${width} px phone in Russian`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await fakeBackend(page, { down });
      await page.addInitScript(() => localStorage.setItem('pulse.lang', '"ru"'));
      await page.goto('/record/');
      await expect(page.locator('#rec-down')).toContainText('Pulse не работал 3 д');
      const { scroll, screen } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));
      expect(scroll).toBeLessThanOrEqual(screen);
    });
  }
});
