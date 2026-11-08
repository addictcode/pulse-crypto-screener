import { expect, test, type Page } from '@playwright/test';

import { fakeBackend } from './backend';

/**
 * Headless Chromium has no push service to subscribe with, so the browser side is stood in for:
 * the service worker registration and PushManager hand back a fixed subscription, and the test
 * checks what the page sends the server. Delivery itself, encrypted and signed, is tested on the
 * backend against a fake push service (PushIT).
 */
async function fakePush(page: Page) {
  await page.addInitScript(() => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'BCVx', auth: 'BTBZ' } }),
      unsubscribe: async () => true,
    };
    let subscribed = false;
    const pushManager = {
      getSubscription: async () => (subscribed ? subscription : null),
      subscribe: async () => ((subscribed = true), subscription),
    };
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => ({ pushManager }) }, configurable: true });
    (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
    (window as unknown as { Notification: unknown }).Notification = { permission: 'default', requestPermission: async () => 'granted' };
  });
}

test('notifications are offered only when the server has keys', async ({ page }) => {
  await fakeBackend(page);
  await page.route('**/api/push/key', (route) => route.fulfill({ status: 404 }));
  await page.goto('/app/');
  await page.locator('#settings-btn').click();
  await expect(page.locator('#set-push-row')).toBeHidden();
});

test('picking a mode subscribes this browser with its watchlist and language', async ({ page }) => {
  await fakeBackend(page);
  await fakePush(page);
  await page.addInitScript(() => localStorage.setItem('pulse.watchlists', JSON.stringify([{ id: 'w', name: 'W', symbols: ['WIFUSDT', 'SOLUSDT'] }])));
  await page.route('**/api/push/key', (route) => route.fulfill({ json: { key: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4' } }));
  const sent: unknown[] = [];
  await page.route('**/api/push/subscribe', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/push/unsubscribe', (route) => {
    sent.push({ off: route.request().postDataJSON() });
    return route.fulfill({ status: 204 });
  });

  await page.goto('/app/');
  await page.locator('#settings-btn').click();
  await expect(page.locator('#set-push-row')).toBeVisible();
  await page.locator('#set-push').selectOption('watchlist');
  await expect(page.locator('#set-push-note')).toHaveText('Done. At most a few notifications an hour.');
  expect(sent[0]).toEqual({
    endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'BCVx', auth: 'BTBZ' }, symbols: ['WIFUSDT', 'SOLUSDT'], strongOnly: false, lang: 'en',
  });

  await page.locator('#set-push').selectOption('off');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ off: { endpoint: 'https://fcm.googleapis.com/fcm/send/test' } });
  expect(await page.evaluate(() => localStorage.getItem('pulse.pushMode'))).toBe('"off"');
});

test('an iPhone outside the Home Screen is told how to get notifications', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await fakeBackend(page);
  await page.route('**/api/push/key', (route) => route.fulfill({ json: { key: 'BCVx' } }));
  await page.goto('/app/#screener');
  await page.evaluate(() => (document.getElementById('settings') as HTMLDialogElement).showModal());
  await expect(page.locator('#set-push-note')).toContainText('Add to Home Screen');
  await expect(page.locator('#set-push')).toBeDisabled();
  await context.close();
});
