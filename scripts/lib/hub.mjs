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
  return { ...fields, file, sections: cardSections(text.slice(match[0].length)) };
}

// "## Heading" blocks of the card body, e.g. { Amaç: '...', Beklenen: '...' }.
export function cardSections(body) {
  const sections = {};
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      sections[current] = [];
    } else if (current) sections[current].push(line);
  }
  return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()]));
}

// Cards come from test-hub's catalog, or from the project repository when given.
export function readCards(project, dir) {
  if (!/^[a-z0-9-]+$/.test(project)) throw new Error(`Invalid project: ${project}`);
  const catalogDir = dir || path.join('catalog', project);
  if (!fs.existsSync(catalogDir)) return [];
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

// Vitest and Jest write the same JSON shape. The ID may sit in the test title
// or in an enclosing describe(), so match against the full name.
export function collectVitest(report, results = new Map()) {
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const status = ['passed', 'failed'].includes(assertion.status) ? assertion.status : 'skipped';
      const name = assertion.fullName || [...(assertion.ancestorTitles ?? []), assertion.title].join(' ');
      record(results, name, status, assertion.failureMessages ?? []);
    }
  }
  return results;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return ENTITIES[code] ?? entity;
  });
}

function xmlAttributes(source) {
  const attributes = {};
  for (const [, name, double, single] of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[name] = decodeXml(double ?? single);
  }
  return attributes;
}

// JUnit XML, e.g. from `node --test --test-reporter=junit`. Nested <testsuite>
// names play the role of describe() blocks, so the ID may sit in any of them.
const XML_TAG_RE = /<(\/?)(testsuite|testcase|failure|error|skipped)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
export function collectJunit(xml, results = new Map()) {
  const suites = [];
  let testcase = null;
  let failure = null;
  const finish = () => {
    const status = testcase.errors.length || testcase.failed ? 'failed' : testcase.skipped ? 'skipped' : 'passed';
    record(results, testcase.name, status, testcase.errors);
    testcase = null;
  };
  for (const match of xml.matchAll(XML_TAG_RE)) {
    const [, closing, tag, attributeSource, selfClosing] = match;
    const end = match.index + match[0].length;
    if (closing) {
      if (tag === 'testsuite') suites.pop();
      else if (tag === 'testcase' && testcase) finish();
      else if (failure && testcase) {
        const body = decodeXml(xml.slice(failure.start, match.index)).trim();
        const message = body || failure.message;
        if (message) testcase.errors.push(message);
        else testcase.failed = true;
        failure = null;
      }
      continue;
    }
    const attributes = xmlAttributes(attributeSource);
    if (tag === 'testsuite') {
      if (!selfClosing) suites.push(attributes.name ?? '');
    } else if (tag === 'testcase') {
      const name = [...suites, attributes.classname, attributes.name].filter(Boolean).join(' ');
      testcase = { name, errors: [], failed: false, skipped: false };
      if (selfClosing) finish();
    } else if (testcase && tag === 'skipped') {
      testcase.skipped = true;
    } else if (testcase) {
      if (selfClosing) {
        if (attributes.message) testcase.errors.push(attributes.message);
        else testcase.failed = true;
      } else {
        failure = { start: end, message: attributes.message ?? '' };
      }
    }
  }
  return results;
}

// Result files ending in .xml are JUnit; everything else is Jest/Vitest JSON.
export function loadResults({ playwright, unit }) {
  const results = new Map();
  let found = false;
  if (playwright && fs.existsSync(playwright)) {
    collectPlaywright(JSON.parse(fs.readFileSync(playwright, 'utf8')), results);
    found = true;
  }
  for (const file of [unit].flat().filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (file.toLowerCase().endsWith('.xml')) collectJunit(text, results);
    else collectVitest(JSON.parse(text), results);
    found = true;
  }
  return { results, found };
}

// Cards that only run on a real device (Maestro) never run in CI. They are
// listed apart so they do not look like missing tests.
const DEVICE_ENVS = new Set(['e2e-device']);
export const isDeviceCard = (card) => DEVICE_ENVS.has(card.env);

export function buildReport({ project, cards, results }) {
  const rows = cards.map((card) => {
    const result = results.get(card.id);
    return { ...card, ran: Boolean(result), current: result?.status ?? card.status };
  });
  const cardIds = new Set(cards.map((card) => card.id));
  const orphans = [...results.keys()].filter((id) => !cardIds.has(id)).sort();
  const criticalFailed = rows.filter((row) => row.priority === 'critical' && row.current === 'failed');
  const device = rows.filter((row) => !row.ran && isDeviceCard(row));
  const main = rows.filter((row) => !device.includes(row));

  const table = (items, header, cell) => [
    `| ID | Title | Priority | Status | ${header} |`,
    '| --- | --- | --- | --- | --- |',
    ...items.map((r) => `| ${r.id} | ${r.title} | ${r.priority} | ${r.current} | ${cell(r)} |`),
  ];
  const lines = [`# Test report: ${project}`, '', ...table(main, 'Ran', (r) => (r.ran ? 'yes' : 'no'))];
  if (device.length) {
    lines.push(
      '',
      '## On device (local)',
      '',
      'Maestro flows run on a phone, not in CI. Status and date come from the last local run recorded in the card.',
      '',
      ...table(device, 'Last run', (r) => r.last_run || 'never'),
    );
  }
  const counts = [`Cards: ${rows.length}`, `ran: ${rows.filter((r) => r.ran).length}`];
  if (device.length) counts.push(`on device (local): ${device.length}`);
  counts.push(`critical failures: ${criticalFailed.length}`);
  lines.push('', counts.join(' · '));
  if (orphans.length) lines.push('', `Tests without a card: ${orphans.join(', ')}`);
  return { rows, orphans, criticalFailed, summary: `${lines.join('\n')}\n` };
}

// Writes a local device run into the cards: `status` and `last_run` (YYYY-MM-DD)
// in the frontmatter. Only device cards are touched; the rest run in CI.
export function setCardFields(text, fields) {
  const match = text.match(/^---(\r?\n)([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('Missing frontmatter');
  const eol = match[1];
  const lines = match[2].split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index >= 0) lines[index] = `${key}: ${value}`;
    else {
      const status = lines.findIndex((line) => line.startsWith('status:'));
      lines.splice(status >= 0 ? status + 1 : lines.length, 0, `${key}: ${value}`);
    }
  }
  return `---${eol}${lines.join(eol)}${eol}---${text.slice(match[0].length)}`;
}

export function recordDeviceRun({ cards, results, date }) {
  const updated = [];
  const ignored = [];
  for (const [id, result] of results) {
    const card = cards.find((item) => item.id === id);
    if (!card || !isDeviceCard(card)) {
      ignored.push(id);
      continue;
    }
    const text = fs.readFileSync(card.file, 'utf8');
    const next = setCardFields(text, { status: result.status, last_run: date });
    if (next !== text) fs.writeFileSync(card.file, next);
    updated.push({ id, status: result.status });
  }
  return { updated, ignored: ignored.sort() };
}
