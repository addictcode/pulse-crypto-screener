import { expect, test } from '@playwright/test';

import { fakeBackend } from './backend';

test('the record says what the numbers mean and links the study behind it', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/record/');
  const shows = page.locator('#rec-shows');
  await expect(shows.locator('h2')).toHaveText('What the record shows');
  await expect(shows).toContainText('not what comes next');
  const study = shows.locator('a.rec-study').first();
  await expect(study).toHaveAttribute('href', /research\/signals-2026-10\.md$/);
  await expect(shows.locator('a.rec-study-2')).toHaveAttribute('href', /research\/oi-funding-2026-11\.md$/);
  await expect(shows).toContainText('market waking up');

  await page.locator('#lang [data-lang="ru"]').click();
  await expect(shows.locator('h2')).toHaveText('Что показывает статистика');
  await expect(shows).toContainText('а не что будет дальше');
  await expect(study).toHaveText('Исследование целиком и как оно сделано');
  await expect(shows).toContainText('рынок просыпается');
});
