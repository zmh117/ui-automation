import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const out = process.env.MES_RUN_DIR ?? resolve('output', `mes-direct-${Date.now()}`);
export default defineConfig({
  testDir: '.', testMatch: 'workflow.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  timeout: 120000,
  preserveOutput: 'always',
  outputDir: resolve(out, 'artifacts'),
  reporter: [
    ['./reporter.ts'], ['dot'],
    ['html', { outputFolder: resolve(out, 'html'), open: 'never' }],
  ],
  use: {
    browserName: 'chromium', channel: 'chrome', headless: true,
    viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    storageState: process.env.MES_STORAGE_STATE,
    actionTimeout: 5000, navigationTimeout: 15000,
    screenshot: 'on', trace: 'on',
    launchOptions: { slowMo: Number(process.env.MES_SLOW_MO ?? 0) },
  },
});
