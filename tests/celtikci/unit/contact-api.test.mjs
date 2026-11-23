import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import handler from '@target/api/contact.js';
import { createTransport, sendMail } from '../mocks/nodemailer.mjs';

const VALID_BODY = {
  name: 'Test Kullanıcı',
  email: 'visitor@example.test',
  phone: '+90 500 000 00 00',
  message: 'Otomatik test mesajı.',
  website: '',
};

async function call({ method = 'POST', body = VALID_BODY } = {}) {
  const res = {
    statusCode: undefined,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
  await handler({ method, body }, res);
  return res;
}

describe('contact API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'test' });
    vi.stubEnv('SMTP_HOST', 'smtp.example.test');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_SECURE', 'true');
    vi.stubEnv('SMTP_USER', 'site@example.test');
    vi.stubEnv('SMTP_PASS', 'not-a-real-password');
    vi.stubEnv('CONTACT_TO', 'inbox@example.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('CLT-WEB-005 valid message sends one email', async () => {
    const res = await call();

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ success: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.test', port: 465, secure: true }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('inbox@example.test');
    expect(mail.from).toContain('site@example.test');
    expect(mail.replyTo).toContain(VALID_BODY.email);
    expect(mail.subject).toContain(VALID_BODY.name);
    for (const value of [VALID_BODY.name, VALID_BODY.email, VALID_BODY.phone, VALID_BODY.message]) {
      expect(mail.text).toContain(value);
    }
  });

  test('CLT-WEB-006 honeypot returns success without email', async () => {
    const res = await call({ body: { ...VALID_BODY, website: 'https://spam.example.test' } });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ success: true });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test.each([
    ['GET request', { method: 'GET' }, 405],
    ['missing name', { body: { ...VALID_BODY, name: '   ' } }, 422],
    ['invalid email', { body: { ...VALID_BODY, email: 'gecersiz-adres' } }, 422],
    ['missing message', { body: { ...VALID_BODY, message: '' } }, 422],
    ['empty body', { body: undefined, emptyBody: true }, 422],
  ])('CLT-WEB-007 rejects %s', async (_name, request, expectedStatus) => {
    const res = await call(request.emptyBody ? { body: {} } : request);

    expect(res.statusCode).toBe(expectedStatus);
    expect(res.payload.success).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('CLT-WEB-008 SMTP failure returns a safe error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMail.mockRejectedValue(new Error('auth failed for not-a-real-password at smtp.example.test'));

    const res = await call();

    expect(res.statusCode).toBe(500);
    expect(res.payload.success).toBe(false);
    expect(JSON.stringify(res.payload)).not.toMatch(/not-a-real-password|smtp\.example\.test|auth failed/);
    expect(consoleError).toHaveBeenCalled();
  });
});
