// Fix: stream API traffic through Node's pooled fetch connections. External
// Next.js rewrites close the backend socket after every request.
const hopByHopHeaders = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]

function endToEndHeaders(source: Headers) {
  const headers = new Headers(source)
  // A Connection header can nominate additional headers that must not be forwarded.
  for (const name of (headers.get('connection') || '').split(',')) {
    if (name.trim()) headers.delete(name.trim())
  }
  for (const name of hopByHopHeaders) headers.delete(name)
  return headers
}

export async function forwardDjangoApi(request: Request, segments: string[], origin: string) {
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return Response.json({ success: false, error: 'Invalid API path' }, { status: 400 })
  }
  const configuredOrigin = origin.trim().replace(/\/+$/, '')
  const base = /^https?:\/\//i.test(configuredOrigin) ? configuredOrigin : `https://${configuredOrigin}`
  // Fix: the destination host is configuration-owned; URL segments cannot redirect credentials.
  const target = new URL(`${base}/api/${segments.map(encodeURIComponent).join('/')}`)
  const incomingUrl = new URL(request.url)
  if (segments.length && incomingUrl.pathname.endsWith('/')) target.pathname += '/'
  target.search = incomingUrl.search
  const headers = endToEndHeaders(request.headers)
  headers.set('x-forwarded-host', headers.get('host') || new URL(request.url).host)
  headers.delete('host')
  headers.set('accept-encoding', 'identity')

  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    if (!hasBody) headers.delete('content-length')
    // Django's WSGI reader needs Content-Length. Stream normal browser uploads
    // unchanged; materialize only unknown-length bodies so Fetch can supply it.
    const body = hasBody
      ? headers.has('content-length') ? request.body : await request.arrayBuffer()
      : undefined
    const options: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      body,
      ...(hasBody ? { duplex: 'half' as const } : {}),
      redirect: 'manual',
      // Forward explicit Cookie/Authorization headers, but disable Fetch's own
      // authentication retry: streamed writes cannot safely be replayed after 401.
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    }
    const upstream = await fetch(target, options)
    const responseHeaders = endToEndHeaders(upstream.headers)
    // Fetch decompresses upstream bodies, so encoded lengths must not reach the browser.
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
    responseHeaders.delete('set-cookie')
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie)
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    // Report transport failures as failures; never retry potentially committed writes.
    console.error('Django API proxy transport failure', error instanceof Error ? error.name : 'UnknownError')
    return Response.json({ success: false, error: 'Backend connection failed' }, { status: 502 })
  }
}
