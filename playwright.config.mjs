import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// HUB_PROJECT: folder under tests/ · HUB_SUITE: local | live | all
// HUB_TARGET_DIR: checkout of the project under test (needed for local)
const hubProject = process.env.HUB_PROJECT || 'celtikci';
if (!/^[a-z0-9-]+$/.test(hubProject)) throw new Error(`Invalid HUB_PROJECT: ${hubProject}`);

const suite = process.env.HUB_SUITE || 'local';
if (!['local', 'live', 'all'].includes(suite)) throw new Error(`Invalid HUB_SUITE: ${suite}`);

const settingsUrl = pathToFileURL(path.resolve('tests', hubProject, 'project.mjs')).href;
const { default: settings } = await import(settingsUrl);

const targetDir = path.resolve(process.env.HUB_TARGET_DIR || path.join('..', settings.repoDir));
const localUrl = `http://127.0.0.1:${settings.previewPort}`;
const browser = { ...devices['Desktop Chrome'] };

const projects = [];
if (suite !== 'live') {
  projects.push({
    name: 'local',
    testDir: `tests/${hubProject}/local`,
    use: { ...browser, baseURL: localUrl },
  });
}
if (suite !== 'local') {
  projects.push({
    name: 'live',
    testDir: `tests/${hubProject}/live`,
    retries: 2,
    use: { ...browser, baseURL: settings.liveUrl },
  });
}

export default defineConfig({
  projects,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    locale: 'tr-TR',
    // Service workers could bypass request interception.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer:
    suite === 'live'
      ? undefined
      : {
          command: `npm run preview -- --host 127.0.0.1 --port ${settings.previewPort} --strictPort`,
          cwd: targetDir,
          url: localUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
});
