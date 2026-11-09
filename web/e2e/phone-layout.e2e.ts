import { expect, test, type Page } from '@playwright/test';

import { BUILD_PORT } from '../playwright.config';
import { fakeBackend, ROWS } from './backend';

// A page wider than the phone slides sideways under the thumb. It happened once already: four
// language buttons and the terminal button did not fit across the landing's header.
async function noSideScroll(page: Page) {
  const { page: width, screen } = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));
  expect(width, 'the page is no wider than the screen').toBeLessThanOrEqual(screen);
}

for (const width of [320, 360, 390]) {
  test.describe(`a phone ${width} px wide`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: true });

    for (const [path, lang] of [['/', 'en'], ['/', 'ru'], ['/record/', 'ru'], ['/play/', 'tr'], ['/app/', 'ru']] as const) {
      test(`${path} in ${lang} does not slide sideways`, async ({ page }) => {
        await fakeBackend(page);
        await page.addInitScript((l) => localStorage.setItem('pulse.lang', JSON.stringify(l)), lang);
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await page.waitForTimeout(500);
        await noSideScroll(page);
      });
    }
  });
}

test.describe('the Russian twin on a phone', () => {
  test.use({ baseURL: `http://localhost:${BUILD_PORT}`, viewport: { width: 360, height: 800 }, hasTouch: true });

  test('/ru/ does not slide sideways', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/ru/');
    await noSideScroll(page);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the language switch shows the current language and unfolds the others on a tap', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/');
    const current = page.locator('#lang [data-lang="en"]');
    await expect(current).toBeVisible();
    await expect(page.locator('#lang [data-lang="es"]')).toBeHidden();
    await current.tap();
    await expect(current).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#lang [data-lang="es"]').tap();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#lang [data-lang="es"]')).toBeVisible();
    await expect(page.locator('#lang [data-lang="en"]')).toBeHidden();
  });

  test('a tap elsewhere folds the switch again', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/');
    await page.locator('#lang [data-lang="en"]').tap();
    await expect(page.locator('#lang [data-lang="tr"]')).toBeVisible();
    await page.touchscreen.tap(30, 420);
    await expect(page.locator('#lang [data-lang="tr"]')).toBeHidden();
  });

  test('the tour keeps the panel it talks about on screen while the market fills in', async ({ page }) => {
    await fakeBackend(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fresh')) {
        sessionStorage.setItem('fresh', '1');
        localStorage.removeItem('pulse.welcomed');
      }
    });
    // a link to a pair opens the terminal itself (a bare first visit on a phone gets the live feed)
    await page.goto('/app/#screener:BTCUSDT');
    await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
    const card = page.locator('.tour-card');
    await expect(card).toContainText('The whole market');
    const ring = await page.locator('.tour-ring').boundingBox();
    expect(ring, 'the ring is drawn').not.toBeNull();
    // at least part of the market list is on screen, under the ring
    expect(ring!.y).toBeLessThan(844);
    expect(ring!.y + ring!.height).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await card.getByRole('button', { name: /Next|Got it/ }).tap();
    // no keyboard on a phone: the last step does not talk about Ctrl K
    await expect(card).toContainText('Find anything');
    await expect(card).not.toContainText('Ctrl K');
  });
});
