#!/usr/bin/env node
// Records a local device run (e.g. Maestro JUnit) in the project's cards, so the
// CI report can show the last result and its date. Run it after the flows, then
// commit the changed cards.
// Usage: node scripts/device-results.mjs --catalog <project>/tests/catalog --junit <project>/mobile/test-results/test-hub-maestro.xml [--date YYYY-MM-DD]
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { collectJunit, readCards, recordDeviceRun } from './lib/hub.mjs';

const { values: args } = parseArgs({
  options: {
    catalog: { type: 'string' },
    junit: { type: 'string' },
    date: { type: 'string' },
  },
});
if (!args.catalog || !args.junit) {
  console.error('Usage: node scripts/device-results.mjs --catalog <dir> --junit <file.xml> [--date YYYY-MM-DD]');
  process.exit(2);
}
if (!fs.existsSync(args.junit)) {
  console.error(`Results not found: ${args.junit}`);
  process.exit(2);
}
if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
  console.error(`Invalid date: ${args.date}`);
  process.exit(2);
}

// The run date is the day the results file was written, in local time.
const written = fs.statSync(args.junit).mtime;
const pad = (n) => String(n).padStart(2, '0');
const date = args.date || `${written.getFullYear()}-${pad(written.getMonth() + 1)}-${pad(written.getDate())}`;

const results = collectJunit(fs.readFileSync(args.junit, 'utf8'));
const cards = readCards('device', args.catalog);
const { updated, ignored } = recordDeviceRun({ cards, results, date });

for (const { id, status } of updated) console.log(`${id}: ${status}`);
console.log(`Recorded ${updated.length} device cards (last_run: ${date}).`);
if (ignored.length) console.log(`Not device cards, skipped: ${ignored.join(', ')}`);
process.exit(updated.some((item) => item.status === 'failed') ? 1 : 0);
