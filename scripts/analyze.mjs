#!/usr/bin/env node
// Static analysis of a project: writes facts.json and static.md, the input for
// the /analyze command. Reads only files tracked by git (.env stays out) and
// collects environment variable names, never values.
// Usage: node scripts/analyze.mjs --target ../carfollow [--out ../carfollow/docs/analysis]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeProject, renderFacts } from './lib/analyze.mjs';

const { values: args } = parseArgs({
  options: {
    target: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!args.target || !fs.existsSync(path.join(args.target, '.'))) {
  console.error('Usage: node scripts/analyze.mjs --target <project folder> [--out <folder>]');
  process.exit(2);
}

const out = args.out || path.join(args.target, 'docs', 'analysis');
const facts = analyzeProject(args.target);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
fs.writeFileSync(path.join(out, 'static.md'), renderFacts(facts));

console.log(`Analysed ${facts.files} files in ${facts.project}.`);
console.log(`Packages: ${facts.packages.length} · routes: ${facts.routes.length} · env names: ${facts.env.length}`);
console.log(`Written: ${path.join(out, 'facts.json')}, ${path.join(out, 'static.md')}`);
