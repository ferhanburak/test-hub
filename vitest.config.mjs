import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from 'vitest/config';

const hubProject = process.env.HUB_PROJECT || 'celtikci';
if (!/^[a-z0-9-]+$/.test(hubProject)) throw new Error(`Invalid HUB_PROJECT: ${hubProject}`);

// Projects without browser tests in test-hub have no project.mjs.
const settingsFile = path.resolve('tests', hubProject, 'project.mjs');
const { default: settings } = fs.existsSync(settingsFile)
  ? await import(pathToFileURL(settingsFile).href)
  : { default: { repoDir: hubProject } };

const targetDir = path.resolve(process.env.HUB_TARGET_DIR || path.join('..', settings.repoDir));
const mocks = Object.fromEntries(
  Object.entries(settings.unitMocks ?? {}).map(([name, file]) => [name, path.resolve(file)]),
);

export default defineConfig({
  resolve: {
    alias: { '@target': targetDir, ...mocks },
  },
  server: {
    fs: { allow: [process.cwd(), targetDir] },
  },
  test: {
    include: [`tests/${hubProject}/unit/**/*.test.mjs`, 'tests/hub/**/*.test.mjs'],
    passWithNoTests: true,
    restoreMocks: false,
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/unit.json' },
  },
});
