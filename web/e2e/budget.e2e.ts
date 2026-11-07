import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

// What each page makes a visitor download before it shows anything, compressed, from the
// production build the e2e server makes (playwright.config.ts). TikTok sends phones on mobile data:
// growth here should be a decision, not an accident. Raising a number is fine when the reason is
// worth it; write it in the commit.
const DIST = 'dist-e2e';
const KB = 1024;
const BUDGET = {
  'index.html': { js: 32 * KB, css: 11 * KB },
  'app/index.html': { js: 150 * KB, css: 17 * KB },
  'record/index.html': { js: 26 * KB, css: 12 * KB },
  // the game: its own canvas chart, no chart library, so mostly the Russian dictionary like /record/;
  // the rounds load as JSON, about 10 KB a pack
  'play/index.html': { js: 26 * KB, css: 12 * KB },
};
/** The landing's planet loads after the words and numbers are on screen, as its own file. */
const PLANET = 165 * KB;

const gz = (file: string) => gzipSync(readFileSync(join(DIST, file)), { level: 9 }).length;

/** The scripts and styles a page links: its entry, the chunks it preloads and their CSS. */
function firstLoad(page: string) {
  const html = readFileSync(join(DIST, page), 'utf8');
  const files = new Set([...html.matchAll(/(?:src|href)="(?:\.\.\/|\.\/|\/)?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]));
  const sum = (ext: string) => [...files].filter((f) => f.endsWith(ext)).reduce((total, f) => total + gz(f), 0);
  return { js: sum('.js'), css: sum('.css') };
}

for (const [page, budget] of Object.entries(BUDGET)) {
  test(`${page} stays within its download budget`, () => {
    const size = firstLoad(page);
    console.log(`${page}: js ${(size.js / KB).toFixed(1)} KB, css ${(size.css / KB).toFixed(1)} KB (gzip)`);
    expect(size.js, `${page} JavaScript, gzip`).toBeLessThanOrEqual(budget.js);
    expect(size.css, `${page} CSS, gzip`).toBeLessThanOrEqual(budget.css);
  });
}

test('the planet stays within its budget and out of the first load', () => {
  const planet = readdirSync(join(DIST, 'assets')).filter((f) => /^planet-.*\.js$/.test(f));
  expect(planet).toHaveLength(1);
  const size = gz(join('assets', planet[0]));
  console.log(`planet: ${(size / KB).toFixed(1)} KB (gzip)`);
  expect(size).toBeLessThanOrEqual(PLANET);
  expect(readFileSync(join(DIST, 'index.html'), 'utf8')).not.toContain(planet[0]);
});
