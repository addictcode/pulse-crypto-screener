import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

test('the landing speaks Spanish on request and says the translation is a draft', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  await page.locator('#lang [data-lang="es"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('.nav .cta')).toHaveText('Abrir terminal');
  await expect(page.locator('#lang [data-lang="es"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.foot .draft-note')).toHaveText('Traducción preliminar');
});

test('a Turkish browser gets the game in Turkish, and the terminal stays English', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'tr-TR' });
  const page = await context.newPage();
  await fakeBackend(page);
  await page.goto('/play/');
  await expect(page.locator('.pl-title')).toHaveText('Sırada ne var, tahmin et');
  await page.getByRole('button', { name: 'On tur oyna' }).click();
  await page.getByRole('button', { name: 'Daha yüksek' }).click();
  await expect(page.locator('#pl-reveal')).toContainText('Bu');
  await expect(page.locator('.foot .draft-note')).toHaveText('Ön çeviri');

  // the terminal is not translated beyond Russian: Turkish readers get English there
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await context.close();
});

test('the record page in Spanish', async ({ page }) => {
  await fakeBackend(page);
  await page.addInitScript(() => localStorage.setItem('pulse.lang', '"es"'));
  await page.goto('/record/');
  await expect(page.locator('.rec-title')).toHaveText('La estadística');
});
