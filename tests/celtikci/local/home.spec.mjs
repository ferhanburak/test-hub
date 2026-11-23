import { test, expect } from '@playwright/test';

test('CLT-WEB-002 home page opens', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/');

  expect(response?.ok()).toBe(true);
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('main a[href="/iletisim"]')).toBeVisible();

  const portrait = page.locator('main img').first();
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
