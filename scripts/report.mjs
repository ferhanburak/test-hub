#!/usr/bin/env node
// Matches catalog cards with Playwright and Vitest JSON results.
// Usage: node scripts/report.mjs --project celtikci [--results path] [--unit path] [--out path] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadResults, readCards } from './lib/hub.mjs';

const { values: args } = parseArgs({
  options: {
    project: { type: 'string', default: 'celtikci' },
    results: { type: 'string', default: 'reports/results.json' },
    unit: { type: 'string', multiple: true, default: ['reports/unit.json'] },
    catalog: { type: 'string' },
    out: { type: 'string', default: 'reports/summary.md' },
    write: { type: 'boolean', default: false },
  },
});

const cards = readCards(args.project, args.catalog);
const { results, found } = loadResults({ playwright: args.results, unit: args.unit });
if (!found) {
  console.error(`Results not found: ${[args.results, ...args.unit].join(', ')}`);
  process.exit(2);
}

const rows = cards.map((card) => {
  const result = results.get(card.id);
  return { ...card, ran: Boolean(result), current: result?.status ?? card.status };
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
