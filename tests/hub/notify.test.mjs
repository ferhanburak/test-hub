import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildMessage, notify, selectChanges, sendTelegram } from '../../scripts/notify.mjs';

const CARDS = [
  { id: 'CLT-WEB-001', title: 'Form gönderiliyor', priority: 'critical' },
  { id: 'CLT-WEB-002', title: 'Ana sayfa', priority: 'high' },
  { id: 'CLT-WEB-003', title: 'Canlı smoke', priority: 'critical' },
];
const ENV = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_CHAT_ID: '42',
  GITHUB_REPOSITORY: 'o/r',
  GITHUB_RUN_ID: '7',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: 'abcdef1234567890',
};

function fakeFetch(response = { ok: true, status: 200, json: async () => ({ ok: true }) }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return response;
  };
  impl.calls = calls;
  return impl;
}

describe('selectChanges', () => {
  test('keeps newly failed and fixed critical cards only', () => {
    const results = new Map([
      ['CLT-WEB-001', { status: 'failed', errors: ['Error: expected 200\n    at line 3'] }],
      ['CLT-WEB-002', { status: 'failed', errors: ['boom'] }],
      ['CLT-WEB-003', { status: 'passed', errors: [] }],
    ]);
    const summary = { opened: ['CLT-WEB-001', 'CLT-WEB-002'], commented: [], closed: ['CLT-WEB-003'] };

    expect(selectChanges({ summary, cards: CARDS, results })).toEqual({
      broken: [{ id: 'CLT-WEB-001', title: 'Form gönderiliyor', error: 'Error: expected 200' }],
      fixed: [{ id: 'CLT-WEB-003', title: 'Canlı smoke' }],
    });
  });

  test('ignores repeated failures, flaky tests and tests without a card', () => {
    const results = new Map([
      ['CLT-WEB-001', { status: 'flaky', errors: ['once'] }],
      ['CLT-WEB-003', { status: 'failed', errors: ['again'] }],
      ['CLT-WEB-099', { status: 'failed', errors: ['orphan'] }],
    ]);
    const summary = { opened: ['CLT-WEB-001', 'CLT-WEB-099'], commented: ['CLT-WEB-003'], closed: [] };

    expect(selectChanges({ summary, cards: CARDS, results })).toEqual({ broken: [], fixed: [] });
  });

  test('accepts other priorities', () => {
    const results = new Map([['CLT-WEB-002', { status: 'failed', errors: [] }]]);
    const summary = { opened: ['CLT-WEB-002'], closed: [] };

    const { broken } = selectChanges({ summary, cards: CARDS, results, priorities: ['critical', 'high'] });
    expect(broken).toEqual([{ id: 'CLT-WEB-002', title: 'Ana sayfa', error: '' }]);
  });

  test('redacts secrets and shortens long errors', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    const results = new Map([['CLT-WEB-001', { status: 'failed', errors: [`${token} ${'x'.repeat(400)}`] }]]);

    const [item] = selectChanges({ summary: { opened: ['CLT-WEB-001'] }, cards: CARDS, results }).broken;
    expect(item.error).not.toContain(token);
    expect(item.error).toContain('[redacted]');
    expect(item.error.length).toBeLessThanOrEqual(301);
  });
});

describe('buildMessage', () => {
  test('lists broken and fixed tests with the run link', () => {
    const text = buildMessage({
      project: 'celtikci',
      repo: 'o/r',
      branch: 'main',
      sha: 'abcdef1234567890',
      runUrl: 'https://github.com/o/r/actions/runs/7',
      broken: [{ id: 'CLT-WEB-001', title: 'Form', error: 'boom' }],
      fixed: [{ id: 'CLT-WEB-003', title: 'Smoke' }],
    });

    expect(text).toBe(
      [
        '🔴 test-hub: celtikci — 1 kritik test kırıldı',
        'o/r · main · abcdef1',
        '',
        '• CLT-WEB-001 Form',
        '  boom',
        '',
        '🟢 test-hub: celtikci — 1 kritik test düzeldi',
        '• CLT-WEB-003 Smoke',
        '',
        'Koşu: https://github.com/o/r/actions/runs/7',
      ].join('\n'),
    );
  });

  test('stays under the Telegram message limit', () => {
    const broken = Array.from({ length: 200 }, (_, i) => ({ id: `CLT-WEB-${i}`, title: 'x'.repeat(50), error: 'y'.repeat(50) }));
    expect(buildMessage({ project: 'p', broken, fixed: [] }).length).toBeLessThanOrEqual(4000);
  });
});

