import { expect, test } from '@playwright/test';

import { fakeBackend, ROWS } from './backend';

// Everything a mouse or a finger can do on the public pages and in the tour, a keyboard can too.

test.describe('the language switch', () => {
  test('arrows walk the languages on a desktop', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/');
    await page.locator('#lang [data-lang="en"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#lang [data-lang="ru"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#lang [data-lang="tr"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 780 } });

    test('an arrow unfolds it, Escape folds it and keeps the focus', async ({ page }) => {
      await fakeBackend(page);
      await page.goto('/record/');
      const current = page.locator('#lang [data-lang="en"]');
      await current.focus();
      await page.keyboard.press('ArrowDown');
      await expect(current).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#lang [data-lang="ru"]')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(current).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#lang [data-lang="ru"]')).toBeHidden();
      await expect(current).toBeFocused();
    });

    test('leaving it with Tab folds it', async ({ page }) => {
      await fakeBackend(page);
      await page.goto('/play/');
      await page.locator('#lang [data-lang="en"]').focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('#lang [data-lang="es"]')).toBeVisible();
      await page.locator('#lang [data-lang="tr"]').focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('#lang [data-lang="es"]')).toBeHidden();
    });
  });
});

test.describe('the tour', () => {
  test.beforeEach(async ({ page }) => {
    await fakeBackend(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fresh')) {
        sessionStorage.setItem('fresh', '1');
        localStorage.removeItem('pulse.welcomed');
      }
    });
    await page.goto('/app/#screener:BTCUSDT');
    await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  });

  test('keeps the keyboard in its card', async ({ page }) => {
    const card = page.locator('.tour-card');
    await expect(card.locator('[data-act="next"]')).toBeFocused();
    await expect(card).toHaveAttribute('aria-labelledby', 'tour-title');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.tour-card'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.tour-card'))).toBe(true);
  });

  test('Escape ends it from anywhere', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(page.locator('.tour-card')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('pulse.welcomed'))).toBe('true');
  });
});

test('a column header explains itself on focus and sorts on Enter', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app/#screener:BTCUSDT');
  await expect(page.locator('#rows tr[data-sym]')).toHaveCount(ROWS.length);
  // the compact list shows no explained column; the wide one does
  await page.locator('#list-wide').click();
  const header = page.locator('#head th[data-term]:visible').first();
  await header.focus();
  const tip = page.locator('.term-tip');
  await expect(tip).toBeVisible();
  await expect(header).toHaveAttribute('aria-describedby', 'term-tip');
  // the list re-sorts every few seconds; the header must not be drawn anew under the keyboard
  const name = await header.getAttribute('data-sort');
  await page.waitForTimeout(5_500);
  await expect(page.locator(`#head th[data-sort="${name}"]`)).toBeFocused();
  await expect(tip).toBeVisible();
  const key = await header.getAttribute('data-sort');
  await page.keyboard.press('Enter');
  await expect(page.locator(`#head th[data-sort="${key}"]`)).toHaveAttribute('aria-sort', /ascending|descending/);
  await expect(page.locator(`#head th[data-sort="${key}"]`)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
});

test('a panel title with a term explains itself on focus', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app/#screener:BTCUSDT');
  await page.locator('h2[data-term="liquidation"]').focus();
  await expect(page.locator('.term-tip')).toBeVisible();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const path of ['/', '/record/', '/play/']) {
    test(`${path} runs no animation`, async ({ page }) => {
      await fakeBackend(page);
      await page.goto(path);
      await page.waitForTimeout(1_500);
      const running = await page.evaluate(() =>
        document.getAnimations()
          .filter((a) => a.playState === 'running')
          .map((a) => `${(a.effect as KeyframeEffect | null)?.target?.toString()} ${(a as CSSAnimation).animationName ?? 'transition'}`),
      );
      expect(running).toEqual([]);
    });
  }

  test('the game shows the hour after the question at once', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/play/');
    await page.locator('#pl-start').click();
    await page.locator('.pl-pick').first().click();
    // with motion the hour plays for 2.4 s; without it the verdict is there straight away
    await expect(page.locator('#pl-verdict')).not.toBeEmpty({ timeout: 600 });
  });
});
