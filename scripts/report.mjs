#!/usr/bin/env node
// Matches catalog cards with test results (Playwright, Jest/Vitest JSON, JUnit XML).
// Usage: node scripts/report.mjs --project celtikci [--results path] [--unit path]
//        [--catalog dir] [--out path] [--doc path] [--write]
// --doc writes the full test document: summary, tests to fix, every card with
// its expected behaviour and result.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildReport, loadResults, readCards } from './lib/hub.mjs';
import { renderTestDocument } from './lib/document.mjs';

const { values: args } = parseArgs({
  options: {
    project: { type: 'string', default: 'celtikci' },
    results: { type: 'string', default: 'reports/results.json' },
    unit: { type: 'string', multiple: true, default: ['reports/unit.json'] },
    catalog: { type: 'string' },
    out: { type: 'string', default: 'reports/summary.md' },
    doc: { type: 'string' },
    write: { type: 'boolean', default: false },
  },
});

const cards = readCards(args.project, args.catalog);
const { results, found } = loadResults({ playwright: args.results, unit: args.unit });
if (!found) {
  console.error(`Results not found: ${[args.results, ...args.unit].join(', ')}`);
  process.exit(2);
}

const { rows, orphans, criticalFailed, summary } = buildReport({ project: args.project, cards, results });

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);

if (args.doc) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
  const meta = {
    date: new Date().toISOString().slice(0, 10),
    commit: GITHUB_SHA,
    runUrl: GITHUB_REPOSITORY && GITHUB_RUN_ID ? `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined,
  };
  fs.mkdirSync(path.dirname(args.doc), { recursive: true });
  fs.writeFileSync(args.doc, renderTestDocument({ project: args.project, rows, results, orphans, meta }));
  console.log(`Test document: ${args.doc}`);
}

if (args.write) {
  for (const row of rows.filter((r) => r.ran && r.current !== r.status)) {
    const text = fs.readFileSync(row.file, 'utf8');
    fs.writeFileSync(row.file, text.replace(/^status:.*$/m, `status: ${row.current}`));
  }
}

process.exit(criticalFailed.length || orphans.length ? 1 : 0);
