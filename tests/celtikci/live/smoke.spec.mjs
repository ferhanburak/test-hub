import { test, expect } from '@playwright/test';

test('CLT-WEB-004 live site smoke', async ({ page }) => {
  // Read-only: the form is never submitted and any write request is blocked.
  const writes = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    writes.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });

  const home = await page.goto('/');
  expect(home?.ok()).toBe(true);
  await expect(page.locator('main h1')).toBeVisible();

  // Direct load guards the SPA rewrite on Vercel.
  const contact = await page.goto('/iletisim');
  expect(contact?.ok()).toBe(true);
  await expect(page.locator('form #email')).toBeVisible();
  await expect(page.locator('form button[type="submit"]')).toBeEnabled();

  expect(writes).toEqual([]);
});
