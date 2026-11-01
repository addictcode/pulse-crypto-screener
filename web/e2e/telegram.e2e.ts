import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

// the landing keeps a full-screen WebGL scene, which a headless browser renders in software
test.describe.configure({ timeout: 90_000 });

const LINKS = { bot: 'PulseTestBot', channel: 'pulse_test' };

test('with the bot and the channel set up, the site leads to them and counts the clicks', async ({ page, context }) => {
  // the buttons open Telegram in a new tab; it stays offline
  await context.route('https://t.me/**', (route) => route.fulfill({ body: 'telegram' }));
  const backend = await fakeBackend(page, { links: LINKS });
  await page.goto('/');

  // first screen: the bot takes the place of "See it live"
  const hero = page.locator('.hero .actions');
  await expect(hero.locator('[data-tg="bot"]')).toHaveAttribute('href', 'https://t.me/PulseTestBot?start=site');
  await expect(hero.locator('a[href="#live"]')).toHaveCount(0);
  await expect(hero.locator('[data-tg="bot"]')).toHaveAccessibleName('Signals in Telegram');
  // the ending has both
  await expect(page.locator('.final [data-tg="bot"]')).toHaveText('Signals in Telegram');
  await expect(page.locator('.final [data-tg="channel"]')).toHaveAttribute('href', 'https://t.me/pulse_test');

  const popup = page.waitForEvent('popup');
  await hero.locator('[data-tg="bot"]').click();
  await (await popup).close();
  await expect.poll(() => backend.hits.map((h) => h.page)).toContain('bot-click');

  await page.locator('.final [data-tg="channel"]').scrollIntoViewIfNeeded();
  const channelPopup = page.waitForEvent('popup');
  await page.locator('.final [data-tg="channel"]').click();
  await (await channelPopup).close();
  await expect.poll(() => backend.hits.map((h) => h.page)).toContain('channel-click');
});

test('the record page and the recording frame show Telegram too, in Russian on request', async ({ page }) => {
  await fakeBackend(page, { links: LINKS });
  await page.addInitScript(() => localStorage.setItem('pulse.lang', '"ru"'));
  await page.goto('/record/');
  await expect(page.locator('#rec-tg')).toBeVisible();
  await expect(page.locator('#rec-tg [data-tg="bot"]')).toHaveText('Сигналы в Telegram');
  await expect(page.locator('#rec-tg [data-tg="channel"]')).toHaveText('Канал');

  await page.goto('/app/#clip:BTCUSDT');
  await expect(page.locator('.clip-foot [data-tg="bot"]')).toHaveText('Telegram @PulseTestBot');
});

test('without Telegram set up there are no buttons', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  await expect(page.locator('#s-pairs')).not.toHaveText('', { timeout: 20_000 });
  await expect(page.locator('.hero a[href="#live"]')).toBeVisible();
  await expect(page.locator('[data-tg]')).toHaveCount(0);
  await expect(page.locator('#final-tg')).toBeHidden();

  await page.goto('/record/');
  await expect(page.locator('#rec-meta')).not.toHaveText('loading');
  await expect(page.locator('#rec-tg')).toBeHidden();
});
