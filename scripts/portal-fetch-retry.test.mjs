import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Load the real web interceptor in browser/Capacitor-like globals, without production traffic.
const portalToken = portal => `header.${Buffer.from(JSON.stringify(portal === 'customer'
  ? { type: 'customer' }
  : { type: 'staff', role: { admin: 'ADMIN', warehouse: 'WAREHOUSE_STAFF', driver: 'DRIVER' }[portal] })).toString('base64url')}.signature`
function loadPortal(portal, native, fetch) {
  const session = new Map([['tab-login-portal', portal], ['tab-auth-token', portalToken(portal)]])
  const storage = (values) => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  })
  const window = {
    fetch,
    location: { origin: 'https://annannsbeveragestrading.com', pathname: `/${portal}` },
    ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}),
  }
  const context = {
    window, sessionStorage: storage(session), localStorage: storage(new Map()),
    Request, Response, URL, Headers, AbortController, AbortSignal, DOMException,
    Error, TypeError, SyntaxError, JSON, atob, setTimeout, clearTimeout,
  }
  const modules = new Map()
  function load(name) {
    if (modules.has(name)) return modules.get(name)
    const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    const exports = {}
    vm.runInNewContext(compiled, { ...context, exports, require: (path) => load(path.replace('./', '')) })
    modules.set(name, exports)
    return exports
  }
  const client = load('client-auth')
  const uninstall = client.installTabAuthFetchInterceptor()
  return { window, client, uninstall }
}

async function flush() {
  for (let i = 0; i < 10; i++) await setImmediate()
}

for (const portal of ['admin', 'warehouse', 'driver', 'customer']) {
  for (const native of [false, true]) {
    test(`${portal} ${native ? 'Capacitor context' : 'browser'}: no-store data loads retry until successful`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      // Simulate WebViews without the newer AbortSignal convenience methods.
      t.mock.method(AbortSignal, 'any', () => { throw new Error('Unsupported') })
      t.mock.method(AbortSignal, 'timeout', () => { throw new Error('Unsupported') })
      t.mock.method(AbortSignal.prototype, 'throwIfAborted', () => { throw new Error('Unsupported') })
      let calls = 0
      let loading = true
      const { window, uninstall } = loadPortal(portal, native, async (_, init) => {
        calls++
        assert.equal(init.headers.get('X-Portal'), portal)
        assert.equal(init.headers.get('Authorization'), `Bearer ${portalToken(portal)}`)
        if (calls <= 2) throw new TypeError('Failed to fetch')
        if (calls === 3) return new Response('Unavailable', { status: 503 })
        return Response.json({ replacements: [{ id: 'real-record' }] })
      })
      const pending = window.fetch('/api/replacements', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json()
        loading = false
        return data
      })
      for (let i = 0; i < 3; i++) {
        await flush()
        assert.equal(loading, true)
        assert.equal(calls, i + 1)
        t.mock.timers.tick(30_000)
      }
      assert.deepEqual(await pending, { replacements: [{ id: 'real-record' }] })
      assert.equal(loading, false)
      uninstall()
    })
  }
}

test('web interceptor preserves one-shot writes and cancels outstanding reads on logout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const { window, client, uninstall } = loadPortal('customer', true, async () => {
    calls++
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(window.fetch('/api/customer/replacements', { method: 'POST' }), /Check the latest record/)
  assert.equal(calls, 1)
  const pending = window.fetch('https://annannsbeveragestrading.com/api/customer/orders')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await flush()
  client.clearTabAuthToken()
  await rejected
  t.mock.timers.tick(60_000)
  assert.equal(calls, 2)
  uninstall()
})

test('address search retries without forwarding portal credentials', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const { window, uninstall } = loadPortal('customer', true, async (_, init) => {
    calls++
    assert.equal(new Headers(init.headers).has('Authorization'), false)
    assert.equal(new Headers(init.headers).has('X-Portal'), false)
    if (calls === 1) throw new TypeError('Failed to fetch')
    return Response.json([{ lat: '10.6', lon: '122.9' }])
  })
  const pending = window.fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&q=Bacolod')
  await flush()
  t.mock.timers.tick(1000)
  assert.deepEqual(await (await pending).json(), [{ lat: '10.6', lon: '122.9' }])
  assert.equal(calls, 2)
  uninstall()
})

