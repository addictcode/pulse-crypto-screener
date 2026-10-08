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
