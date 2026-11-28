#!/usr/bin/env node
// Syncs test results to GitHub Issues: opens on failure, comments on repeat, closes on pass.
// Usage: node scripts/issues.mjs --project celtikci --results path --unit path
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadResults, readCards } from './lib/hub.mjs';

const BASE_LABEL = 'test-hub';
const FLAKY_LABEL = 'flaky';
// Failed tests are work to do in the project; flaky ones need a look first.
const NEEDS_FIX_LABEL = 'needs-fix';
const LABEL_COLORS = { [FLAKY_LABEL]: 'fbca04', [NEEDS_FIX_LABEL]: 'd73a4a' };
const MAX_ERROR_LENGTH = 3000;
const SECRET_RE = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}/g;

const marker = (id) => `<!-- test-hub:${id} -->`;

export function sanitizeError(text) {
  return String(text)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(SECRET_RE, '[redacted]')
    .replace(/```/g, "'''")
    .replace(/@(?=[\w-])/g, '@​')
    .slice(0, MAX_ERROR_LENGTH);
}

function errorBlock(result) {
  const message = result.errors.length ? sanitizeError(result.errors[0]) : 'Hata mesajı yok.';
  return `\`\`\`text\n${message}\n\`\`\``;
}

function issueBody({ id, card, result, runUrl }) {
  return [
    marker(id),
    `## ${id}: ${card?.title ?? 'Kartı olmayan test'}`,
    '',
    `- **Durum:** ${result.status}`,
    `- **Öncelik:** ${card?.priority ?? 'bilinmiyor'}`,
    `- **Koşu:** ${runUrl}`,
    '',
    '### Hata',
    errorBlock(result),
    '',
    'Ekran görüntüsü ve trace, koşunun artifact bölümündedir.',
  ].join('\n');
}

function labelsFor({ card, project, status }) {
  const labels = [BASE_LABEL, `project:${project}`];
  if (card?.line) labels.push(`line:${card.line}`);
  if (card?.priority) labels.push(`priority:${card.priority}`);
  if (status === 'flaky') labels.push(FLAKY_LABEL);
  if (status === 'failed') labels.push(NEEDS_FIX_LABEL);
  return labels;
}

// Issues for failed critical tests are assigned to `assignee` (the repository owner
// in CI), so GitHub Mobile sends a push notification for them.
export async function syncIssues({ api, cards, results, project, runUrl, assignee }) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const openById = new Map();
  for (const issue of await api.listOpenIssues(BASE_LABEL)) {
    const id = issue.body?.match(/<!-- test-hub:([A-Z]+-[A-Z]+-\d{3}) -->/)?.[1];
    if (id && !openById.has(id)) openById.set(id, issue);
  }

  const summary = { opened: [], commented: [], closed: [] };
  const ensured = new Set();
  const ensureLabels = async (labels) => {
    for (const label of labels) {
      if (ensured.has(label)) continue;
      await api.ensureLabel(label);
      ensured.add(label);
    }
  };

  for (const [id, result] of results) {
    const card = cardsById.get(id);
    const issue = openById.get(id);

    if (result.status === 'passed' && issue) {
      await api.comment(issue.number, `Test tekrar geçti, kayıt kapatılıyor.\n\nKoşu: ${runUrl}`);
      await api.closeIssue(issue.number);
      summary.closed.push(id);
      continue;
    }
    if (result.status !== 'failed' && result.status !== 'flaky') continue;

    const labels = labelsFor({ card, project, status: result.status });
    await ensureLabels(labels);

    if (!issue) {
      const newIssue = {
        title: `[${id}] ${card?.title ?? 'Test kaldı'}`,
        body: issueBody({ id, card, result, runUrl }),
        labels,
      };
      const assign = assignee && card?.priority === 'critical' && result.status === 'failed';
      try {
        await api.createIssue(assign ? { ...newIssue, assignees: [assignee] } : newIssue);
      } catch (error) {
        // An owner that cannot be assigned (e.g. an organization) must not block the issue.
        if (!assign || error.status !== 422) throw error;
        await api.createIssue(newIssue);
      }
      summary.opened.push(id);
      continue;
    }

    const alreadyNoted =
      issue.body?.includes(runUrl) ||
      (await api.listComments(issue.number)).some((comment) => comment.body?.includes(runUrl));
    if (alreadyNoted) continue;

    await api.comment(
      issue.number,
      `Test yine ${result.status === 'flaky' ? 'kararsız' : 'kaldı'}.\n\nKoşu: ${runUrl}\n\n${errorBlock(result)}`,
    );
    await api.addLabels(issue.number, [result.status === 'flaky' ? FLAKY_LABEL : NEEDS_FIX_LABEL]);
    summary.commented.push(id);
  }
  return summary;
}

export function createGitHubApi({ repo, token, baseUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const request = async (method, url, body) => {
    const response = await fetchImpl(url.startsWith('http') ? url : `${baseUrl}/repos/${repo}${url}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  };
  const send = async (method, url, body) => {
    const response = await request(method, url, body);
    if (!response.ok) {
      throw Object.assign(new Error(`GitHub API ${method} ${url} failed: ${response.status}`), {
        status: response.status,
      });
    }
    return response.status === 204 ? null : response.json();
  };
  const paginate = async (url) => {
    const items = [];
    let next = url;
    while (next) {
      const response = await request('GET', next);
      if (!response.ok) throw new Error(`GitHub API GET ${next} failed: ${response.status}`);
      items.push(...(await response.json()));
      next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return items;
  };

  return {
    listOpenIssues: async (label) =>
      (await paginate(`/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`)).filter(
        (issue) => !issue.pull_request,
      ),
    listComments: (number) => paginate(`/issues/${number}/comments?per_page=100`),
    createIssue: (issue) => send('POST', '/issues', issue),
    comment: (number, body) => send('POST', `/issues/${number}/comments`, { body }),
    closeIssue: (number) => send('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' }),
    addLabels: (number, labels) => send('POST', `/issues/${number}/labels`, { labels }),
    ensureLabel: async (name) => {
      const response = await request('POST', '/labels', { name, color: LABEL_COLORS[name] ?? 'ededed' });
      if (!response.ok && response.status !== 422) {
        throw new Error(`GitHub API POST /labels failed: ${response.status}`);
      }
    },
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      project: { type: 'string', default: 'celtikci' },
      results: { type: 'string', default: 'reports/results.json' },
      unit: { type: 'string', multiple: true, default: ['reports/unit.json'] },
    catalog: { type: 'string' },
    },
  });
  const {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_REPOSITORY_OWNER,
    GITHUB_SERVER_URL,
    GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT,
    GITHUB_API_URL,
  } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) {
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID are required');
  }

  const { results, found } = loadResults({ playwright: args.results, unit: args.unit });
  if (!found) {
    console.log('No test results found, skipping issue sync.');
    return;
  }

  const server = GITHUB_SERVER_URL || 'https://github.com';
  const runUrl = `${server}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT || 1}`;
  const api = createGitHubApi({
    repo: GITHUB_REPOSITORY,
    token: GITHUB_TOKEN,
    baseUrl: GITHUB_API_URL || 'https://api.github.com',
  });
  const summary = await syncIssues({
    api,
    cards: readCards(args.project, args.catalog),
    results,
    project: args.project,
    runUrl,
    assignee: GITHUB_REPOSITORY_OWNER,
  });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
