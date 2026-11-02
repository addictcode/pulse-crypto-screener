import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { fakeBackend, type FakeBackend } from './backend';

// Every page and the menus that open over it, checked with axe-core (the engine behind
// Lighthouse's accessibility score): names for buttons, valid ARIA, landmarks, contrast.
// A new control without a label fails here before it reaches a screen reader.
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const PHONE = { width: 390, height: 844 };

// the landing keeps a WebGL scene, which a headless browser renders in software
test.describe.configure({ timeout: 90_000 });

async function violations(page: Page): Promise<string[]> {
  // text fading in is measured at its final colour, not halfway through (the endless pulses are left alone)
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() =>
    (window as unknown as { axe: { run(context: Document, options: object): Promise<{ violations: Array<{ id: string; help: string; nodes: Array<{ target: string[] }> }> }> } })
      .axe.run(document, { resultTypes: ['violations'] }),
  );
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

/** A first visit on a phone opens the live feed; fakeBackend marks every test a returning visitor. */
async function firstVisit(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('fresh')) {
      sessionStorage.setItem('fresh', '1');
      localStorage.clear();
    }
  });
}

function events(backend: FakeBackend) {
  const now = Date.now();
  backend.push({ type: 'tape', items: [{ kind: 'PUMP_5M', symbol: 'SOLUSDT', time: now - 30_000, price: 120, value: 3.4 }] });
  backend.push({ type: 'liquidations', items: [{ symbol: 'ETHUSDT', side: 'LONG', price: 3_000, quantity: 100, time: now - 10_000 }] });
}

for (const lang of ['en', 'ru']) {
  test.describe(`in ${lang === 'en' ? 'English' : 'Russian'}`, () => {
    test.use({ locale: lang === 'en' ? 'en-US' : 'ru-RU' });

    test('the landing page', async ({ page }) => {
      await fakeBackend(page);
      await page.goto('/');
      await expect(page.locator('#s-pairs')).not.toBeEmpty({ timeout: 20_000 });
      expect(await violations(page)).toEqual([]);
    });

    test('the record page', async ({ page }) => {
      await fakeBackend(page);
      await page.goto('/record/');
      await expect(page.locator('main')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('the terminal and the menus over it', async ({ page }) => {
      await fakeBackend(page);
      await page.goto('/app/');
      await expect(page.locator('#rows tr[data-sym]').first()).toBeVisible();
      expect(await violations(page), 'terminal').toEqual([]);

      await page.keyboard.press('Control+k');
      await expect(page.locator('#palette')).toBeVisible();
      expect(await violations(page), 'command palette').toEqual([]);
      await page.locator('#pal-q').fill('zzzzqq');
      await expect(page.locator('.pal-empty')).toBeVisible();
      expect(await violations(page), 'command palette, nothing found').toEqual([]);
      await page.keyboard.press('Escape');

      await page.locator('#al-btn').click();
      await expect(page.locator('#al-menu')).toBeVisible();
      expect(await violations(page), 'alert menu').toEqual([]);
      await page.locator('#al-btn').click();

      await page.locator('#presets [data-act="new"]').click();
      await expect(page.locator('#flt-menu form')).toBeVisible();
      expect(await violations(page), 'filter editor').toEqual([]);
      await page.keyboard.press('Escape');

      await page.locator('#settings-btn').click();
      expect(await violations(page), 'settings').toEqual([]);
    });

    test('the terminal on a phone', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await fakeBackend(page);
      await page.goto('/app/');
      await expect(page.locator('#rows tr[data-sym]').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test('the live feed on a first visit from a phone', async ({ page }) => {
      await page.setViewportSize(PHONE);
      const backend = await fakeBackend(page, { links: { bot: 'PulseBot', channel: 'pulse_live' } });
      await firstVisit(page);
      await page.goto('/app/');
      await expect(page.locator('#live-feed')).toBeVisible();
      events(backend);
      await expect(page.locator('.feed-card').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
