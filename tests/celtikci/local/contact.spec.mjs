import { test, expect } from '@playwright/test';

const SUCCESS_TEXT = 'Mesajınız gönderildi';

// Every contact API call is answered here, so no email can be sent.
async function interceptContactApi(page) {
  const requests = [];
  await page.route('**/api/contact', async (route) => {
    requests.push(route.request());
    await route.fulfill({ status: 200, json: { success: true } });
  });
  return requests;
}

const isValid = (locator) => locator.evaluate((element) => element.checkValidity());

test('CLT-WEB-001 contact form submits entered data', async ({ page }) => {
  const requests = await interceptContactApi(page);
  const input = {
    name: 'Test Kullanıcı',
    email: 'test@example.com',
    message: 'Otomatik test mesajı.',
  };

  await page.goto('/');
  await page.locator('main a[href="/iletisim"]').click();
  await expect(page).toHaveURL(/\/iletisim$/);

  await page.locator('#name').fill(input.name);
  await page.locator('#email').fill(input.email);
  await page.locator('#message').fill(input.message);
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText(SUCCESS_TEXT)).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].method()).toBe('POST');
  expect(requests[0].postDataJSON()).toEqual({ ...input, phone: '', website: '' });
  await expect(page.locator('#name')).toHaveValue('');
});

test('CLT-WEB-003 contact form rejects invalid input', async ({ page }) => {
  const requests = await interceptContactApi(page);
  const submit = page.locator('form button[type="submit"]');

  await page.goto('/iletisim');

  await submit.click();
  expect(await isValid(page.locator('#name'))).toBe(false);
  expect(await isValid(page.locator('#email'))).toBe(false);
  expect(await isValid(page.locator('#message'))).toBe(false);

  await page.locator('#name').fill('Test Kullanıcı');
  await page.locator('#email').fill('gecersiz-adres');
  await page.locator('#message').fill('Otomatik test mesajı.');
  await submit.click();
  expect(await isValid(page.locator('#email'))).toBe(false);

  await expect(page.getByText(SUCCESS_TEXT)).toHaveCount(0);
  expect(requests).toHaveLength(0);
});
