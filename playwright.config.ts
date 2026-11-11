import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 45_000 },
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', locale: 'fr-FR', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
