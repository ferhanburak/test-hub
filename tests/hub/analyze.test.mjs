import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  analyzeProject,
  envNames,
  firestoreCollections,
  listFiles,
  renderFacts,
  routes,
  supabaseTables,
} from '../../scripts/lib/analyze.mjs';

describe('firestoreCollections', () => {
  test('joins nested match paths and skips the catch-all', () => {
    const rules = [
      "rules_version = '2';",
      'service cloud.firestore {',
      '  match /databases/{database}/documents {',
      '    // match /old/{id} { }',
      '    match /users/{uid} {',
      '      allow read: if request.auth != null && request.auth.uid == uid;',
      '      match /drives/{driveId} {',
      '        allow read, write: if false;',
      '      }',
      '    }',
      '    match /public/{doc}{ allow read; }',
      '    match /{document=**} { allow read, write: if false; }',
      '  }',
      '}',
    ].join('\n');

    expect(firestoreCollections(rules)).toEqual(['public/{doc}', 'users/{uid}', 'users/{uid}/drives/{driveId}']);
  });
});

describe('supabaseTables', () => {
  test('reports RLS and policy counts per table', () => {
    const sql = [
      'create table public.profiles (id uuid primary key);',
      'create table if not exists "notes" (id bigint);',
      'alter table public.profiles enable row level security;',
      'create policy "own profile" on public.profiles for select using (auth.uid() = id);',
      'create policy own_update on public.profiles for update using (auth.uid() = id);',
    ].join('\n');

    expect(supabaseTables([sql])).toEqual([
      { table: 'notes', rls: false, policies: 0 },
      { table: 'profiles', rls: true, policies: 2 },
    ]);
  });
});

describe('routes', () => {
  test('reads Expo Router screens', () => {
    const files = ['src/app/_layout.tsx', 'src/app/index.tsx', 'src/app/(tabs)/profil.tsx', 'src/app/quiz/[id].tsx', 'src/app/+html.tsx'];

    expect(routes(files).map((r) => [r.route, r.kind])).toEqual([
      ['/', 'screen'],
      ['/profil', 'screen'],
      ['/quiz/[id]', 'screen'],
    ]);
  });

  test('reads Next.js app and pages routes and Vercel functions', () => {
    const files = [
      'app/layout.tsx',
      'app/page.tsx',
      'app/(site)/hakkimizda/page.tsx',
      'app/api/contact/route.ts',
      'app/components/Header.tsx',
      'pages/_app.tsx',
      'pages/blog/index.tsx',
      'pages/api/ping.ts',
      'api/send.ts',
      'api/send.test.ts',
    ];

    expect(routes(files).map((r) => [r.route, r.kind])).toEqual([
      ['/', 'page'],
      ['/api/contact', 'api'],
      ['/api/ping', 'api'],
      ['/api/send', 'api'],
      ['/blog', 'page'],
      ['/hakkimizda', 'page'],
    ]);
  });
});

describe('project analysis', () => {
  let dir;
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-analyze-'));
    write(
      'package.json',
      JSON.stringify({
        name: 'demo',
        scripts: { test: 'jest' },
        dependencies: { expo: '~54.0.0', '@supabase/supabase-js': '^2.0.0' },
        devDependencies: { jest: '^29.0.0' },
      }),
    );
    write('.env', 'SECRET_TOKEN=do-not-read\n');
    write('.env.local', 'LOCAL_ONLY=x\n');
    write('.env.example', 'EXPO_PUBLIC_SUPABASE_URL=\n');
    write('app.json', '{}');
    write('src/app/index.tsx', 'const key = process.env.EXPO_PUBLIC_SUPABASE_URL; const b = process.env["API_BASE"];');
    write('src/lib/vite.ts', 'export const mode = import.meta.env.VITE_MODE;');
    write('supabase/migrations/001_init.sql', 'create table notes (id int);');
    write('tests/catalog/MLK-MOB-001.md', '---\nid: MLK-MOB-001\n---\n');
    write('tests/app.test.ts', "test('MLK-MOB-001 opens', () => {});");
    write('node_modules/lib/index.js', 'process.env.FROM_DEPENDENCY');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('skips .env files and dependency folders', () => {
    const files = listFiles(dir);

    expect(files).toContain('.env.example');
    expect(files).not.toContain('.env');
    expect(files).not.toContain('.env.local');
    expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
  });

  test('reads only tracked files in a git repository', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-analyze-git-'));
    try {
      const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      git('init', '-q');
      fs.writeFileSync(path.join(repo, 'tracked.ts'), 'export {};');
      fs.mkdirSync(path.join(repo, '.claude'));
      fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{}');
      git('add', 'tracked.ts');

      expect(listFiles(repo)).toEqual(['tracked.ts']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('collects environment variable names, never values', () => {
    const names = envNames(dir, listFiles(dir));

    expect(names).toEqual(['API_BASE', 'EXPO_PUBLIC_SUPABASE_URL', 'VITE_MODE']);
  });

  test('summarises the project', () => {
    const facts = analyzeProject(dir);

    expect(facts.packages[0].frameworks).toEqual(['Expo ~54.0.0', 'Supabase JS ^2.0.0', 'Jest ^29.0.0']);
    expect(facts.configs).toEqual(['app.json', '.env.example']);
    expect(facts.supabase).toEqual({ migrations: 1, tables: [{ table: 'notes', rls: false, policies: 0 }] });
    expect(facts.routes.map((r) => r.route)).toEqual(['/']);
    expect(facts.tests).toEqual({ files: 1, maestroFlows: 0, catalogCards: 1, idsInTests: ['MLK-MOB-001'] });

    const text = renderFacts(facts);
    expect(text).toContain('| notes | **kapalı** | 0 |');
    expect(text).not.toContain('do-not-read');
    expect(text).not.toContain('SECRET_TOKEN');
  });
});
