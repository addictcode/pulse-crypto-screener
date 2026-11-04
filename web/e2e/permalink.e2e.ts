import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

// The permanent link is index.html in the repository root, served by GitHub Pages: it reads the
// tunnel's current address from the "live" branch and forwards the visitor. Played here with the
// page itself and fake GitHub, tunnel and demo answers.
const PAGES = 'https://addictcode.github.io/pulse-crypto-screener/';
const TUNNEL = 'https://calm-river-test.trycloudflare.com';
const REDIRECT = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

async function permalink(page: Page, tunnelUp: boolean, address = TUNNEL) {
  await page.route(`${PAGES}**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/pulse-crypto-screener/') return route.fulfill({ contentType: 'text/html', body: REDIRECT });
    return route.fulfill({ contentType: 'text/html', body: '<title>demo</title>' });
  });
  await page.route('https://api.github.com/**', (route) => route.fulfill({ body: address }));
  await page.route(`${address}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/status') {
      return tunnelUp
        ? route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
        : route.fulfill({ status: 530, body: 'tunnel error' });
    }
    return route.fulfill({ contentType: 'text/html', body: '<title>pulse</title>' });
  });
}

test('the TikTok tag survives the hop to the full version', async ({ page }) => {
  await permalink(page, true);
  await page.goto(`${PAGES}?utm_source=tiktok#screener:SOLUSDT`);
  await expect(page).toHaveURL(`${TUNNEL}/?utm_source=tiktok#screener:SOLUSDT`);
});

test('an untagged visit says where it came from instead of naming GitHub Pages', async ({ page }) => {
  await permalink(page, true);
  await page.goto(PAGES, { referer: 'https://www.youtube.com/' });
  await expect(page).toHaveURL(`${TUNNEL}/?ref=www.youtube.com`);
});

test('a typed address counts as direct', async ({ page }) => {
  await permalink(page, true);
  await page.goto(PAGES);
  await expect(page).toHaveURL(`${TUNNEL}/?ref=direct`);
});

test('a dead tunnel opens the demo, tag and all', async ({ page }) => {
  await permalink(page, false);
  await page.goto(`${PAGES}?utm_source=tiktok`);
  await expect(page).toHaveURL(`${PAGES}demo/?utm_source=tiktok`);
});

test('after the move the link follows the server', async ({ page }) => {
  const server = 'https://mypulse.duckdns.org';
  await permalink(page, true, server);
  await page.goto(`${PAGES}?utm_source=tiktok`);
  await expect(page).toHaveURL(`${server}/?utm_source=tiktok`);
});

test('an address of any other kind is not followed', async ({ page }) => {
  await permalink(page, true, 'https://pulse.example.com');
  await page.goto(PAGES);
  await expect(page).toHaveURL(`${PAGES}demo/?ref=direct`);
});
