import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

// the landing keeps a full-screen WebGL scene, which a headless browser renders in software
test.describe.configure({ timeout: 90_000 });

test('each page counts itself once, and the visit keeps the source it came with', async ({ page }) => {
  const backend = await fakeBackend(page);
  await page.goto('/?utm_source=tiktok');
  await expect.poll(() => backend.hits).toContainEqual({ page: 'landing', source: 'tiktok' });
  // read and remembered: a link copied from the address bar no longer says TikTok
  await expect(page).toHaveURL(/\/$/);

  await page.locator('.hero .cta').click();
  await expect(page).toHaveURL(/\/app\//);
  // the terminal is reached from our own landing: the visit is still from TikTok
  await expect.poll(() => backend.hits).toContainEqual({ page: 'app', source: 'tiktok' });

  await page.keyboard.press('v');
  await expect.poll(() => backend.hits).toContainEqual({ page: 'clip', source: 'tiktok' });

  await page.goto('/record/');
  await expect.poll(() => backend.hits).toContainEqual({ page: 'record', source: 'tiktok' });
  // back on the landing, and a reload: the same visitor, still one visit
  await page.goto('/');
  await page.reload();
  await page.goto('/record/');
  await expect.poll(() => backend.hits.filter((h) => h.page === 'record')).toHaveLength(1);
  expect(backend.hits.filter((h) => h.page === 'landing')).toHaveLength(1);
});

test('a visit without a tag or a referrer is direct', async ({ page }) => {
  const backend = await fakeBackend(page);
  await page.goto('/record/');
  await expect.poll(() => backend.hits).toContainEqual({ page: 'record', source: '' });
});
