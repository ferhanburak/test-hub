import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  buildReport,
  collectJunit,
  isDeviceCard,
  loadResults,
  readCards,
  recordDeviceRun,
  setCardFields,
} from '../../scripts/lib/hub.mjs';

let dir;
const vitestReport = (title, status) => ({ testResults: [{ assertionResults: [{ title, status, failureMessages: status === 'failed' ? ['boom'] : [] }] }] });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-lib-'));
  fs.mkdirSync(path.join(dir, 'cards'));
  fs.writeFileSync(path.join(dir, 'cards', 'SND-WEB-001.md'), '---\nid: SND-WEB-001\ntitle: Test\npriority: critical\nstatus: not-written\n---\n');
  fs.writeFileSync(path.join(dir, 'hub.json'), JSON.stringify(vitestReport('CLT-WEB-005 ok', 'passed')));
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(vitestReport('SND-WEB-001 broken', 'failed')));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('hub library', () => {
  test('reads cards from a project directory', () => {
    expect(readCards('soundapp', path.join(dir, 'cards')).map((card) => card.id)).toEqual(['SND-WEB-001']);
  });

  test('returns no cards when the directory is missing', () => {
    expect(readCards('soundapp', path.join(dir, 'missing'))).toEqual([]);
  });

  test('merges several Vitest result files and skips missing ones', () => {
    const { results, found } = loadResults({
      unit: [path.join(dir, 'hub.json'), path.join(dir, 'missing.json'), path.join(dir, 'project.json')],
    });
    expect(found).toBe(true);
    expect(results.get('CLT-WEB-005').status).toBe('passed');
    expect(results.get('SND-WEB-001')).toEqual({ status: 'failed', errors: ['boom'] });
  });

  test('finds IDs in an enclosing describe block (Jest and Vitest full names)', () => {
    const file = path.join(dir, 'jest.json');
    fs.writeFileSync(file, JSON.stringify({
      testResults: [{
        assertionResults: [
          { ancestorTitles: ['TRK-MOB-007 GPS'], title: 'accepts movement', fullName: 'TRK-MOB-007 GPS accepts movement', status: 'passed', failureMessages: [] },
          { ancestorTitles: ['TRK-MOB-007 GPS'], title: 'rejects jumps', fullName: 'TRK-MOB-007 GPS rejects jumps', status: 'failed', failureMessages: ['jump'] },
          { ancestorTitles: ['TRK-MOB-008 zones'], title: 'drops points', status: 'pending', failureMessages: [] },
        ],
      }],
    }));
    const { results } = loadResults({ unit: file });
    expect(results.get('TRK-MOB-007')).toEqual({ status: 'failed', errors: ['jump'] });
    expect(results.get('TRK-MOB-008').status).toBe('skipped');
  });

  test('still accepts a single result file', () => {
    expect(loadResults({ unit: path.join(dir, 'hub.json') }).results.has('CLT-WEB-005')).toBe(true);
  });
});

// A real `node --test` run, so a change in Node's JUnit reporter shows up here.
const NODE_TEST_FILE = `
import { describe, it, test } from 'node:test';
import assert from 'node:assert';
describe('TRK-MOB-011 module <a> & "b"', () => {
  it('passes', () => {});
  describe('nested', () => {
    it('fails', () => { assert.equal(1, 2); });
  });
});
describe('TRK-MOB-012 all fine', () => {
  it('passes', () => {});
  it.skip('is skipped', () => {});
});
describe('TRK-MOB-013 only skipped', () => {
  it.todo('later');
});
test('top-level TRK-MOB-014 test', () => {});
test('untagged test', () => {});
`;

