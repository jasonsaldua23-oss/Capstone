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

test('both Capacitor shells can send, verify, and reset OTP without opening unrelated auth routes', async () => {
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
      const denied = await middleware(new NextRequest('https://example.test/api/auth/unknown-action', { headers }))
      assert.equal(denied.status, 403)
      const otherLogin = portal === 'driver' ? '/api/auth/customer/login' : '/api/auth/login'
      assert.equal((await middleware(new NextRequest(`https://example.test${otherLogin}`, { headers }))).status, 403)
    }
  }
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
