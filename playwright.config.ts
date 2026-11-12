import { defineConfig, devices } from '@playwright/test';

// BASE_URL permet de viser un site déjà déployé (par exemple la démo GitHub Pages).
const distant = process.env.BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 45_000 },
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: distant ?? 'http://localhost:4173/', locale: 'fr-FR', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: distant
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
