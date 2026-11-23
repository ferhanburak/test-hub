#!/usr/bin/env node
// Matches catalog cards with Playwright JSON results.
// Usage: node scripts/report.mjs --project celtikci [--results path] [--out path] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const ID_RE = /\b(?:CLT|SND|TRK|MLK|OPT|BAL)-(?:WEB|MOB)-\d{3}\b/g;
const SEVERITY = ['skipped', 'passed', 'flaky', 'failed'];
const OUTCOME = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

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

function collectResults(suite, results = new Map()) {
  for (const spec of suite.specs ?? []) {
    const ids = spec.title.match(ID_RE) ?? [];
    for (const id of ids) {
      for (const run of spec.tests ?? []) {
        const status = OUTCOME[run.status] ?? 'failed';
        const current = results.get(id);
        if (!current || SEVERITY.indexOf(status) > SEVERITY.indexOf(current)) results.set(id, status);
      }
    }
  }
  for (const child of suite.suites ?? []) collectResults(child, results);
  return results;
}

function collectVitest(report, results) {
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const status = assertion.status === 'passed' ? 'passed' : assertion.status === 'failed' ? 'failed' : 'skipped';
      for (const id of assertion.title.match(ID_RE) ?? []) {
        const current = results.get(id);
        if (!current || SEVERITY.indexOf(status) > SEVERITY.indexOf(current)) results.set(id, status);
      }
    }
  }
  return results;
}

const { values: args } = parseArgs({
  options: {
    project: { type: 'string', default: 'celtikci' },
    results: { type: 'string', default: 'reports/results.json' },
    unit: { type: 'string', default: 'reports/unit.json' },
    out: { type: 'string', default: 'reports/summary.md' },
    write: { type: 'boolean', default: false },
  },
});

if (!/^[a-z0-9-]+$/.test(args.project)) throw new Error(`Invalid project: ${args.project}`);
const catalogDir = path.join('catalog', args.project);
const cards = fs
  .readdirSync(catalogDir)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => readCard(path.join(catalogDir, name)));

if (!fs.existsSync(args.results) && !fs.existsSync(args.unit)) {
  console.error(`Results not found: ${args.results}, ${args.unit}`);
  process.exit(2);
}
const results = new Map();
if (fs.existsSync(args.results)) collectResults(JSON.parse(fs.readFileSync(args.results, 'utf8')), results);
if (fs.existsSync(args.unit)) collectVitest(JSON.parse(fs.readFileSync(args.unit, 'utf8')), results);

const rows = cards.map((card) => {
  const result = results.get(card.id);
  return { ...card, ran: Boolean(result), current: result ?? card.status };
});
const cardIds = new Set(cards.map((card) => card.id));
const orphans = [...results.keys()].filter((id) => !cardIds.has(id)).sort();
const criticalFailed = rows.filter((row) => row.priority === 'critical' && row.current === 'failed');

const lines = [
  `# Test report: ${args.project}`,
  '',
  '| ID | Title | Priority | Status | Ran |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.priority} | ${r.current} | ${r.ran ? 'yes' : 'no'} |`),
  '',
  `Cards: ${rows.length} · ran: ${rows.filter((r) => r.ran).length} · critical failures: ${criticalFailed.length}`,
];
if (orphans.length) lines.push('', `Tests without a card: ${orphans.join(', ')}`);
const summary = `${lines.join('\n')}\n`;

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);

if (args.write) {
  for (const row of rows.filter((r) => r.ran && r.current !== r.status)) {
    const text = fs.readFileSync(row.file, 'utf8');
    fs.writeFileSync(row.file, text.replace(/^status:.*$/m, `status: ${row.current}`));
  }
}

process.exit(criticalFailed.length || orphans.length ? 1 : 0);
