import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise each actual mobile API client without booting Expo or calling production.
function loadClient(app, fetch) {
  const source = readFileSync(new URL(`../mobile/${app}-app/src/services/api.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.equal(name, '../config/env')
      return { API_BASE_URL: 'https://example.test' }
    },
    fetch, Headers, FormData, AbortController, Error, TypeError, SyntaxError, JSON,
    setTimeout, clearTimeout,
  })
  return exports
}

async function flush() {
  for (let i = 0; i < 10; i++) await setImmediate()
}

for (const app of ['customer', 'driver']) {
  test(`${app}: repeated read failures stay pending until real data arrives`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let calls = 0
    let settled = false
    const client = loadClient(app, async () => {
      calls++
      if (calls <= 4) throw new TypeError('Failed to fetch')
      if (calls === 5) return new Response('Unavailable', { status: 503 })
      if (calls === 6) return new Response('{')
      if (calls === 7) return Response.json({ dbUnavailable: true })
      return Response.json({ replacements: [{ id: 'real-record' }] })
    })
    const pending = client.apiRequest('/api/replacements').then((data) => {
      settled = true
      return data
    })
    for (let i = 0; i < 7; i++) {
      await flush()
      assert.equal(settled, false)
      assert.equal(calls, i + 1)
      t.mock.timers.tick(30_000)
    }
    assert.deepEqual(await pending, { replacements: [{ id: 'real-record' }] })
    assert.deepEqual(await client.apiRequest('/api/replacements'), { replacements: [{ id: 'real-record' }] })
    assert.equal(calls, 8, 'only valid data enters the existing cache')
  })

  test(`${app}: access errors and submissions are never replayed`, async () => {
    for (const status of [401, 403, 404, 422]) {
      let calls = 0
      const client = loadClient(app, async () => {
        calls++
        return Response.json({ error: 'Denied' }, { status })
      })
      await assert.rejects(client.apiRequest('/api/orders'), { status })
      assert.equal(calls, 1)
    }
    let writes = 0
    const client = loadClient(app, async () => {
      writes++
      throw new TypeError('Failed to fetch')
    })
    await assert.rejects(client.apiRequest('/api/replacements', { method: 'POST' }))
    assert.equal(writes, 1)
  })

  test(`${app}: cancellation stops retries and pre-cancelled requests never start`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let calls = 0
    const client = loadClient(app, async () => {
      calls++
      throw new TypeError('Failed to fetch')
    })
    const controller = new AbortController()
    const pending = client.apiRequest('/api/orders', { signal: controller.signal })
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    await flush()
    controller.abort()
    await rejected
    t.mock.timers.tick(60_000)
    await assert.rejects(client.apiRequest('/api/orders', { signal: controller.signal }))
    assert.equal(calls, 1)
  })
}
