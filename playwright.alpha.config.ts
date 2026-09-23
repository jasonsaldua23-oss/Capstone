import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/alpha-blackbox',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 15_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/alpha-blackbox-playwright.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report/alpha-blackbox' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
