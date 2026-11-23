import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /\b(?:CLT|SND|TRK|MLK|OPT|BAL)-(?:WEB|MOB)-\d{3}\b/g;
const SEVERITY = ['skipped', 'passed', 'flaky', 'failed'];
const PLAYWRIGHT_OUTCOME = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

function readCard(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`Missing frontmatter: ${file}`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  if (!fields.id) throw new Error(`Missing id: ${file}`);
  return { ...fields, file };
}

export function readCards(project) {
  if (!/^[a-z0-9-]+$/.test(project)) throw new Error(`Invalid project: ${project}`);
  const catalogDir = path.join('catalog', project);
  return fs
    .readdirSync(catalogDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => readCard(path.join(catalogDir, name)));
}

function record(results, title, status, errors) {
  for (const id of title.match(ID_RE) ?? []) {
    const current = results.get(id);
    if (!current) {
      results.set(id, { status, errors: [...errors] });
      continue;
    }
    if (SEVERITY.indexOf(status) > SEVERITY.indexOf(current.status)) current.status = status;
    current.errors.push(...errors);
  }
}

export function collectPlaywright(suite, results = new Map()) {
  for (const spec of suite.specs ?? []) {
    for (const run of spec.tests ?? []) {
      const status = PLAYWRIGHT_OUTCOME[run.status] ?? 'failed';
      const errors = (run.results ?? [])
        .flatMap((result) => result.errors ?? [])
        .map((error) => error.message)
        .filter(Boolean);
      record(results, spec.title, status, errors);
    }
  }
  for (const child of suite.suites ?? []) collectPlaywright(child, results);
  return results;
}

export function collectVitest(report, results = new Map()) {
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const status = ['passed', 'failed'].includes(assertion.status) ? assertion.status : 'skipped';
      record(results, assertion.title, status, assertion.failureMessages ?? []);
    }
  }
  return results;
}

export function loadResults({ playwright, unit }) {
  const results = new Map();
  let found = false;
  if (playwright && fs.existsSync(playwright)) {
    collectPlaywright(JSON.parse(fs.readFileSync(playwright, 'utf8')), results);
    found = true;
  }
  if (unit && fs.existsSync(unit)) {
    collectVitest(JSON.parse(fs.readFileSync(unit, 'utf8')), results);
    found = true;
  }
  return { results, found };
}
