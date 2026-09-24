// Exercise production tab authentication and caching against controlled browser storage/network.
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const srcRoot = new URL('../src/', import.meta.url)
const timerGlobals = { setTimeout, clearTimeout, AbortController, AbortSignal, DOMException, console }

// Load a source module and its local imports into one sandbox, as the bundler would.
function loadModule(context, fileUrl, cache = new Map()) {
  if (cache.has(fileUrl.href)) return cache.get(fileUrl.href).exports
  const loaded = { exports: {} }
  cache.set(fileUrl.href, loaded)
  const require = (specifier) => {
    const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), srcRoot)
      : specifier.startsWith('.') ? new URL(specifier, fileUrl) : null
    if (!base) throw new Error(`Unexpected import in sandbox: ${specifier}`)
    return loadModule(context, new URL(`${base.href}.ts`), cache)
  }
  const source = fs.readFileSync(fileUrl, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInContext(`(function (exports, require, module) {${output}\n})`, context)(loaded.exports, require, loaded)
  return loaded.exports
}

function browserHarness(fetchImpl = async () => Response.json({ success: true })) {
  const storage = () => {
    const data = new Map()
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  }
  const sessionStorage = storage(), localStorage = storage()
  const window = { fetch: fetchImpl, location: { origin: 'https://portal.test', pathname: '/admin' } }
  const context = vm.createContext({ window, sessionStorage, localStorage, Headers, Request, Response, URL, atob, ...timerGlobals })
  const api = loadModule(context, new URL('lib/client-auth.ts', srcRoot))
  return { api, window, sessionStorage, localStorage }
}
const token = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`

test('remembered portals restore separate persistent credentials after another portal logs in', () => {
  const { api, window, sessionStorage } = browserHarness()
  const admin = token({ type: 'staff', role: 'ADMIN' }), customer = token({ type: 'customer' })
  api.setTabAuthToken(admin, { persistent: true })
  api.setTabAuthToken(customer, { persistent: true })
  sessionStorage.removeItem('tab-auth-token')
  assert.equal(api.getTabAuthToken(), admin)
  assert.equal(api.hasPersistentTabAuthToken(), true)
  api.clearTabAuthToken()
  window.location.pathname = '/customer'
  assert.equal(api.getTabAuthToken(), customer)
})

test('explicit no-store reads bypass cached product data', async () => {
  let calls = 0
  const { api, window } = browserHarness(async () => Response.json({ version: ++calls }))
  api.installTabAuthFetchInterceptor()
  assert.equal((await (await window.fetch('/api/products')).json()).version, 1)
  assert.equal((await (await window.fetch('/api/products')).json()).version, 1)
  assert.equal((await (await window.fetch('/api/products', { cache: 'no-store' })).json()).version, 2)
})

test('a read during an in-flight write cannot remain cached after the write finishes', async () => {
  let finishWrite, version = 1
  const { api, window } = browserHarness(async (_url, init) => {
    if (init?.method === 'PUT') { await new Promise(resolve => { finishWrite = resolve }); version = 2 }
    return Response.json({ version })
  })
  api.installTabAuthFetchInterceptor()
  const write = window.fetch('/api/products/item', { method: 'PUT' })
  assert.equal((await (await window.fetch('/api/products')).json()).version, 1)
  finishWrite()
  await write
  assert.equal((await (await window.fetch('/api/products')).json()).version, 2)
})

test('a fresh catalog includes later pages without depending on an existing account cache', async () => {
  const source = fs.readFileSync(new URL('../src/components/portals/customer/sections/shared/products-api.ts', import.meta.url), 'utf8')
  const calls = []
  const context = vm.createContext({ exports: {}, require: () => ({ fetchJsonWithRetry: async url => {
    calls.push(url)
    const page = new URL(url, 'https://portal.test').searchParams.get('page')
    return { response: { ok: true }, data: { products: [{ id: `product-page-${page}` }], totalPages: 2 } }
  } }) })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const result = await context.exports.fetchCustomerProducts()
  assert.equal(result.data.products.length, 2)
  assert.equal(result.data.products[1].id, 'product-page-2')
  assert.equal(calls.length, 2)
})

test('malformed successful HTTP responses are failed reads, not empty catalog successes', async () => {
  const context = vm.createContext({ fetch: async () => new Response('<html>proxy failure</html>', { status: 200 }), ...timerGlobals })
  const api = loadModule(context, new URL('components/portals/customer/sections/shared/api-shared.ts', srcRoot))
  const result = await api.fetchJsonWithRetry('/api/products', {}, 0)
  assert.equal(result.response, null)
  assert.ok(result.data.error)
})
