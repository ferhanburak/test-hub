// GitHub is the source of truth: cards come from the catalog, failures from
// open test-hub issues, and the overall state from the latest workflow run.
// Plain JavaScript without dependencies, so tests/hub can import it.

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const ISSUE_MARKER_RE = /<!-- test-hub:([A-Z]+-[A-Z]+-\d{3}) -->/;
const DEVICE_ENVS = new Set(['e2e-device']);

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createClient({ token, fetchImpl = (...args) => fetch(...args) } = {}) {
  const headers = (accept) => ({
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const request = async (url, accept = 'application/vnd.github+json') => {
    const response = await fetchImpl(url, { headers: url.startsWith(API) ? headers(accept) : {} });
    if (response.status === 404) return null;
    if (!response.ok) {
      const limited = response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0';
      throw new GitHubError(limited ? 'GitHub istek sınırı doldu' : `GitHub ${response.status}`, response.status);
    }
    return accept.endsWith('raw') || !url.startsWith(API) ? response.text() : response.json();
  };
  const send = async (path, body) => {
    const response = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: { ...headers('application/vnd.github+json'), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const reason =
        response.status === 401 ? 'Token geçersiz' : response.status === 403 || response.status === 404 ? "Token'ın bu repoda yazma izni yok" : `GitHub ${response.status}`;
      throw new GitHubError(reason, response.status);
    }
    return response.json();
  };
  return {
    authenticated: Boolean(token),
    json: (path) => request(`${API}${path}`),
    post: send,
    // Raw file text: through the API with a token (private repos), else from raw.githubusercontent.com.
    file: (repo, ref, path) =>
      token
        ? request(`${API}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, 'application/vnd.github.raw')
        : request(`${RAW}/${repo}/${encodeURIComponent(ref)}/${encodePath(path)}`),
  };
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

export function parseCard(text, file = '') {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields.id ? { ...fields, file } : null;
}

export function issueCardId(issue) {
  return issue.body?.match(ISSUE_MARKER_RE)?.[1] ?? null;
}

// Combines cards, open issues and runs into what the screens show.
export function summarize({ project, cards, issues, runs }) {
  const issueById = new Map();
  for (const issue of issues) {
    const id = issueCardId(issue);
    if (id && !issueById.has(id)) issueById.set(id, issue);
  }
  const rows = cards
    .map((card) => {
      const issue = issueById.get(card.id) ?? null;
      const flaky = issue?.labels?.some((label) => (label.name ?? label) === 'flaky');
      const status = issue ? (flaky ? 'flaky' : 'failed') : card.status || 'not-written';
      return { ...card, status, cardStatus: card.status, issue, device: DEVICE_ENVS.has(card.env) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const mainRuns = runs.filter((run) => run.event !== 'pull_request');
  const lastRun = mainRuns[0] ?? runs[0] ?? null;
  const criticalFailures = rows.filter((row) => row.priority === 'critical' && row.status === 'failed');
  const orphanIssues = issues.filter((issue) => {
    const id = issueCardId(issue);
    return !id || !cards.some((card) => card.id === id);
  });
  let health = 'unknown';
  if (lastRun?.conclusion === 'failure' || criticalFailures.length) health = 'failing';
  else if (issueById.size) health = 'warning';
  else if (lastRun?.conclusion === 'success') health = 'passing';
  return {
    project,
    rows,
    counts,
    lastRun,
    recentRuns: mainRuns.slice(0, 10),
    openIssues: issues.length,
    criticalFailures,
    orphanIssues,
    deviceCards: rows.filter((row) => row.device).length,
    health,
  };
}

export async function loadProject(client, project) {
  if (project.connected === false) return { project, notConnected: true };
  const repo = await client.json(`/repos/${project.repo}`);
  if (!repo) return { project, needsToken: !client.authenticated, missing: client.authenticated };

  const [runsPage, issues, catalogRepo] = await Promise.all([
    client.json(`/repos/${project.repo}/actions/workflows/test-hub.yml/runs?per_page=20`),
    client.json(`/repos/${project.repo}/issues?state=open&labels=test-hub&per_page=100`),
    project.catalog.repo === project.repo ? repo : client.json(`/repos/${project.catalog.repo}`),
  ]);
  const ref = catalogRepo?.default_branch ?? 'main';
  const listing = (await client.json(`/repos/${project.catalog.repo}/contents/${encodePath(project.catalog.path)}?ref=${ref}`)) ?? [];
  const files = listing.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'));
  const texts = await Promise.all(files.map((entry) => client.file(project.catalog.repo, ref, entry.path)));
  const cards = texts.map((text, index) => text && parseCard(text, files[index].path)).filter(Boolean);

  return summarize({
    project: { ...project, defaultBranch: repo.default_branch, private: repo.private, url: repo.html_url },
    cards,
    issues: (issues ?? []).filter((issue) => !issue.pull_request),
    runs: runsPage?.workflow_runs ?? [],
  });
}

// A note from the panel is a comment on the test's issue; GitHub stays the source.
export async function addNote(client, repo, issueNumber, text) {
  const body = text.trim();
  if (!client.authenticated) throw new GitHubError('Not yazmak için token gerekli', 401);
  if (!body) throw new GitHubError('Not boş olamaz', 400);
  return client.post(`/repos/${repo}/issues/${issueNumber}/comments`, { body: `${body}\n\n_test-hub panelinden_` });
}

const DAY = 24 * 60 * 60 * 1000;
export const DEVICE_RUN_MAX_DAYS = 7;

// Release readiness from what the panel already knows. Blockers stop a release,
// warnings need a look. Mirrors the design: a failing critical test stops it.
export function releaseReadiness(summary, now = new Date()) {
  const blockers = [];
  const warnings = [];
  const passes = [];
  const rows = summary.rows ?? [];
  const run = summary.lastRun;

  if (!run) blockers.push('Ana dalda hiç test-hub koşusu yok.');
  else if (run.conclusion === 'success') passes.push('Son ana dal koşusu başarılı.');
  else if (run.status !== 'completed') warnings.push('Son koşu hâlâ sürüyor.');
  else blockers.push(`Son ana dal koşusu başarısız (${run.conclusion}).`);

  const critical = rows.filter((row) => row.priority === 'critical');
  const criticalFailed = critical.filter((row) => row.status === 'failed');
  if (criticalFailed.length) blockers.push(`Kalan kritik test: ${criticalFailed.map((row) => row.id).join(', ')}.`);
  else if (critical.length) passes.push(`${critical.length} kritik testin hiçbiri kalmıyor.`);

  const criticalMissing = critical.filter((row) => row.status === 'not-written');
  if (criticalMissing.length) warnings.push(`Yazılmamış kritik test: ${criticalMissing.map((row) => row.id).join(', ')}.`);

  const otherFailed = rows.filter((row) => row.priority !== 'critical' && row.status === 'failed');
  if (otherFailed.length) warnings.push(`Kalan diğer test: ${otherFailed.map((row) => row.id).join(', ')}.`);
  const flaky = rows.filter((row) => row.status === 'flaky');
  if (flaky.length) warnings.push(`Kararsız test: ${flaky.map((row) => row.id).join(', ')}.`);

  const device = rows.filter((row) => row.device);
  if (device.length) {
    const dates = device.map((row) => (row.last_run ? new Date(`${row.last_run}T00:00:00`) : null));
    const never = device.filter((_, index) => !dates[index]);
    const oldest = dates.filter(Boolean).sort((a, b) => a - b)[0];
    const age = oldest ? Math.floor((now - oldest) / DAY) : null;
    if (never.length) warnings.push(`Cihazda hiç koşmamış test: ${never.map((row) => row.id).join(', ')}.`);
    else if (age > DEVICE_RUN_MAX_DAYS) warnings.push(`Cihaz testleri ${age} gün önce koştu; release öncesi telefonda yeniden koştur.`);
    else passes.push(`Cihaz testleri ${age === 0 ? 'bugün' : `${age} gün önce`} koştu.`);
  }

  const verdict = blockers.length ? 'blocked' : warnings.length ? 'warnings' : 'ready';
  return { verdict, blockers, warnings, passes };
}
