import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
// @ts-ignore Node's test runner loads the TypeScript source directly.
import { forwardDjangoApi } from './django-api-proxy.ts'

test('proxy preserves API semantics and reuses backend connections', async () => {
  let connections = 0
  const received: Array<{ url?: string; auth?: string; cookie?: string; body: Buffer; type?: string }> = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received.push({ url: req.url, auth: req.headers.authorization, cookie: req.headers.cookie, body: Buffer.concat(chunks), type: req.headers['content-type'] })
    if (req.url === '/api/redirect') {
      res.writeHead(302, { Location: '/api/destination', 'Set-Cookie': ['a=1; HttpOnly', 'b=2; Secure'] })
      res.end()
    } else if (req.url === '/api/compressed') {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.end(gzipSync('decoded response'))
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end('{"error":"Unauthorized"}')
    }
  })
  server.on('connection', () => { connections++ })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    // Consume each response so its connection is available for subsequent requests.
    for (let i = 0; i < 4; i++) {
      const result = await forwardDjangoApi(new Request('https://site.test/api/health?q=a%20b', {
        headers: { Authorization: 'Bearer test-only', Cookie: 'session=test-only', Connection: 'close' },
      }), ['health'], origin)
      assert.equal(result.status, 401)
      assert.equal(result.headers.get('cache-control'), 'no-store')
      assert.equal(await result.text(), '{"error":"Unauthorized"}')
    }
    assert.ok(connections <= 2, `Expected pooling, observed ${connections} TCP connections for four requests`)
    assert.equal(received[0].url, '/api/health?q=a%20b')
    assert.equal(received[0].auth, 'Bearer test-only')
    assert.equal(received[0].cookie, 'session=test-only')
    const upload = Buffer.from([0, 255, 13, 10, 23])
    const uploaded = await forwardDjangoApi(new Request('https://site.test/api/upload', {
      method: 'POST', body: upload, headers: { 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(upload.length) },
    }), ['upload'], origin)
    assert.equal(uploaded.status, 401)
    await uploaded.text()
    assert.deepEqual(received.at(-1)?.body, upload)
    assert.equal(received.at(-1)?.type, 'multipart/form-data; boundary=test')
    const redirect = await forwardDjangoApi(new Request('https://site.test/api/redirect'), ['redirect'], origin)
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.get('location'), '/api/destination')
    assert.equal(redirect.headers.getSetCookie().length, 2)
    await redirect.text()
    const compressed = await forwardDjangoApi(new Request('https://site.test/api/compressed'), ['compressed'], origin)
    assert.equal(await compressed.text(), 'decoded response')
    assert.equal(compressed.headers.get('content-encoding'), null)
    const head = await forwardDjangoApi(new Request('https://site.test/api/health', { method: 'HEAD' }), ['health'], origin)
    assert.equal(head.status, 401)
    assert.equal(head.body, null)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
