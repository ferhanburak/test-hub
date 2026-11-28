import { describe, expect, test } from 'vitest';
import {
  addNote,
  createClient,
  listRepos,
  loadProject,
  parseCard,
  projectFromRepo,
  releaseReadiness,
  startAnalysis,
  summarize,
} from '../../ui/src/lib/data.js';

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

describe('releaseReadiness', () => {
  const now = new Date('2026-11-28T12:00:00');
  const row = (id, extra = {}) => ({ id, priority: 'normal', status: 'passed', device: false, ...extra });
  const ok = { event: 'push', status: 'completed', conclusion: 'success' };

  test('is ready when the last run passed and nothing fails', () => {
    const result = releaseReadiness(
      { lastRun: ok, rows: [row('A', { priority: 'critical' }), row('B', { device: true, last_run: '2026-11-27' })] },
      now,
    );
    expect(result.verdict).toBe('ready');
    expect(result.blockers).toEqual([]);
    expect(result.passes).toContain('Cihaz testleri 1 gün önce koştu.');
  });

  test('blocks on a failed critical test or a failed last run', () => {
    const failedCritical = releaseReadiness({ lastRun: ok, rows: [row('A', { priority: 'critical', status: 'failed' })] }, now);
    expect(failedCritical.verdict).toBe('blocked');
    expect(failedCritical.blockers).toEqual(['Kalan kritik test: A.']);

    const failedRun = releaseReadiness({ lastRun: { ...ok, conclusion: 'failure' }, rows: [] }, now);
    expect(failedRun.blockers).toEqual(['Son ana dal koşusu başarısız (failure).']);
    expect(releaseReadiness({ lastRun: null, rows: [] }, now).verdict).toBe('blocked');
  });

  test('warns on other failures, flaky, unwritten critical and stale device runs', () => {
    const result = releaseReadiness(
      {
        lastRun: ok,
        rows: [
          row('A', { status: 'failed' }),
          row('B', { status: 'flaky' }),
          row('C', { priority: 'critical', status: 'not-written' }),
          row('D', { device: true, last_run: '2026-11-01' }),
        ],
      },
      now,
    );
    expect(result.verdict).toBe('warnings');
    expect(result.warnings).toEqual([
      'Yazılmamış kritik test: C.',
      'Kalan diğer test: A.',
      'Kararsız test: B.',
      'Cihaz testleri 27 gün önce koştu; release öncesi telefonda yeniden koştur.',
    ]);
  });

  test('warns when a device card never ran', () => {
    const result = releaseReadiness({ lastRun: ok, rows: [row('D', { device: true })] }, now);
    expect(result.warnings).toEqual(['Cihazda hiç koşmamış test: D.']);
  });
});

describe('addNote', () => {
  test('posts a comment on the issue with a panel footer', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    };
    await addNote(createClient({ token: 't', fetchImpl }), 'o/r', 7, '  Yarın bakacağım  ');

    expect(calls[0].url).toBe('https://api.github.com/repos/o/r/issues/7/comments');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body)).toEqual({ body: 'Yarın bakacağım\n\n_test-hub panelinden_' });
  });

  test('needs a token and text, and explains missing write access', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403 });
    await expect(addNote(createClient({ fetchImpl }), 'o/r', 7, 'x')).rejects.toThrow('token gerekli');
    await expect(addNote(createClient({ token: 't', fetchImpl }), 'o/r', 7, '  ')).rejects.toThrow('boş olamaz');
    await expect(addNote(createClient({ token: 't', fetchImpl }), 'o/r', 7, 'x')).rejects.toThrow('yazma izni yok');
  });
});

describe('analysis from the panel', () => {
  const recorder = (response = { ok: true, status: 204 }) => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      return typeof response === 'function' ? response(url) : response;
    };
    return { calls, fetchImpl };
  };

  test('starts the analyze workflow on the default branch', async () => {
    const { calls, fetchImpl } = recorder();
    await startAnalysis(createClient({ token: 't', fetchImpl }), { repo: 'o/r', defaultBranch: 'master' }, { focus: ' giriş ve ödeme ', maxCards: 80 });

    expect(calls[0].url).toBe('https://api.github.com/repos/o/r/actions/workflows/test-hub-analyze.yml/dispatches');
    expect(JSON.parse(calls[0].init.body)).toEqual({ ref: 'master', inputs: { focus: 'giriş ve ödeme', 'max-cards': '50' } });
  });

  test('refuses without a token or with unsafe focus text', async () => {
    const { fetchImpl } = recorder();
    await expect(startAnalysis(createClient({ fetchImpl }), { repo: 'o/r' })).rejects.toThrow('token gerekli');
    await expect(startAnalysis(createClient({ token: 't', fetchImpl }), { repo: 'o/r' }, { focus: 'x $(id)' })).rejects.toThrow('Odak');
  });

  test('lists the owner repositories', async () => {
    const { calls, fetchImpl } = recorder({
      ok: true,
      status: 200,
      json: async () => [{ full_name: 'o/a', private: true, pushed_at: '2026-11-28T00:00:00Z' }],
    });
    expect(await listRepos(createClient({ token: 't', fetchImpl }))).toEqual([{ fullName: 'o/a', private: true, pushedAt: '2026-11-28T00:00:00Z' }]);
    expect(calls[0].url).toContain('/user/repos?per_page=100&sort=updated&affiliation=owner');
    expect(await listRepos(createClient({ fetchImpl }))).toEqual([]);
  });

  test('builds a project from a repository with a unique key', () => {
    expect(projectFromRepo('o/My_App', ['my-app'])).toEqual({
      key: 'my-app-2',
      name: 'My_App',
      repo: 'o/My_App',
      line: '',
      catalog: { repo: 'o/My_App', path: 'tests/catalog' },
      added: true,
    });
    expect(() => projectFromRepo('not a repo')).toThrow('Invalid repository');
  });

  test('loadProject reports analysis documents and the analyze workflow', async () => {
    const routes = {
      'https://api.github.com/repos/o/r': { default_branch: 'main', private: false, html_url: 'https://github.com/o/r' },
      'https://api.github.com/repos/o/r/actions/workflows/test-hub-analyze.yml/runs?per_page=5': {
        workflow_runs: [{ id: 4, status: 'completed', conclusion: 'success' }],
      },
      'https://api.github.com/repos/o/r/contents/docs/analysis?ref=main': [
        { name: 'SRS.md' },
        { name: 'TEST-REPORT.md' },
        { name: 'facts.json' },
      ],
    };
    const fetchImpl = async (url) =>
      routes[url] === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => routes[url] };
    const data = await loadProject(createClient({ fetchImpl }), { key: 'r', repo: 'o/r', catalog: { repo: 'o/r', path: 'tests/catalog' } });

    expect(data.analysis.enabled).toBe(true);
    expect(data.analysis.lastRun.id).toBe(4);
    expect(data.analysis.docs).toEqual([
      { name: 'TEST-REPORT.md', url: 'https://github.com/o/r/blob/main/docs/analysis/TEST-REPORT.md' },
      { name: 'SRS.md', url: 'https://github.com/o/r/blob/main/docs/analysis/SRS.md' },
    ]);
  });
});
