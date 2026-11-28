// Static analysis of a project folder: facts read from files, no guessing.
// Secrets never leave the project: .env files are skipped and only the
// names of environment variables are collected, never their values.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', '.next', 'dist', 'build', 'coverage', 'android', 'ios', '.turbo']);
const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/;
const ENV_FILE_RE = /(^|\/)\.env(\.|$)/;
const MAX_SOURCE_BYTES = 512 * 1024;

const FRAMEWORKS = [
  ['next', 'Next.js'],
  ['expo', 'Expo'],
  ['expo-router', 'Expo Router'],
  ['react-native', 'React Native'],
  ['react', 'React'],
  ['vite', 'Vite'],
  ['firebase', 'Firebase JS SDK'],
  ['firebase-admin', 'Firebase Admin SDK'],
  ['firebase-functions', 'Cloud Functions for Firebase'],
  ['@supabase/supabase-js', 'Supabase JS'],
  ['nodemailer', 'Nodemailer'],
  ['vitest', 'Vitest'],
  ['jest', 'Jest'],
  ['@playwright/test', 'Playwright'],
  ['@testing-library/react-native', 'React Native Testing Library'],
];

const CONFIG_FILES = [
  'firebase.json',
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'vercel.json',
  'eas.json',
  'app.json',
  'app.config.js',
  'app.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'supabase/config.toml',
  'tsconfig.json',
  '.env.example',
];

// Tracked files when the folder is a git repository (ignored files, such as
// .env, stay out); otherwise a walk that skips build and dependency folders.
export function listFiles(root) {
  const git = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  let files;
  if (git.status === 0 && git.stdout) {
    files = git.stdout.split('\0').filter(Boolean);
  } else {
    files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(rel);
        } else if (entry.isFile()) files.push(rel);
      }
    };
    walk('');
  }
  return files
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => !ENV_FILE_RE.test(file) || file.endsWith('.env.example'))
    .filter((file) => !file.split('/').some((part) => SKIP_DIRS.has(part)))
    .sort();
}

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

export function readPackages(root, files) {
  return files
    .filter((file) => file === 'package.json' || file.endsWith('/package.json'))
    .map((file) => {
      const pkg = JSON.parse(read(root, file));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return {
        file,
        name: pkg.name ?? null,
        scripts: pkg.scripts ?? {},
        frameworks: FRAMEWORKS.filter(([dep]) => deps[dep]).map(([dep, label]) => `${label} ${deps[dep]}`),
        dependencies: Object.keys(pkg.dependencies ?? {}).length,
        devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
      };
    });
}

// Collection paths from Firestore rules, e.g. users/{uid}/drives/{driveId}.
export function firestoreCollections(rules) {
  const code = rules.replace(/\/\/.*$/gm, '');
  const stack = [];
  const paths = new Set();
  for (const [token, matchPath] of code.matchAll(/match\s+(\/\S*)\s*\{|\{|\}/g)) {
    if (token === '}') {
      stack.pop();
      continue;
    }
    stack.push(matchPath ?? null);
    if (!matchPath) continue;
    const full = stack.filter(Boolean).join('').replace(/^\/databases\/\{[^}]*\}\/documents/, '');
    if (full && full !== '/{document=**}' && !full.startsWith('/databases/')) paths.add(full.replace(/^\//, ''));
  }
  return [...paths].sort();
}

// Tables and RLS state from Supabase SQL migrations.
export function supabaseTables(sqlFiles) {
  const tables = new Map();
  const name = (raw) => raw.replace(/"/g, '').replace(/^public\./, '');
  for (const sql of sqlFiles) {
    for (const [, raw] of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) {
      if (!tables.has(name(raw))) tables.set(name(raw), { rls: false, policies: 0 });
    }
    for (const [, raw] of sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi)) {
      const table = tables.get(name(raw)) ?? { rls: false, policies: 0 };
      tables.set(name(raw), { ...table, rls: true });
    }
    for (const [, raw] of sql.matchAll(/create\s+policy\s+(?:"[^"]*"|\w+)\s+on\s+([\w."]+)/gi)) {
      const table = tables.get(name(raw)) ?? { rls: false, policies: 0 };
      tables.set(name(raw), { ...table, policies: table.policies + 1 });
    }
  }
  return [...tables].map(([table, info]) => ({ table, ...info })).sort((a, b) => a.table.localeCompare(b.table));
}

