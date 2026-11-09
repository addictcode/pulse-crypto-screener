import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

// An error no code caught reaches the server once, with the page path and nothing that names
// the visitor; a page that keeps failing sends at most five.
for (const path of ['/', '/app/', '/record/', '/play/']) {
  test(`an uncaught error on ${path} is reported once`, async ({ page }) => {
    const backend = await fakeBackend(page);
    await page.goto(`${path}?utm_source=tiktok#screener:BTCUSDT`);
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) setTimeout(() => { throw new Error('e2e boom'); });
    });
    await expect.poll(() => backend.errors.length).toBe(1);
    const [r] = backend.errors;
    expect(r.message).toBe('Error: e2e boom');
    expect(r.page).toBe(path);
    expect(r.lang).toBe('en');
    expect(r.build).not.toBe('');
    expect(JSON.stringify(r)).not.toMatch(/tiktok|BTCUSDT/);
  });
}

test('a page that keeps failing sends five reports, rejections included', async ({ page }) => {
  const backend = await fakeBackend(page);
  await page.goto('/record/');
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) void Promise.reject(new Error(`rejected ${i}`));
  });
  await expect.poll(() => backend.errors.length).toBe(5);
  await page.waitForTimeout(500);
  expect(backend.errors).toHaveLength(5);
  expect(backend.errors[0].message).toBe('Error: rejected 0');
});
