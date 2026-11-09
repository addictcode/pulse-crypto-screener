import { expect, test, type Page } from '@playwright/test';

// The look of the four pages, compared with references in e2e-stack/snapshots/. Only the visual
// projects run this (playwright.config.ts): a phone 360 px wide and a desktop. Everything that
// lives (numbers, the planet, charts, clocks) is hidden, animations are off, fonts are loaded.
// A deliberate change of the look: npm run stack -- --update-snapshots, and the PR shows
// before / after pictures for the owner to accept.
const PUBLIC = ['en', 'ru', 'es', 'tr'];
const TERMINAL = ['en', 'ru'];

interface Shot {
  name: string;
  path: (pair: string) => string;
  langs: string[];
  /** What changes from one run to the next: hidden, its place on the page kept. */
  hide: string[];
  ready?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  {
    name: 'landing',
    path: () => '/',
    langs: PUBLIC,
    hide: ['#s-pairs', '#s-books', '#s-liq', '#s-tape', '#ticker-track', '.mini tbody', '#wall-strip'],
  },
  {
    name: 'record',
    path: () => '/record/',
    langs: PUBLIC,
    hide: ['#rec-meta', '#rec-kpi dd', '#rec-n', '#rec-rows', '#rec-move', '#rec-shows'],
  },
  {
    name: 'play',
    path: () => '/play/',
    langs: PUBLIC,
    hide: ['#pl-history'],
  },
  {
    name: 'terminal',
    path: (pair) => `/app/#screener:${pair}`,
    langs: TERMINAL,
    hide: [
      '#chart', '#rows', '#tape', '#tape-meta', '#liqs', '#liq-l', '#liq-s', '#liq-lb', '#liq-sb', '#ladder', '#book-meta',
      '#ins-price', '#ins-chg', '#rng-lo', '#rng-mark', '#rng-hi', '#ins-fund', '#ins-fund-t', '#ins-oi', '#ins-oi15', '#ins-vol', '#ins-volx', '#ins-moves',
      '.preset .count', '.statusbar', '#m-btc', '#m-btc-c', '#m-eth', '#m-eth-c', '#m-vol', '#breadth', '#feed-list',
    ],
  },
];

for (const shot of SHOTS) {
  for (const lang of shot.langs) {
    test(`${shot.name} in ${lang}`, async ({ page }) => {
      await page.addInitScript((l) => {
        localStorage.setItem('pulse.lang', JSON.stringify(l));
        // a returning visitor: the tour and the welcome would cover the page
        localStorage.setItem('pulse.welcomed', '1');
      }, lang);
      await page.goto(shot.path(process.env.STACK_PAIR ?? 'FAKE000USDT'));
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(3_000);
      // the planet and the charts draw on canvases, live every frame. Added as a style tag: the
      // style option of toHaveScreenshot did not reach the page in Playwright 1.64.
      await page.addStyleTag({ content: `canvas, ${shot.hide.join(', ')} { visibility: hidden !important; }` });
      await expect(page).toHaveScreenshot(`${shot.name}-${lang}-${test.info().project.name}.png`);
    });
  }
}
