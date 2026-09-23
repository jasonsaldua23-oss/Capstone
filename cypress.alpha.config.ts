import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/alpha-blackbox.cy.ts',
    supportFile: false,
    setupNodeEvents(on, config) {
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.family === 'chromium') {
          // Added: this Windows host lacks the Chromium GPU runtime DLLs, so Cypress must render in software.
          launchOptions.args.push('--disable-gpu')
          launchOptions.args.push('--disable-software-rasterizer')
        }
        return launchOptions
      })
      return config
    },
  },
  screenshotsFolder: 'test-results/alpha-cypress/screenshots',
  videosFolder: 'test-results/alpha-cypress/videos',
  video: false,
  viewportWidth: 1280,
  viewportHeight: 720,
  defaultCommandTimeout: 10_000,
  execTimeout: 600_000,
  taskTimeout: 600_000,
})
