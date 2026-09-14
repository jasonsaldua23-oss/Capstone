import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'


function storage(seed = []) {
  const values = new Map(seed)
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}


function loadClientAuth({ pathname, sessionStorage, localStorage }) {
  const source = fs.readFileSync(new URL('../src/lib/client-auth.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    console,
    AbortController,
    URL,
    sessionStorage,
    localStorage,
    window: { location: { pathname } },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    require: (name) => {
      if (name === './retrying-api-read') return { retryingApiRead: () => {} }
      if (name === './api-write') return { apiWrite: () => {} }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  return exports
}


function token(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.signature`
}


test('two tabs retain different accounts on the same portal', () => {
  const sharedLocalStorage = storage()
  const tabAStorage = storage([['tab-login-portal', 'admin']])
  const tabBStorage = storage([['tab-login-portal', 'admin']])
  const tabA = loadClientAuth({ pathname: '/admin', sessionStorage: tabAStorage, localStorage: sharedLocalStorage })
  const tabB = loadClientAuth({ pathname: '/admin', sessionStorage: tabBStorage, localStorage: sharedLocalStorage })
  const tokenA = token({ type: 'staff', role: 'ADMIN', userId: 'admin-a' })
  const tokenB = token({ type: 'staff', role: 'ADMIN', userId: 'admin-b' })

  tabA.setTabAuthToken(tokenA, { persistent: true })
  tabB.setTabAuthToken(tokenB, { persistent: true })

  // Each active tab prefers its own session token over shared remembered credentials.
  assert.equal(tabA.getTabAuthToken(), tokenA)
  assert.equal(tabB.getTabAuthToken(), tokenB)
})


test('the neutral login permits a fresh account even when a new tab inherited storage', () => {
  const source = fs.readFileSync(new URL('../src/components/auth/StaffLoginPage.tsx', import.meta.url), 'utf8')
  assert.match(source, /if \(scopedRestorePortal === null\) return\s+const tabAuthToken = getTabAuthToken\(\)/)
})


test('session timeout uses the exact tab logout helper', () => {
  const source = fs.readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /logoutTabAuthSession\(targetPortal\)/)
  assert.doesNotMatch(source, /clearTabAuthToken\(\)\s+queryClient\.clear\(\)\s+void fetch\('\/api\/auth\/logout'/)
})
