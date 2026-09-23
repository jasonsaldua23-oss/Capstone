import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const evidenceDirectory = 'test-results/playwright-evidence'

function evidencePath(fileName: string) {
  // Added: keep successful Playwright screenshots together for the black-box report appendix.
  mkdirSync(evidenceDirectory, { recursive: true })
  return `${evidenceDirectory}/${fileName}`
}

test.describe('public authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Added: public-page tests must not depend on Django or Google's remote script being online.
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    })
    await page.route('https://accounts.google.com/**', async (route) => {
      await route.abort()
    })
  })

  test('TC-01 authentication entry renders the shared login form', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByText("Ann Ann's Beverages Trading", { exact: true })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled()
    await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/login/forgot-password')
    await page.screenshot({ path: evidencePath('TC-01-login-entry.png'), fullPage: true })
  })

  test('TC-03 shows the safe error for rejected credentials', async ({ page }) => {
    // Added: intercept authentication so this regression test never uses a real account.
    await page.route('**/api/auth/unified/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Invalid credentials' }),
      })
    })

    await page.goto('/login')
    await page.getByLabel('Email').fill('rejected@example.com')
    await page.getByRole('textbox', { name: 'Password' }).fill('incorrect-password')

    const loginRequest = page.waitForRequest((request) => (
      request.url().endsWith('/api/auth/unified/login') && request.method() === 'POST'
    ))
    await page.getByRole('button', { name: 'Log in' }).click()

    const request = await loginRequest
    expect(request.postDataJSON()).toEqual({
      email: 'rejected@example.com',
      password: 'incorrect-password',
      rememberMe: false,
    })
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toHaveText('Invalid email or password.')
    await expect(page).toHaveURL(/\/login$/)
    await page.screenshot({ path: evidencePath('TC-03-invalid-credentials.png'), fullPage: true })
  })

  test('TC-04 opens customer registration from the shared login', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Create an account' }).click()

    await expect(page).toHaveURL(/\/login\?mode=register$/)
    // Next.js may compile this route on first use, so wait for the rendered form rather than a fixed delay.
    await expect(page.getByText('Create your account.')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel(/First Name/)).toBeVisible()
    await expect(page.getByLabel(/Last Name/)).toBeVisible()
    await page.screenshot({ path: evidencePath('TC-04-registration-form.png'), fullPage: true })
  })
})
