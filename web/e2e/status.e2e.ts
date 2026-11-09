import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

test('the status page says Pulse is live and draws the last day', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/status/');
  await expect(page.locator('#st-word')).toHaveText('Live');
  await expect(page.locator('#st-feed')).toHaveText('530 pairs, 2 of 2 connections open');
  await expect(page.locator('#st-books')).toHaveText('58 of 60');
  await expect(page.locator('#st-signal')).toHaveText('Pump WIF, 95 s ago');
  await expect(page.locator('#st-strip span')).toHaveCount(96);
  await expect(page.locator('#st-strip span.stale')).not.toHaveCount(0);
  await expect(page.locator('#st-share')).toContainText('Live 97.2% of the recorded minutes');
});

test('the status page says when the exchange data is old', async ({ page }) => {
  await fakeBackend(page, { feedAge: 95_000 });
  await page.goto('/status/');
  await expect(page.locator('#st-word')).toHaveText('Not live');
  await expect(page.locator('#st-age')).toHaveText('95 s');
});

test('the status page in Russian', async ({ page }) => {
  await fakeBackend(page);
  await page.addInitScript(() => localStorage.setItem('pulse.lang', '"ru"'));
  await page.goto('/status/');
  await expect(page.locator('h1')).toHaveText('Статус');
  await expect(page.locator('#st-signal')).toHaveText('Памп WIF, 95 с назад');
});

test('the footers link to the status page', async ({ page }) => {
  await fakeBackend(page);
  for (const path of ['/', '/record/', '/play/']) {
    await page.goto(path);
    await expect(page.locator('.foot a[href="/status/"]')).toBeVisible();
  }
});

test.describe('stale data', () => {
  test('the landing says so when the exchange data is old', async ({ page }) => {
    await fakeBackend(page, { feedAge: 120_000 });
    await page.goto('/');
    const bar = page.locator('.stale-banner');
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(bar).toContainText('The exchange data is 2 min old');
    await expect(bar.locator('a')).toHaveAttribute('href', '/status/');
  });

  test('the landing stays quiet while the data is fresh', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/');
    await page.waitForTimeout(3_000);
    await expect(page.locator('.stale-banner')).toBeHidden();
  });

  test('the terminal says so when the exchange data is old', async ({ page }) => {
    await fakeBackend(page, { feedAge: 60_000 });
    await page.goto('/app/#screener:BTCUSDT');
    await expect(page.locator('.stale-banner')).toContainText(/The exchange data is \d+ s old/, { timeout: 10_000 });
  });

  test('the terminal says so when the server goes silent', async ({ page }) => {
    await page.clock.install();
    await fakeBackend(page);
    await page.goto('/app/#screener:BTCUSDT');
    await expect(page.locator('#rows tr[data-sym]').first()).toBeAttached();
    await expect(page.locator('.stale-banner')).toBeHidden();
    // nothing arrives for 40 seconds: the fake stream only speaks when pushed
    await page.clock.fastForward(40_000);
    await expect(page.locator('.stale-banner')).toContainText('No data from the Pulse server for', { timeout: 10_000 });
  });
});
