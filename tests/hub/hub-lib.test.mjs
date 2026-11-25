import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadResults, readCards } from '../../scripts/lib/hub.mjs';

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