describe('JUnit results (node --test)', () => {
  test('reads nested suites, failures and skips from the node:test reporter', () => {
    const source = path.join(dir, 'sample.test.mjs');
    const xml = path.join(dir, 'node-test.xml');
    fs.writeFileSync(source, NODE_TEST_FILE);
    spawnSync(process.execPath, ['--test', '--test-reporter=junit', `--test-reporter-destination=${xml}`, source], {
      encoding: 'utf8',
    });
    const { results, found } = loadResults({ unit: [xml] });
    expect(found).toBe(true);
    expect(results.get('TRK-MOB-011').status).toBe('failed');
    expect(results.get('TRK-MOB-011').errors.join('\n')).toContain('1 == 2');
    expect(results.get('TRK-MOB-012')).toEqual({ status: 'passed', errors: [] });
    expect(results.get('TRK-MOB-013').status).toBe('skipped');
    expect(results.get('TRK-MOB-014').status).toBe('passed');
    expect([...results.keys()].sort()).toEqual(['TRK-MOB-011', 'TRK-MOB-012', 'TRK-MOB-013', 'TRK-MOB-014']);
  });

  test('reads classname-style JUnit and decodes entities once', () => {
    const results = collectJunit(`<?xml version="1.0"?>
<testsuites>
  <testsuite name="rules" tests="3">
    <testcase classname="OPT-MOB-002 RLS" name="blocks &lt;anon&gt;"/>
    <testcase classname="rules" name="OPT-MOB-003 errors"><error message="crash &amp; burn"/></testcase>
    <testcase classname="rules" name="OPT-MOB-004 fails"><failure message="short">long &amp;lt;trace&amp;gt;</failure></testcase>
  </testsuite>
  <testsuite name="empty"/>
  <testcase name="OPT-MOB-005 after an empty suite"/>
</testsuites>`);
    expect(results.get('OPT-MOB-002')).toEqual({ status: 'passed', errors: [] });
    expect(results.get('OPT-MOB-003')).toEqual({ status: 'failed', errors: ['crash & burn'] });
    expect(results.get('OPT-MOB-004')).toEqual({ status: 'failed', errors: ['long &lt;trace&gt;'] });
    expect(results.get('OPT-MOB-005').status).toBe('passed');
  });

  test('merges JUnit and Jest files for the same card, keeping the worst status', () => {
    const xml = path.join(dir, 'merge.xml');
    fs.writeFileSync(xml, '<testsuites><testcase name="SND-WEB-001 ok"/></testsuites>');
    const { results } = loadResults({ unit: [xml, path.join(dir, 'project.json')] });
    expect(results.get('SND-WEB-001')).toEqual({ status: 'failed', errors: ['boom'] });
  });
});

describe('buildReport', () => {
  const card = (id, env, extra = {}) => ({ id, title: `Test ${id}`, priority: 'medium', env, status: 'passed', ...extra });
  const cards = [card('TRK-MOB-001', 'unit'), card('TRK-MOB-002', 'unit'), card('TRK-MOB-038', 'e2e-device')];

  test('lists device cards that did not run apart from the others', () => {
    const results = new Map([['TRK-MOB-001', { status: 'passed', errors: [] }]]);
    const { summary } = buildReport({ project: 'tracksnap', cards, results });
    const [main, device] = summary.split('## On device (local)');

    expect(main).toContain('| TRK-MOB-001 | Test TRK-MOB-001 | medium | passed | yes |');
    expect(main).toContain('| TRK-MOB-002 | Test TRK-MOB-002 | medium | passed | no |');
    expect(main).not.toContain('TRK-MOB-038');
    expect(device).toContain('| ID | Title | Priority | Status | Last run |');
    expect(device).toContain('| TRK-MOB-038 | Test TRK-MOB-038 | medium | passed | never |');
    expect(summary).toContain('Cards: 3 · ran: 1 · on device (local): 1 · critical failures: 0');
  });

  test('keeps a device card in the main table when it has a result', () => {
    const results = new Map([['TRK-MOB-038', { status: 'failed', errors: ['boom'] }]]);
    const { summary } = buildReport({ project: 'tracksnap', cards, results });

    expect(summary).not.toContain('On device');
    expect(summary).toContain('| TRK-MOB-038 | Test TRK-MOB-038 | medium | failed | yes |');
    expect(summary).toContain('Cards: 3 · ran: 1 · critical failures: 0');
  });

  test('keeps the old layout for projects without device cards', () => {
    const results = new Map([['CLT-WEB-001', { status: 'failed', errors: [] }], ['CLT-WEB-009', { status: 'passed', errors: [] }]]);
    const report = buildReport({
      project: 'celtikci',
      cards: [card('CLT-WEB-001', 'local', { priority: 'critical' })],
      results,
    });

    expect(report.summary).toBe(
      [
        '# Test report: celtikci',
        '',
        '| ID | Title | Priority | Status | Ran |',
        '| --- | --- | --- | --- | --- |',
        '| CLT-WEB-001 | Test CLT-WEB-001 | critical | failed | yes |',
        '',
        'Cards: 1 · ran: 1 · critical failures: 1',
        '',
        'Tests without a card: CLT-WEB-009',
        '',
      ].join('\n'),
    );
    expect(report.criticalFailed.map((row) => row.id)).toEqual(['CLT-WEB-001']);
  });

  test('recognises device cards by env', () => {
    expect(isDeviceCard({ env: 'e2e-device' })).toBe(true);
    expect(isDeviceCard({ env: 'unit' })).toBe(false);
  });
});