// File-based routes: Next.js app/ and pages/, Expo Router app/, Vercel api/.
// A folder's app/ is Next.js when it holds page files, otherwise Expo Router.
const ROUTE_FILE_RE = /^(?:(.+?)\/)?(?:src\/)?(app|pages)\/(.+)\.[jt]sx?$/;
const NEXT_SPECIAL = /^(layout|loading|error|template|not-found|global-error|default|head)$/;

export function routes(files) {
  const nextApps = new Set();
  for (const file of files) {
    const match = file.match(ROUTE_FILE_RE);
    if (match?.[2] === 'app' && /(^|\/)page$/.test(match[3])) nextApps.add(match[1] ?? '');
  }
  const clean = (parts) => `/${parts.filter((part) => !/^\(.+\)$/.test(part)).join('/')}`.replace(/\/index$/, '') || '/';
  const found = [];
  for (const file of files) {
    if (/\.(test|spec)\.[jt]sx?$/.test(file) || /(^|\/)(node_modules|components|__tests__)\//.test(file)) continue;
    const top = file.match(/^api\/(.+)\.[jt]s$/);
    if (top) {
      found.push({ route: `/api/${top[1]}`, kind: 'api', file });
      continue;
    }
    const match = file.match(ROUTE_FILE_RE);
    if (!match) continue;
    const [, base = '', kind, rest] = match;
    const parts = rest.split('/');
    const leaf = parts.pop();
    if (kind === 'pages') {
      if (leaf.startsWith('_')) continue;
      found.push({ route: clean([...parts, leaf]), kind: parts[0] === 'api' ? 'api' : 'page', file });
    } else if (nextApps.has(base)) {
      if (leaf === 'page') found.push({ route: clean(parts), kind: 'page', file });
      else if (leaf === 'route') found.push({ route: clean(parts), kind: 'api', file });
      else if (!NEXT_SPECIAL.test(leaf)) continue;
    } else {
      if (leaf.startsWith('_') || (leaf.startsWith('+') && leaf !== '+not-found')) continue;
      found.push({ route: clean([...parts, leaf]), kind: leaf.endsWith('+api') ? 'api' : 'screen', file });
    }
  }
  return found.sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
}

export function envNames(root, files) {
  const names = new Set();
  for (const file of files.filter((item) => item.endsWith('.env.example'))) {
    for (const [, key] of read(root, file).matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) names.add(key);
  }
  const pattern = /(?:process\.env|import\.meta\.env)(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;
  for (const file of files.filter((item) => SOURCE_RE.test(item))) {
    if (fs.statSync(path.join(root, file)).size > MAX_SOURCE_BYTES) continue;
    for (const [, dotted, quoted] of read(root, file).matchAll(pattern)) names.add(dotted ?? quoted);
  }
  return [...names].sort();
}

export function testIds(root, files) {
  const ids = new Set();
  const testFile = /(\.test|\.spec)\.[cm]?[jt]sx?$|(^|\/)\.maestro\/.+\.ya?ml$/;
  for (const file of files.filter((item) => testFile.test(item))) {
    for (const [id] of read(root, file).matchAll(/\b(?:CLT|SND|TRK|MLK|OPT|BAL)-(?:WEB|MOB)-\d{3}\b/g)) ids.add(id);
  }
  return [...ids].sort();
}

export function tree(files, depth = 2) {
  const dirs = new Map();
  for (const file of files) {
    const parts = file.split('/');
    for (let level = 1; level <= Math.min(depth, parts.length - 1); level += 1) {
      const dir = parts.slice(0, level).join('/');
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
    }
  }
  return [...dirs].map(([dir, count]) => ({ dir, files: count })).sort((a, b) => a.dir.localeCompare(b.dir));
}

export function analyzeProject(root) {
  const files = listFiles(root);
  const has = (file) => files.includes(file) || files.some((item) => item.endsWith(`/${file}`));
  const rulesFiles = files.filter((file) => file.endsWith('firestore.rules'));
  const migrations = files.filter((file) => /(^|\/)supabase\/migrations\/.+\.sql$/.test(file));
  const catalog = files.filter((file) => /(^|\/)tests\/catalog\/[^/]+\.md$/.test(file));
  return {
    project: path.basename(path.resolve(root)),
    files: files.length,
    packages: readPackages(root, files),
    configs: CONFIG_FILES.filter(has),
    workflows: files.filter((file) => /^\.github\/workflows\/.+\.ya?ml$/.test(file)),
    firestore: rulesFiles.map((file) => ({ file, collections: firestoreCollections(read(root, file)) })),
    supabase: migrations.length ? { migrations: migrations.length, tables: supabaseTables(migrations.map((file) => read(root, file))) } : null,
    routes: routes(files),
    env: envNames(root, files),
    tests: {
      files: files.filter((file) => /(\.test|\.spec)\.[cm]?[jt]sx?$/.test(file)).length,
      maestroFlows: files.filter((file) => /(^|\/)\.maestro\/[^/]+\.ya?ml$/.test(file) && !file.endsWith('config.yaml')).length,
      catalogCards: catalog.length,
      idsInTests: testIds(root, files),
    },
    tree: tree(files),
  };
}

const bullet = (items, empty = 'Yok') => (items.length ? items.map((item) => `- ${item}`) : [`- ${empty}`]);

export function renderFacts(facts) {
  const lines = [
    `# Statik analiz: ${facts.project}`,
    '',
    '> Otomatik üretildi. Bu bölüm dosyalardan okunan kesin bilgilerdir; yorum içermez.',
    '',
    `Dosya sayısı (git'te izlenen): ${facts.files}`,
    '',
    '## Paketler',
    '',
  ];
  for (const pkg of facts.packages) {
    lines.push(`### \`${pkg.file}\`${pkg.name ? ` (${pkg.name})` : ''}`, '');
    lines.push(`Bağımlılık: ${pkg.dependencies} · geliştirme: ${pkg.devDependencies}`, '');
    lines.push(...bullet(pkg.frameworks, 'Tanınan çatı yok'), '');
    const scripts = Object.entries(pkg.scripts);
    if (scripts.length) lines.push('Betikler:', '', ...scripts.map(([name, cmd]) => `- \`${name}\`: \`${cmd}\``), '');
  }
  if (!facts.packages.length) lines.push('- package.json yok', '');
  lines.push('## Yapılandırma dosyaları', '', ...bullet(facts.configs.map((file) => `\`${file}\``)), '');
  lines.push('## Workflow\'lar', '', ...bullet(facts.workflows.map((file) => `\`${file}\``)), '');
  if (facts.firestore.length) {
    lines.push('## Firestore koleksiyonları (kurallardan)', '');
    for (const rules of facts.firestore) lines.push(`\`${rules.file}\`:`, '', ...bullet(rules.collections.map((col) => `\`${col}\``)), '');
  }
  if (facts.supabase) {
    lines.push(`## Supabase tabloları (${facts.supabase.migrations} migration)`, '', '| Tablo | RLS | Politika |', '| --- | --- | --- |');
    lines.push(...facts.supabase.tables.map((t) => `| ${t.table} | ${t.rls ? 'açık' : '**kapalı**'} | ${t.policies} |`), '');
  }
  lines.push('## Route ve ekranlar', '');
  if (facts.routes.length) {
    lines.push('| Route | Tür | Dosya |', '| --- | --- | --- |', ...facts.routes.map((r) => `| \`${r.route}\` | ${r.kind} | \`${r.file}\` |`), '');
  } else lines.push('- Dosya tabanlı route bulunamadı', '');
  lines.push('## Ortam değişkenleri (yalnızca adlar)', '', ...bullet(facts.env.map((name) => `\`${name}\``)), '');
  lines.push(
    '## Testler',
    '',
    `- Test dosyası: ${facts.tests.files}`,
    `- Maestro akışı: ${facts.tests.maestroFlows}`,
    `- Katalog kartı (\`tests/catalog\`): ${facts.tests.catalogCards}`,
    `- Testlerde geçen kart ID'si: ${facts.tests.idsInTests.length ? facts.tests.idsInTests.join(', ') : 'yok'}`,
    '',
    '## Klasörler',
    '',
    '| Klasör | Dosya |',
    '| --- | --- |',
    ...facts.tree.map((item) => `| \`${item.dir}\` | ${item.files} |`),
    '',
  );
  return lines.join('\n');
}
