import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './verification', testMatch: '*.spec.ts', workers: 1, retries: 0,
  timeout: 90000,
  outputDir: '../output/mes-adapter-verification',
  reporter: [['list']],
  use: { channel: 'chrome', headless: true },
});