describe('device runs', () => {
  test('shows the last local run date in the report', () => {
    const cards = [
      { id: 'TRK-MOB-038', title: 'Tabs', priority: 'medium', env: 'e2e-device', status: 'failed', last_run: '2026-11-27' },
    ];
    const { summary, criticalFailed } = buildReport({ project: 'tracksnap', cards, results: new Map() });

    expect(summary).toContain('| TRK-MOB-038 | Tabs | medium | failed | 2026-11-27 |');
    expect(criticalFailed).toEqual([]);
  });

  test('updates status and adds last_run after it, keeping line endings', () => {
    const text = '---\r\nid: TRK-MOB-038\r\nstatus: passed\r\nenv: e2e-device\r\n---\r\n\r\n## Body\r\n';

    expect(setCardFields(text, { status: 'failed', last_run: '2026-11-28' })).toBe(
      '---\r\nid: TRK-MOB-038\r\nstatus: failed\r\nlast_run: 2026-11-28\r\nenv: e2e-device\r\n---\r\n\r\n## Body\r\n',
    );
  });

  test('replaces an existing last_run', () => {
    const text = '---\nid: X\nstatus: passed\nlast_run: 2026-11-01\n---\nbody\n';

    expect(setCardFields(text, { status: 'passed', last_run: '2026-11-28' })).toBe(
      '---\nid: X\nstatus: passed\nlast_run: 2026-11-28\n---\nbody\n',
    );
  });

  test('records a Maestro JUnit run in device cards only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-device-'));
    try {
      const write = (id, env) =>
        fs.writeFileSync(path.join(dir, `${id}.md`), `---\nid: ${id}\ntitle: T\nenv: ${env}\nstatus: passed\n---\n`);
      write('TRK-MOB-001', 'unit');
      write('TRK-MOB-038', 'e2e-device');
      write('TRK-MOB-039', 'e2e-device');
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" device="phone" tests="3" failures="1" time="90">',
        '    <testcase id="TRK-MOB-038-tabs" name="TRK-MOB-038-tabs" classname="TRK-MOB-038-tabs" time="20" status="SUCCESS"/>',
        '    <testcase id="TRK-MOB-039-deep-links" name="TRK-MOB-039-deep-links" classname="TRK-MOB-039-deep-links" time="30" status="ERROR">',
        '      <failure>Element not found: Text matching regex: Garaj</failure>',
        '    </testcase>',
        '    <testcase id="TRK-MOB-001-x" name="TRK-MOB-001-x" classname="TRK-MOB-001-x" time="1" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n');

      const { updated, ignored } = recordDeviceRun({
        cards: readCards('tracksnap', dir),
        results: collectJunit(xml),
        date: '2026-11-28',
      });

      expect(updated).toEqual([
        { id: 'TRK-MOB-038', status: 'passed' },
        { id: 'TRK-MOB-039', status: 'failed' },
      ]);
      expect(ignored).toEqual(['TRK-MOB-001']);
      expect(readCards('tracksnap', dir).map((card) => [card.id, card.status, card.last_run])).toEqual([
        ['TRK-MOB-001', 'passed', undefined],
        ['TRK-MOB-038', 'passed', '2026-11-28'],
        ['TRK-MOB-039', 'failed', '2026-11-28'],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
