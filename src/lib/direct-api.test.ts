import test from 'node:test'
import assert from 'node:assert/strict'
import { DIRECT_API_RETRY_AFTER_MS, createApiSender, resolveDirectApiOrigin } from './direct-api.ts'

const WEBSITE = 'https://annannsbeveragestrading.com'
const API = 'https://api.annannsbeveragestrading.com'

function recordingSend({ failDirect = false } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const send = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (failDirect && url.startsWith(API)) throw new TypeError('Failed to fetch')
    return new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { calls, send }
}

test('only the production website has a direct API host unless one is configured', () => {
  assert.equal(resolveDirectApiOrigin(WEBSITE), API)
  assert.equal(resolveDirectApiOrigin('https://www.annannsbeveragestrading.com'), null)
  assert.equal(resolveDirectApiOrigin('https://localhost:3000'), null)
  assert.equal(resolveDirectApiOrigin('https://localhost:3000', 'http://127.0.0.1:8001/'), 'http://127.0.0.1:8001')
})

test('a call carrying the tab token goes straight to the API host, without cookies', async () => {
  const { calls, send } = recordingSend()
  const sendApi = createApiSender({ send, pageOrigin: WEBSITE })

  await sendApi('/api/trips/t1/drop-points/d1?view=full', { method: 'PATCH', credentials: 'include' }, true)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API}/api/trips/t1/drop-points/d1?view=full`)
  assert.equal(calls[0].init?.method, 'PATCH')
  assert.equal(calls[0].init?.credentials, 'omit')
})

test('sign-in calls, cookie-only sessions and other sites stay on the website', async () => {
  const { calls, send } = recordingSend()
  const sendApi = createApiSender({ send, pageOrigin: WEBSITE })

  await sendApi('/api/auth/me', {}, true)
  await sendApi('/api/trips', {}, false)
  await createApiSender({ send, pageOrigin: 'https://localhost:3000' })('/api/trips', {}, true)

  assert.deepEqual(calls.map((call) => call.url), ['/api/auth/me', '/api/trips', '/api/trips'])
})

test('a failed direct call is resent through the website, which is then used for a while', async () => {
  let now = 1_000
  const { calls, send } = recordingSend({ failDirect: true })
  const sendApi = createApiSender({ send, pageOrigin: WEBSITE, now: () => now })

  const response = await sendApi('/api/uploads/pod-image', { method: 'POST' }, true)

  assert.equal(response.status, 200)
  assert.deepEqual(calls.map((call) => call.url), [`${API}/api/uploads/pod-image`, '/api/uploads/pod-image'])

  await sendApi('/api/trips', {}, true)
  assert.equal(calls[2].url, '/api/trips')

  now += DIRECT_API_RETRY_AFTER_MS
  await sendApi('/api/trips', {}, true)
  assert.equal(calls[3].url, `${API}/api/trips`)
})

test('a cancelled call is not resent through the website', async () => {
  const controller = new AbortController()
  controller.abort()
  let sends = 0
  const send = async () => {
    sends += 1
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  const sendApi = createApiSender({ send, pageOrigin: WEBSITE })

  await assert.rejects(sendApi('/api/trips', { signal: controller.signal }, true), { name: 'AbortError' })
  assert.equal(sends, 1)
})
