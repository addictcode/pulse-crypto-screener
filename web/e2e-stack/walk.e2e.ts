import { expect, test, type Page } from '@playwright/test';

import { noBrokenNumbers, noSideScroll, watch } from './watch';

// Every page in every language it has, on a desktop and on 320 and 390 px phones (the projects in
// playwright.config.ts). The public pages speak four languages, the terminal two (owner's decision
// of 9.11.2026); the /ru/ twins are Russian by their address.
const PUBLIC = ['en', 'ru', 'es', 'tr'] as const;
const TERMINAL = ['en', 'ru'] as const;

interface Visit {
  path: string;
  lang: string;
  /** Set the language through storage, as the switch does; the /ru/ twins need nothing. */
  choose: boolean;
  /** Live numbers that must be filled in once the stream has had its 10 seconds. */
  live?: (page: Page) => Promise<void>;
}

const landingLive = async (page: Page) => {
  for (const id of ['s-pairs', 's-books', 's-liq']) {
    await expect(page.locator(`#${id}`), `#${id} shows a number`).toHaveText(/\d/);
  }
};

const terminalLive = async (page: Page) => {
  const rows = page.locator('#rows tr[data-sym]');
  await expect(rows.first(), 'the market list fills in').toBeAttached();
  expect(await rows.count()).toBeGreaterThan(10);
  await expect(rows.first(), 'a row shows a price').toHaveText(/\d/);
};

const recordLive = async (page: Page) => {
  // a fresh stack has no signals yet; the counter is a number all the same, never blank
  await expect(page.locator('#rec-n')).toHaveText(/^\s*[\d,  ]+\s*$/);
};

function visits(pair: string): Visit[] {
  return [
    ...PUBLIC.map((lang) => ({ path: '/', lang, choose: true, live: landingLive })),
    { path: '/ru/', lang: 'ru', choose: false, live: landingLive },
    ...PUBLIC.map((lang) => ({ path: '/record/', lang, choose: true, live: recordLive })),
    { path: '/ru/record/', lang: 'ru', choose: false, live: recordLive },
    ...PUBLIC.map((lang) => ({ path: '/play/', lang, choose: true })),
    { path: '/ru/play/', lang: 'ru', choose: false },
    ...TERMINAL.map((lang) => ({ path: `/app/#screener:${pair}`, lang, choose: true, live: terminalLive })),
  ];
}

const pair = () => process.env.STACK_PAIR ?? 'FAKE000USDT';

for (const v of visits('PAIR')) {
  test(`${v.path.replace('PAIR', '<pair>')} in ${v.lang}`, async ({ page }) => {
    const w = await watch(page);
    if (v.choose) await page.addInitScript((l) => localStorage.setItem('pulse.lang', JSON.stringify(l)), v.lang);
    await page.goto(v.path.replace('PAIR', pair()));
    await expect(page.locator('html')).toHaveAttribute('lang', v.lang);
    // the stream has its ten seconds: an empty number after that is a broken page, not a slow one
    await page.waitForTimeout(10_000);
    if (v.live) await v.live(page);
    await noBrokenNumbers(page);
    await noSideScroll(page);
    expect(w.problems, 'no console errors, exceptions, failed requests or CSP violations').toEqual([]);
  });
}

// A first visit to the terminal starts the tour. On a phone it once pointed at a market list that
// had slid off the screen and ended with "press Ctrl K" for a keyboard the phone does not have.
test('the terminal tour stays on screen and fits the device', async ({ page }, info) => {
  const w = await watch(page);
  await page.goto(`/app/#screener:${pair()}`);
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible();
  // the market fills in under the tour; the ring must still be on screen once it has
  await expect(page.locator('#rows tr[data-sym]').first()).toBeAttached();
  await page.waitForTimeout(3_000);
  const screen = page.viewportSize()!;
  for (let step = 0; step < 8; step++) {
    const ring = await page.locator('.tour-ring').boundingBox();
    if (ring && ring.width > 0) {
      expect(ring.y, 'the ring starts above the bottom of the screen').toBeLessThan(screen.height);
      expect(ring.y + ring.height, 'the ring ends below the top of the screen').toBeGreaterThan(0);
    }
    const box = await card.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(screen.width + 1);
    const next = card.locator('[data-act="next"]');
    const last = /Got it/.test(await next.innerText());
    if (last) {
      if (info.project.name !== 'desktop') await expect(card, 'no keyboard on a phone').not.toContainText(/Ctrl|⌘/);
      break;
    }
    await next.click();
  }
  await noSideScroll(page);
  expect(w.problems).toEqual([]);
});
