import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4002',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'cross-env NODE_ENV=test DB_PATH=./data/media.playwright.db PORT=4002 node server/index.js',
    port: 4002,
    timeout: 10000,
    reuseExistingServer: false,
  },
});