test('API read URLs throughout src use recovery, including cached and uncached sections', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const urls = new Set()
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) { scan(path); continue }
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue
      const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          ['fetch', 'safeFetchJson', 'fetchJsonWithRetry'].includes(node.expression.text)) {
          const [input, init] = node.arguments
          const method = init && ts.isObjectLiteralExpression(init)
            ? init.properties.find((property) => property.name?.getText(source) === 'method') : undefined
          if (!method || (ts.isPropertyAssignment(method) && method.initializer.getText(source).replace(/['"]/g, '').toUpperCase() === 'GET')) {
            // Substitute template values only in the mocked URL; no real requests are sent.
            const url = input && (ts.isStringLiteral(input) || ts.isNoSubstitutionTemplateLiteral(input)) ? input.text
              : input && ts.isTemplateExpression(input) ? input.head.text + input.templateSpans.map((span) => 'audit' + span.literal.text).join('') : ''
            if (url.startsWith('/api/')) urls.add(url)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  scan(new URL('../src/', import.meta.url))
  assert.ok(urls.size > 20, 'audit must discover the real section read URLs')
  const calls = new Map()
  const { window, uninstall } = loadPortal('admin', false, async (input) => {
    const count = (calls.get(input) || 0) + 1
    calls.set(input, count)
    if (count === 1) throw new TypeError('Failed to fetch')
    return Response.json({ success: true, auditUrl: input })
  })
  // Cached and explicit-refresh requests take different branches in the actual interceptor.
  for (const cache of [undefined, 'no-store']) {
    for (const url of urls) {
      const input = `${url}${url.includes('?') ? '&' : '?'}auditCache=${cache || 'default'}`
      const pending = window.fetch(input, cache ? { cache } : undefined)
      await flush()
      assert.equal(calls.get(input), 1)
      t.mock.timers.tick(1000)
      assert.equal((await (await pending).json()).auditUrl, input)
      assert.equal(calls.get(input), 2)
    }
  }
  t.diagnostic(`Verified recovery for ${urls.size} distinct source API read URLs in both cache modes.`)
  uninstall()
})
// All portals must fail closed on unconfirmed writes, without replaying business actions.
for (const portal of ['admin', 'warehouse', 'driver', 'customer']) {
  test(`${portal}: malformed and rejected saves never become success`, async () => {
    for (const makeResponse of [
      () => new Response(''),
      () => new Response('<html>Gateway failure</html>', { status: 502 }),
      () => new Response('{'),
      () => Response.json({ success: false, error: 'Insufficient stock', available: 2 }),
      () => new Response('', { status: 401 }),
    ]) {
      let calls = 0
      const { window, uninstall } = loadPortal(portal, false, async () => {
        calls++
        return makeResponse()
      })
      const response = await window.fetch('/api/orders', { method: 'PATCH' })
      assert.equal(response.ok, false)
      const payload = await response.json()
      assert.equal(payload.success, false)
      assert.ok(payload.error.length > 0)
      if (payload.available === 2) assert.equal(payload.error, 'Insufficient stock')
      assert.equal(calls, 1)
      uninstall()
    }
  })
  test(`${portal}: valid save responses retain their status, body and headers`, async () => {
    for (const response of [Response.json({ success: true, id: 'saved' }, { status: 201 }), new Response(null, { status: 204 })]) {
      const { window, uninstall } = loadPortal(portal, false, async () => response)
      assert.equal(await window.fetch('/api/orders', { method: 'POST' }), response)
      uninstall()
    }
  })
}
// Regression: same-tab staff logins must not change the actor used by the Admin edit form.
test('switching Admin and Warehouse keeps each portal credential and clears only the logged-out portal', async () => {
  const { window, client, uninstall } = loadPortal('admin', false, async (_, init) => Response.json({ authorization: init.headers.get('Authorization') }))
  const token = role => `header.${Buffer.from(JSON.stringify({ type: 'staff', role })).toString('base64url')}.signature`
  const admin = token('ADMIN'), warehouse = token('WAREHOUSE_STAFF')
  client.setTabAuthToken(admin)
  window.location.pathname = '/warehouse'
  client.setTabAuthToken(warehouse)
  assert.equal(client.getTabAuthToken(), warehouse)
  window.location.pathname = '/admin'
  assert.equal(client.getTabAuthToken(), admin)
  assert.equal((await (await window.fetch('/api/users/user-1', { method: 'PUT' })).json()).authorization, `Bearer ${admin}`)
  client.clearTabAuthToken()
  assert.equal(client.getTabAuthToken(), null, 'Admin must not fall back to a warehouse token')
  window.location.pathname = '/warehouse'
  assert.equal(client.getTabAuthToken(), warehouse, 'Admin logout retains Warehouse session')
  uninstall()
})
test('switching portals cannot reuse another account API cache', async () => {
  let calls = 0
  const { window, client, uninstall } = loadPortal('admin', false, async (_, init) => {
    calls++
    return Response.json({ authorization: init.headers.get('Authorization') })
  })
  client.setTabAuthToken(portalToken('admin'))
  window.location.pathname = '/warehouse'
  client.setTabAuthToken(portalToken('warehouse'))
  await window.fetch('/api/users')
  window.location.pathname = '/admin'
  const response = await window.fetch('/api/users')
  assert.equal((await response.json()).authorization, `Bearer ${portalToken('admin')}`)
  assert.equal(calls, 2)
  uninstall()
})
// Run the actual restore functions so regressions in portal routing are caught, not just token storage.
function restoreFunction(path, name, globals) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(declaration, `Missing production ${name}`)
  return vm.runInNewContext(ts.transpile(`${declaration}; ${name}`, { target: ts.ScriptTarget.ES2020 }), globals)
}

test('Admin refresh rejects a Warehouse cookie instead of switching portals or logging out another tab', async () => {
  const routes = [], users = []
  const check = restoreFunction('../src/app/page.tsx', 'checkAuth', {
    getTabAuthToken: () => null, scopedPortal: 'admin', lockedPortal: null,
    getRememberedTabLoginPortal: () => 'admin', allowedPortals: ['admin', 'warehouse'],
    fetch: async (url) => { assert.equal(url, '/api/auth/me'); return Response.json({ user: { role: 'WAREHOUSE_STAFF' } }) },
    cancelled: false, resolvePortalForUser: () => 'warehouse', defaultPortal: 'admin',
    setUser: user => users.push(user), setPortal: portal => assert.equal(portal, 'admin'),
    router: { replace: path => routes.push(path) }, loginPathForPortal: portal => `/${portal}/login`,
    setIsLoading: () => {}, setAuthError: message => assert.fail(message), console,
  })
  await check()
  assert.deepEqual(routes, ['/admin/login'])
  assert.deepEqual(users, [null])
})

test('Admin refresh restores its own token even after another tab logs into Warehouse', async () => {
  let user
  const check = restoreFunction('../src/app/page.tsx', 'checkAuth', {
    getTabAuthToken: () => portalToken('admin'), scopedPortal: 'admin', lockedPortal: null,
    getRememberedTabLoginPortal: () => 'admin', allowedPortals: ['admin', 'warehouse'],
    fetch: async (_, init) => {
      assert.equal(init.headers.Authorization, `Bearer ${portalToken('admin')}`)
      assert.equal(init.cache, 'no-store')
      return Response.json({ user: { role: 'ADMIN' } })
    },
    cancelled: false, resolvePortalForUser: () => 'admin', defaultPortal: 'admin',
    setUser: value => { user = value }, setPortal: portal => assert.equal(portal, 'admin'),
    rememberTabLoginPortal: portal => assert.equal(portal, 'admin'),
    router: { replace: path => assert.fail(path) }, setIsLoading: () => {},
    setAuthError: message => assert.fail(message), console,
  })
  await check()
  assert.equal(user.role, 'ADMIN')
})

for (const portal of ['Admin', 'Warehouse', 'Driver', 'Customer']) {
  test(`${portal} login ignores another portal cookie without logging that account out`, async () => {
    const calls = []
    const check = restoreFunction(`../src/components/auth/${portal}LoginPage.tsx`, 'checkSession', {
      retryingApiRead: send => send(new AbortController().signal), controller: new AbortController(),
      getTabAuthToken: () => null,
      fetch: async (url, init) => {
        calls.push(url)
        assert.equal(init.headers['X-Portal'], portal.toLowerCase())
        return Response.json({ user: { role: portal === 'Admin' ? 'WAREHOUSE_STAFF' : 'ADMIN' } })
      },
      cancelled: false, resolvePortalFromUser: () => portal === 'Admin' ? 'warehouse' : 'admin',
      router: { replace: path => assert.fail(`Unexpected redirect ${path}`) },
      setIsCheckingSession: () => {}, console,
    })
    await check()
    assert.deepEqual(calls, ['/api/auth/me'])
  })
}
// A cookie-only Admin session is pinned locally before Warehouse changes the browser cookie.
test('Admin cookie restoration pins the verified token to its tab', async () => {
  let pinned
  const check = restoreFunction('../src/app/page.tsx', 'checkAuth', {
    getTabAuthToken: () => null, setTabAuthToken: (token, options) => { pinned = { token, persistent: options.persistent } },
    scopedPortal: 'admin', lockedPortal: null, getRememberedTabLoginPortal: () => 'admin',
    allowedPortals: ['admin', 'warehouse'],
    fetch: async () => Response.json({ user: { role: 'ADMIN', rememberMe: false }, token: portalToken('admin') }),
    cancelled: false, resolvePortalForUser: () => 'admin', defaultPortal: 'admin',
    setUser: () => {}, setPortal: () => {}, rememberTabLoginPortal: () => {},
    router: { replace: path => assert.fail(path) }, setIsLoading: () => {}, setAuthError: message => assert.fail(message), console,
  })
  await check()
  assert.deepEqual(pinned, { token: portalToken('admin'), persistent: false })
})
// Every login page must restore only its own portal and retain that session for refresh.
for (const target of ['Admin', 'Warehouse', 'Driver', 'Customer']) {
  for (const source of ['admin', 'warehouse', 'driver', 'customer']) {
    test(`${target} login with ${source} session restores only a matching account`, async () => {
      const portal = target.toLowerCase(), redirects = [], saved = [], warnings = []
      const check = restoreFunction(`../src/components/auth/${target}LoginPage.tsx`, 'checkSession', {
        retryingApiRead: send => send(new AbortController().signal), controller: new AbortController(),
        getTabAuthToken: () => portalToken(portal),
        setTabAuthToken: (token, options) => saved.push([token, options.persistent]),
        fetch: async (url, init) => {
          assert.equal(url, '/api/auth/me')
          assert.equal(init.headers.Authorization, `Bearer ${portalToken(portal)}`)
          assert.equal(init.headers['X-Portal'], portal)
          assert.equal(init.cache, 'no-store')
          return Response.json({ user: { rememberMe: false }, token: portalToken(source) })
        },
        cancelled: false, resolvePortalFromUser: () => source,
        DRIVER_HOME_PATH: '/driver', CUSTOMER_HOME_PATH: '/customer',
        router: { replace: path => redirects.push(path) }, setIsCheckingSession: () => {},
        console: { warn: (...args) => warnings.push(args) },
      })
      await check()
      assert.deepEqual(warnings, [])
      assert.deepEqual(redirects, portal === source ? [`/${portal}`] : [])
      assert.deepEqual(saved, portal === source ? [[portalToken(portal), false]] : [])
    })
  }
}
// Reproduce the missed path: a new Admin tab inherits Warehouse's remembered portal.
test('successful Admin login replaces inherited Warehouse routing and navigates directly to Admin', async () => {
  const { window, client, uninstall } = loadPortal('warehouse', false, async () => Response.json({}))
  window.location.pathname = '/admin/login'
  const source = readFileSync(new URL('../src/components/auth/AdminLoginPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('admin.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleLogin') handler = node.initializer.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const routes = [], errors = []
  const login = vm.runInNewContext(ts.transpile(`(${handler})`, { target: ts.ScriptTarget.ES2020 }), {
    email: 'admin@example.test', password: 'test-only', rememberMe: false,
    fetch: async () => Response.json({ success: true, user: { role: 'ADMIN' }, token: portalToken('admin') }),
    setLoginError: message => { if (message) errors.push(message) }, setIsLoading: () => {},
    resolvePortalFromUser: () => 'admin', persistAdminWelcomeState: () => {},
    setTabAuthToken: client.setTabAuthToken, setLoginSucceeded: () => {},
    sessionStorage: { setItem: () => {} }, router: { replace: path => routes.push(path) },
    toast: { error: message => errors.push(message) },
  })
  await login({ preventDefault() {} })
  assert.deepEqual(errors, [])
  assert.deepEqual(routes, ['/admin'])
  window.location.pathname = '/'
  assert.equal(client.getTabAuthToken(), portalToken('admin'), 'bare-domain restore must remember the newly logged-in portal')
  uninstall()
})
