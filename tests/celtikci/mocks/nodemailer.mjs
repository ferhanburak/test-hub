import { vi } from 'vitest';

export const sendMail = vi.fn();
export const createTransport = vi.fn(() => ({ sendMail }));

export default { createTransport };
