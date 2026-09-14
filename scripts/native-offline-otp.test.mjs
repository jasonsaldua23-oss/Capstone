import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { NextRequest, NextResponse } from 'next/server.js'

// Run the real middleware/helpers with platform boundaries controlled; no OTP emails are sent.
function load(file, globals) {
  const exports = {}
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(compiled, { exports, ...globals })
  return exports
}

test('both Capacitor shells can use neutral sign-in and OTP without opening unrelated auth routes', async () => {
  const scope = load('src/lib/portal-scope.ts', {})
  for (const variant of ['all', 'driver', 'customer']) {
    const { middleware } = load('src/middleware.ts', {
      TextEncoder, URL, process: { env: { NEXT_PUBLIC_APP_VARIANT: variant } },
      require(name) {
        if (name === 'next/server') return { NextResponse }
        if (name === 'jose') return { jwtVerify: async () => { throw new Error('No token expected') } }
        assert.equal(name, '@/lib/portal-scope')
        return scope
      },
    })
    for (const portal of variant === 'all' ? ['driver', 'customer'] : [variant]) {
      const headers = { 'user-agent': `AABTradingApp AABPortal/${portal}` }
      for (const action of ['request-otp', 'verify-otp', 'reset']) {
        const response = await middleware(new NextRequest(`https://example.test/api/auth/password-reset/${action}`, { method: 'POST', headers }))
        assert.equal(response.headers.get('x-middleware-next'), '1', `${portal}: ${action}`)
      }
      for (const endpoint of ['/api/auth/unified/login', '/api/auth/unified/google']) {
        const response = await middleware(new NextRequest(`https://example.test${endpoint}`, { method: 'POST', headers }))
        assert.equal(response.headers.get('x-middleware-next'), '1', `${portal}: ${endpoint}`)
      }
      const denied = await middleware(new NextRequest('https://example.test/api/auth/unknown-action', { headers }))
      assert.equal(denied.status, 403)
      const otherLogin = portal === 'driver' ? '/api/auth/customer/login' : '/api/auth/login'
      assert.equal((await middleware(new NextRequest(`https://example.test${otherLogin}`, { headers }))).status, 403)
    }
  }
})

test('shared browser sign-in stays neutral while the Shop shell keeps its scoped login', async () => {
  const scope = load('src/lib/portal-scope.ts', {})
  const { middleware } = load('src/middleware.ts', {
    TextEncoder, URL, process: { env: { NEXT_PUBLIC_APP_VARIANT: 'all' } },
    require(name) {
      if (name === 'next/server') return { NextResponse }
      if (name === 'jose') return { jwtVerify: async () => { throw new Error('No token expected') } }
      assert.equal(name, '@/lib/portal-scope')
      return scope
    },
  })

  // Every role-specific browser entry resolves to the one role-based login page.
  for (const scopedPath of ['/login/admin', '/login/warehouse', '/driver/login', '/customer/login', '/login/driver', '/login/customer']) {
    const response = await middleware(new NextRequest(`https://example.test${scopedPath}`))
    assert.equal(response.status, 307, scopedPath)
    assert.equal(response.headers.get('location'), 'https://example.test/login', scopedPath)
  }

  // Browser bookmarks are normalized without losing the registration intent.
  const browserRedirect = await middleware(new NextRequest('https://example.test/customer/login?mode=register'))
  assert.equal(browserRedirect.status, 307)
  assert.equal(browserRedirect.headers.get('location'), 'https://example.test/login?mode=register')
  const neutralBrowser = await middleware(new NextRequest('https://example.test/login?mode=register'))
  assert.equal(neutralBrowser.headers.get('x-middleware-next'), '1')

  // Password recovery follows the same neutral browser rule without losing a typed email.
  const browserRecoveryRedirect = await middleware(new NextRequest('https://example.test/customer/login/forgot-password?email=shopper%40example.test'))
  assert.equal(browserRecoveryRedirect.status, 307)
  assert.equal(browserRecoveryRedirect.headers.get('location'), 'https://example.test/login/forgot-password?email=shopper%40example.test')
  const neutralRecovery = await middleware(new NextRequest('https://example.test/login/forgot-password?email=shopper%40example.test'))
  assert.equal(neutralRecovery.headers.get('x-middleware-next'), '1')

  // Capacitor remains on the Shop URL so its PWA/native scope cannot escape.
  const shopHeaders = { 'user-agent': 'AABTradingApp AABPortal/customer' }
  const scopedShop = await middleware(new NextRequest('https://example.test/customer/login?mode=register', { headers: shopHeaders }))
  assert.equal(scopedShop.headers.get('x-middleware-next'), '1')
  const scopedRecovery = await middleware(new NextRequest('https://example.test/customer/login/forgot-password', { headers: shopHeaders }))
  assert.equal(scopedRecovery.headers.get('x-middleware-next'), '1')
  const escapedShop = await middleware(new NextRequest('https://example.test/login', { headers: shopHeaders }))
  assert.equal(escapedShop.status, 307)
  assert.equal(escapedShop.headers.get('location'), 'https://example.test/customer/login')
})

test('offline detection handles airplane mode, Wi-Fi without internet, reconnection, and listener cleanup', async () => {
  let subscribe, snapshot
  let reachable = false
  let requests = 0
  const events = new Map()
  const browser = {
    addEventListener: (name, handler) => events.set(name, handler),
    removeEventListener: (name) => events.delete(name),
    setInterval: () => 1, clearInterval() {},
    setTimeout: () => 2, clearTimeout() {},
  }
  const navigator = { onLine: false }
  const { useNativeOffline } = load('src/hooks/use-native-offline.ts', {
    window: browser, document: { ...browser, hidden: false }, navigator, AbortController,
    fetch: async () => { requests++; if (!reachable) throw new TypeError('Network unavailable'); return { status: 200 } },
    require(name) {
      if (name === '@/lib/native/platform') return { isNativeApp: () => true }
      assert.equal(name, 'react')
      return { useSyncExternalStore: (listen, read) => { subscribe = listen; snapshot = read; return read() } }
    },
  })
  assert.equal(useNativeOffline(), true)
  const stop = subscribe(() => {})
  assert.equal(requests, 0)
  navigator.onLine = true
  events.get('online')()
  await new Promise(setImmediate)
  assert.equal(snapshot(), true, 'Wi-Fi alone does not imply internet access')
  reachable = true
  events.get('online')()
  await new Promise(setImmediate)
  assert.equal(snapshot(), false)
  navigator.onLine = false
  events.get('offline')()
  assert.equal(snapshot(), true)
  stop()
  assert.equal(events.size, 0)
})

test('failed native registration does not claim notification permission is missing', async () => {
  for (const permission of ['granted', 'prompt', 'denied']) {
    const { resumeNotificationsIfAllowed } = load('src/lib/native/notifications.ts', {
      window: {},
      require(name) {
        if (name === './platform') return {
          isNativeApp: () => true, isPluginAvailable: () => true,
          waitForNativeBridge: async () => true, getPlatform: () => 'android',
        }
        if (name === './permissions') return {}
        assert.equal(name, '@capacitor/push-notifications')
        return { PushNotifications: {
          checkPermissions: async () => ({ receive: permission }),
          createChannel: async () => { throw new Error('Registration unavailable') },
        } }
      },
    })
    const result = await resumeNotificationsIfAllowed()
    assert.equal(result.registered, false)
    assert.equal(Boolean(result.needsPermission), permission !== 'granted')
  }
})
