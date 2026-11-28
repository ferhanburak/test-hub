import { describe, expect, test } from 'vitest';
import { createClient, loadProject, parseCard, summarize } from '../../ui/src/lib/data.js';

const card = (id, extra = {}) => ({ id, title: `T ${id}`, priority: 'normal', status: 'passed', ...extra });
const issue = (id, labels = []) => ({ number: 1, body: `<!-- test-hub:${id} -->\n## ${id}`, labels: labels.map((name) => ({ name })) });

describe('parseCard', () => {
  test('reads frontmatter with CRLF', () => {
    expect(parseCard('---\r\nid: TRK-MOB-001\r\ntitle: A: b\r\nstatus: passed\r\n---\r\nbody', 'x.md')).toEqual({
      id: 'TRK-MOB-001',
      title: 'A: b',
      status: 'passed',
      file: 'x.md',
    });
  });

  test('ignores files without an id', () => {
    expect(parseCard('# README')).toBeNull();
    expect(parseCard('---\ntitle: x\n---\n')).toBeNull();
  });
});

describe('summarize', () => {
  test('marks cards with an open issue as failed or flaky', () => {
    const summary = summarize({
      project: {},
      cards: [card('CLT-WEB-001', { priority: 'critical' }), card('CLT-WEB-002'), card('CLT-WEB-003', { status: '' })],
      issues: [issue('CLT-WEB-001'), issue('CLT-WEB-002', ['flaky']), issue('CLT-WEB-099')],
      runs: [{ event: 'push', conclusion: 'success' }],
    });

    expect(summary.rows.map((row) => [row.id, row.status])).toEqual([
      ['CLT-WEB-001', 'failed'],
      ['CLT-WEB-002', 'flaky'],
      ['CLT-WEB-003', 'not-written'],
    ]);
    expect(summary.counts).toEqual({ failed: 1, flaky: 1, 'not-written': 1 });
    expect(summary.criticalFailures.map((row) => row.id)).toEqual(['CLT-WEB-001']);
    expect(summary.orphanIssues).toHaveLength(1);
    expect(summary.health).toBe('failing');
  });

  test('uses the latest non-PR run and counts device cards', () => {
    const summary = summarize({
      project: {},
      cards: [card('TRK-MOB-038', { env: 'e2e-device' }), card('TRK-MOB-001', { env: 'unit' })],
      issues: [],
      runs: [
        { id: 3, event: 'pull_request', conclusion: 'failure' },
        { id: 2, event: 'push', conclusion: 'success' },
      ],
    });

    expect(summary.lastRun.id).toBe(2);
    expect(summary.recentRuns.map((run) => run.id)).toEqual([2]);
    expect(summary.deviceCards).toBe(1);
    expect(summary.health).toBe('passing');
  });

  test('warns on open non-critical issues and fails on a failed run', () => {
    const base = { project: {}, cards: [card('CLT-WEB-001')] };
    expect(summarize({ ...base, issues: [issue('CLT-WEB-001')], runs: [] }).health).toBe('warning');
    expect(summarize({ ...base, issues: [], runs: [{ event: 'push', conclusion: 'failure' }] }).health).toBe('failing');
    expect(summarize({ ...base, issues: [], runs: [] }).health).toBe('unknown');
  });
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => body, text: async () => body };
  };
  impl.calls = calls;
  return impl;
}

describe('loadProject', () => {
  const project = {
    key: 'demo',
    repo: 'o/demo',
    catalog: { repo: 'o/demo', path: 'tests/catalog' },
  };
  const routes = {
    'https://api.github.com/repos/o/demo': { default_branch: 'main', private: false, html_url: 'https://github.com/o/demo' },
    'https://api.github.com/repos/o/demo/actions/workflows/test-hub.yml/runs?per_page=20': {
      workflow_runs: [{ id: 9, event: 'push', conclusion: 'success' }],
    },
    'https://api.github.com/repos/o/demo/issues?state=open&labels=test-hub&per_page=100': [
      issue('MLK-MOB-002'),
      { number: 5, pull_request: {}, body: '' },
    ],
    'https://api.github.com/repos/o/demo/contents/tests/catalog?ref=main': [
      { type: 'file', name: 'MLK-MOB-001.md', path: 'tests/catalog/MLK-MOB-001.md' },
      { type: 'file', name: 'MLK-MOB-002.md', path: 'tests/catalog/MLK-MOB-002.md' },
      { type: 'file', name: 'README.txt', path: 'tests/catalog/README.txt' },
    ],
    'https://raw.githubusercontent.com/o/demo/main/tests/catalog/MLK-MOB-001.md': '---\nid: MLK-MOB-001\nstatus: passed\n---\n',
    'https://raw.githubusercontent.com/o/demo/main/tests/catalog/MLK-MOB-002.md': '---\nid: MLK-MOB-002\nstatus: passed\n---\n',
  };

  test('reads a public project without a token', async () => {
    const fetchImpl = fakeFetch(routes);
    const summary = await loadProject(createClient({ fetchImpl }), project);

    expect(summary.rows.map((row) => [row.id, row.status])).toEqual([
      ['MLK-MOB-001', 'passed'],
      ['MLK-MOB-002', 'failed'],
    ]);
    expect(summary.openIssues).toBe(1);
    expect(summary.lastRun.id).toBe(9);
    expect(fetchImpl.calls.every((call) => !call.init.headers.Authorization)).toBe(true);
  });

  test('asks for a token when a private repository is hidden', async () => {
    const summary = await loadProject(createClient({ fetchImpl: fakeFetch({}) }), project);
    expect(summary).toEqual({ project, needsToken: true, missing: false });
  });

  test('reads card files through the API with a token', async () => {
    const withToken = { ...routes };
    for (const name of ['MLK-MOB-001', 'MLK-MOB-002']) {
      withToken[`https://api.github.com/repos/o/demo/contents/tests/catalog/${name}.md?ref=main`] =
        routes[`https://raw.githubusercontent.com/o/demo/main/tests/catalog/${name}.md`];
    }
    const fetchImpl = fakeFetch(withToken);
    const summary = await loadProject(createClient({ token: 't', fetchImpl }), project);

    expect(summary.rows).toHaveLength(2);
    const fileCall = fetchImpl.calls.find((call) => call.url.includes('/contents/tests/catalog/MLK-MOB-001.md'));
    expect(fileCall.init.headers.Accept).toBe('application/vnd.github.raw');
    expect(fileCall.init.headers.Authorization).toBe('Bearer t');
  });

  test('skips projects that are not connected yet', async () => {
    const summary = await loadProject(createClient({ fetchImpl: fakeFetch({}) }), { key: 'x', connected: false });
    expect(summary.notConnected).toBe(true);
  });
});
