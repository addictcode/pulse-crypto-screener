import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, type Page } from '@playwright/test';

import { STACK } from './playwright.config';

/** What went wrong on a page while the walk looked at it. */
export interface Watch {
  problems: string[];
}

/**
 * Listens for everything a visitor would not see but a broken page shows: console errors, uncaught
 * exceptions, failed requests to our own origin and Content Security Policy violations.
 */
export async function watch(page: Page): Promise<Watch> {
  const w: Watch = { problems: [] };
  const origin = new URL(STACK).origin;
  page.on('console', (m) => {
    if (m.type() === 'error') w.problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => w.problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(origin)) w.problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    // a socket closed by navigation is not a failure; a request the browser blocked is
    const reason = r.failure()?.errorText ?? '';
    if (r.url().startsWith(origin) && !/ERR_ABORTED/.test(reason)) w.problems.push(`failed: ${r.url()} ${reason}`);
  });
  await page.exposeFunction('__stackCsp', (text: string) => w.problems.push(`CSP: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __stackCsp(t: string): void }).__stackCsp(`${e.violatedDirective} blocked ${e.blockedURI}`),
    );
  });
  return w;
}

/** The page is no wider than the screen: nothing slides sideways under a thumb. */
export async function noSideScroll(page: Page) {
  const { width, screen, culprit } = await page.evaluate(() => {
    const de = document.documentElement;
    const screen = de.clientWidth;
    // the deepest element whose removal brings the page back to the screen's width, for the message
    let culprit = '';
    if (de.scrollWidth > screen) {
      const walk = (el: Element): void => {
        for (const child of Array.from(el.children) as HTMLElement[]) {
          const prev = child.style.display;
          child.style.display = 'none';
          const fits = de.scrollWidth <= screen;
          child.style.display = prev;
          if (fits) {
            culprit = `${child.tagName.toLowerCase()}${child.id ? `#${child.id}` : ''}${child.className && typeof child.className === 'string' ? `.${child.className.trim().split(/\s+/).join('.')}` : ''}`;
            return walk(child);
          }
        }
      };
      walk(document.body);
    }
    return { width: de.scrollWidth, screen, culprit };
  });
  expect(width, `the page is no wider than the screen (${culprit || 'no single element'})`).toBeLessThanOrEqual(screen);
}

/** No number the page printed came out as NaN, undefined or Infinity. */
export async function noBrokenNumbers(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  const broken = text.match(/.{0,30}\b(NaN|undefined|Infinity|null)\b.{0,30}/g) ?? [];
  expect(broken, 'no NaN, undefined, Infinity or null in the text').toEqual([]);
}

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/**
 * axe-core over the page with real data: contrast of live numbers, names of controls drawn from
 * the stream. Serious and critical findings fail; e2e/a11y.e2e.ts holds the fake-backend pages to
 * every rule.
 */
export async function noSeriousA11y(page: Page) {
  // a row fading in is measured at its final colour, not halfway: motion off, running fades finished
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  // through the debugger, not a <script>: the production CSP rightly refuses inline scripts
  await page.evaluate(AXE);
  const found = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: Document, o: object): Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run(document, { resultTypes: ['violations'] });
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  });
  expect(found, 'no serious or critical accessibility violations').toEqual([]);
}
