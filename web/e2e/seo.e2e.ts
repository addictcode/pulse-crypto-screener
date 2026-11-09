import { expect, test } from '@playwright/test';

import { BUILD_PORT } from '../playwright.config';
import { fakeBackend } from './backend';

// the production build: the Russian twins exist only there (seo.ts writes them after the build)
test.use({ baseURL: `http://localhost:${BUILD_PORT}` });

test('the Russian landing has its text in the HTML, before any script', async ({ request }) => {
  const html = await (await request.get('/ru/')).text();
  expect(html).toMatch(/<html lang="ru" data-page-lang="ru"[ >]/);
  expect(html).toContain('<title>Pulse: радар крипто-фьючерсов</title>');
  expect(html).toContain('>Открыть терминал<');
  expect(html).toContain('rel="canonical" href="https://{{.Host}}/ru/"');
  const english = await (await request.get('/')).text();
  expect(english).toContain('hreflang="ru" href="https://{{.Host}}/ru/"');
  expect(english).toContain('"@type":"WebApplication"');
});

test('the switch moves between the two addresses, and the Russian page leads to the terminal', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  await page.locator('#lang [data-lang="ru"]').click();
  await expect(page).toHaveURL(/\/ru\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.nav .cta')).toHaveText('Открыть терминал');

  await page.locator('#lang [data-lang="en"]').click();
  await expect(page).toHaveURL(new RegExp(`:${BUILD_PORT}/$`));
  await expect(page.locator('.nav .cta')).toHaveText('Open terminal');

  await page.goto('/ru/');
  await page.locator('.nav .cta').click();
  await expect(page).toHaveURL(/\/app\/(#.*)?$/);
  // the terminal follows the language chosen on the Russian page
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

test('the Russian record page works from its own address', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/ru/record/');
  await expect(page.locator('.rec-title')).toHaveText('Статистика');
  await page.locator('#lang [data-lang="en"]').click();
  await expect(page).toHaveURL(/\/record\/$/);
  await expect(page.locator('.rec-title')).toHaveText('The record');
});

test('the game has a Russian twin too, and it plays', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/ru/play/');
  await expect(page.locator('.pl-title')).toHaveText('Угадай, что дальше');
  await page.getByRole('button', { name: 'Сыграть 10 раундов' }).click();
  await expect(page.locator('#pl-step')).toHaveText('Раунд 1 из 10');
});

test('Spanish chosen on the Russian landing goes to the English address and translates there', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/ru/');
  await page.locator('#lang [data-lang="es"]').click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('.hero h1')).toContainText('Mira dónde');
});
