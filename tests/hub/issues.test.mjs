import { beforeEach, describe, expect, test } from 'vitest';
import { createGitHubApi, sanitizeError, syncIssues } from '../../scripts/issues.mjs';

const CARD = { id: 'CLT-WEB-001', title: 'Form', line: 'web', priority: 'critical' };
const RUN_1 = 'https://github.test/o/r/actions/runs/1/attempts/1';
const RUN_2 = 'https://github.test/o/r/actions/runs/2/attempts/1';

function fakeApi() {
  const issues = [];
  const labels = new Set();
  return {
    issues,
    labels,
    listOpenIssues: async () => issues.filter((issue) => issue.state === 'open'),
    listComments: async (number) => issues.find((issue) => issue.number === number).comments,
    createIssue: async (issue) => {
      issues.push({ ...issue, number: issues.length + 1, state: 'open', comments: [] });
    },
    comment: async (number, body) => {
      issues.find((issue) => issue.number === number).comments.push({ body });
    },
    closeIssue: async (number) => {
      issues.find((issue) => issue.number === number).state = 'closed';
    },
    addLabels: async (number, added) => {
      const issue = issues.find((item) => item.number === number);
      issue.labels = [...new Set([...issue.labels, ...added])];
    },
    ensureLabel: async (label) => labels.add(label),
  };
}

const results = (status, errors = ['boom']) => new Map([[CARD.id, { status, errors }]]);
const sync = (api, map, runUrl = RUN_1) =>
  syncIssues({ api, cards: [CARD], results: map, project: 'celtikci', runUrl });

describe('issue sync', () => {
  let api;
  beforeEach(() => {
    api = fakeApi();
  });

  test('opens one labelled issue for a failed test', async () => {
    const summary = await sync(api, results('failed'));

    expect(summary.opened).toEqual([CARD.id]);
    expect(api.issues).toHaveLength(1);
    expect(api.issues[0].title).toBe('[CLT-WEB-001] Form');
    expect(api.issues[0].body).toContain('<!-- test-hub:CLT-WEB-001 -->');
    expect(api.issues[0].body).toContain(RUN_1);
    expect(api.issues[0].labels).toEqual(['test-hub', 'project:celtikci', 'line:web', 'priority:critical']);
  });

  test('adds a note instead of a new issue when it fails again', async () => {
    await sync(api, results('failed'));
    const summary = await sync(api, results('failed'), RUN_2);

    expect(summary.commented).toEqual([CARD.id]);
    expect(api.issues).toHaveLength(1);
    expect(api.issues[0].comments).toHaveLength(1);
    expect(api.issues[0].comments[0].body).toContain(RUN_2);
  });

  test('does not repeat a note for the same run', async () => {
    await sync(api, results('failed'));
    await sync(api, results('failed'), RUN_2);
    await sync(api, results('failed'), RUN_2);
    await sync(api, results('failed'));

    expect(api.issues[0].comments).toHaveLength(1);
  });

  test('closes the issue when the test passes', async () => {
    await sync(api, results('failed'));
    const summary = await sync(api, results('passed', []), RUN_2);

    expect(summary.closed).toEqual([CARD.id]);
    expect(api.issues[0].state).toBe('closed');
  });

  test('opens a new issue after a closed one fails again', async () => {
    await sync(api, results('failed'));
    await sync(api, results('passed', []), RUN_2);
    await sync(api, results('failed'), 'https://github.test/o/r/actions/runs/3/attempts/1');

    expect(api.issues).toHaveLength(2);
  });

  test('marks flaky tests with a label and keeps them open', async () => {
    await sync(api, results('failed'));
    await sync(api, results('flaky'), RUN_2);

    expect(api.issues[0].state).toBe('open');
    expect(api.issues[0].labels).toContain('flaky');
  });

  test('leaves an open issue alone when the test did not run', async () => {
    await sync(api, results('failed'));
    await sync(api, new Map(), RUN_2);

    expect(api.issues[0].state).toBe('open');
    expect(api.issues[0].comments).toHaveLength(0);
  });

  test('does nothing for a passing test without an issue', async () => {
    await sync(api, results('passed', []));

    expect(api.issues).toHaveLength(0);
  });
});

describe('sanitizeError', () => {
  test('removes ANSI codes, mentions, fences and tokens', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    const clean = sanitizeError(`\x1b[31mfailed\x1b[0m @someone \`\`\` ${token}`);

    expect(clean).not.toContain('\x1b');
    expect(clean).not.toContain('@someone');
    expect(clean).not.toContain('```');
    expect(clean).not.toContain(token);
    expect(clean).toContain('[redacted]');
  });

  test('limits long errors', () => {
    expect(sanitizeError('x'.repeat(5000))).toHaveLength(3000);
  });
});

describe('GitHub API client', () => {
  test('follows pagination and skips pull requests', async () => {
    const pages = {
      'https://api.test/repos/o/r/issues?state=open&per_page=100&labels=test-hub': {
        items: [{ number: 1 }, { number: 2, pull_request: {} }],
        link: '<https://api.test/page2>; rel="next"',
      },
      'https://api.test/page2': { items: [{ number: 3 }], link: null },
    };
    const fetchImpl = async (url) => ({
      ok: true,
      status: 200,
      json: async () => pages[url].items,
      headers: { get: () => pages[url].link },
    });
    const api = createGitHubApi({ repo: 'o/r', token: 't', baseUrl: 'https://api.test', fetchImpl });

    const issues = await api.listOpenIssues('test-hub');

    expect(issues.map((issue) => issue.number)).toEqual([1, 3]);
  });

  test('treats an existing label as success', async () => {
    const fetchImpl = async () => ({ ok: false, status: 422 });
    const api = createGitHubApi({ repo: 'o/r', token: 't', baseUrl: 'https://api.test', fetchImpl });

    await expect(api.ensureLabel('test-hub')).resolves.toBeUndefined();
  });
});