describe('sendTelegram', () => {
  test('posts plain text to the chat', async () => {
    const fetchImpl = fakeFetch();
    await sendTelegram({ token: '123:abc', chatId: '42', text: 'hi', fetchImpl });

    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(fetchImpl.calls[0].body).toEqual({ chat_id: '42', text: 'hi', disable_web_page_preview: true });
  });

  test('reports failures without the token', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 401, json: async () => ({ description: 'Unauthorized' }) });
    const error = await sendTelegram({ token: '123:secret', chatId: '42', text: 'hi', fetchImpl }).catch((e) => e);

    expect(error.message).toBe('Telegram sendMessage failed: 401 Unauthorized');
    expect(error.message).not.toContain('secret');
  });
});

describe('notify', () => {
  let dir;
  const log = () => {};
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-notify-'));
    fs.mkdirSync(path.join(dir, 'catalog'));
    for (const card of CARDS) {
      fs.writeFileSync(
        path.join(dir, 'catalog', `${card.id}.md`),
        `---\nid: ${card.id}\ntitle: ${card.title}\npriority: ${card.priority}\nstatus: passed\n---\n`,
      );
    }
    fs.writeFileSync(
      path.join(dir, 'unit.json'),
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              { fullName: 'CLT-WEB-001 form', status: 'failed', failureMessages: ['boom'] },
              { fullName: 'CLT-WEB-003 smoke', status: 'passed', failureMessages: [] },
            ],
          },
        ],
      }),
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const args = (summary) => {
    const file = path.join(dir, 'summary.json');
    if (summary) fs.writeFileSync(file, JSON.stringify(summary));
    return { project: 'celtikci', catalog: path.join(dir, 'catalog'), unit: [path.join(dir, 'unit.json')], summary: file, priority: ['critical'] };
  };

  test('does nothing without Telegram secrets', async () => {
    const fetchImpl = fakeFetch();
    const outcome = await notify({ env: {}, args: args({ opened: ['CLT-WEB-001'] }), fetchImpl, log });

    expect(outcome).toBe('skipped');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  test('does nothing without a summary', async () => {
    const fetchImpl = fakeFetch();
    expect(await notify({ env: ENV, args: args(), fetchImpl, log })).toBe('skipped');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  test('stays quiet when no critical test changed state', async () => {
    const fetchImpl = fakeFetch();
    const outcome = await notify({ env: ENV, args: args({ opened: [], commented: ['CLT-WEB-001'], closed: [] }), fetchImpl, log });

    expect(outcome).toBe('quiet');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  test('sends one message for a new critical failure', async () => {
    const fetchImpl = fakeFetch();
    const outcome = await notify({ env: ENV, args: args({ opened: ['CLT-WEB-001'], closed: ['CLT-WEB-003'] }), fetchImpl, log });

    expect(outcome).toBe('sent');
    expect(fetchImpl.calls).toHaveLength(1);
    const { text } = fetchImpl.calls[0].body;
    expect(text).toContain('CLT-WEB-001 Form gönderiliyor');
    expect(text).toContain('  boom');
    expect(text).toContain('CLT-WEB-003 Canlı smoke');
    expect(text).toContain('Koşu: https://github.com/o/r/actions/runs/7');
  });

  test('sends a test message with --ping', async () => {
    const fetchImpl = fakeFetch();
    expect(await notify({ env: ENV, args: { ping: true }, fetchImpl, log })).toBe('sent');
    expect(fetchImpl.calls[0].body.text).toBe('test-hub: Telegram bildirimi çalışıyor.');
  });
});
