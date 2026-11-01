import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

test('a full server is not knocked on twice a second', async ({ page }) => {
  await fakeBackend(page);
  let attempts = 0;
  // the server at its client limit: it accepts the socket, then closes it with 1013 before any data
  await page.routeWebSocket(/\/ws\/market$/, (ws) => {
    attempts++;
    ws.close({ code: 1013, reason: 'too many clients' });
  });
  await page.goto('/app/#screener');
  await expect(page.locator('#st-conn')).not.toHaveText('Connected');
  await page.waitForTimeout(4_000);
  // the old client reset its pause on open and came back every half second: 4 times here
  expect(attempts).toBeLessThanOrEqual(2);
});
