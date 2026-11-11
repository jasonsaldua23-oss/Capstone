const rejectedRequest = 'The server rejected this request. Check the entered information and try again.'

type ApiWriteOptions = {
  retryDelayMs?: number
  fallbackError?: string | null
  signal?: AbortSignal | null
}

const isTransientStatus = (status: number) => [408, 425, 429].includes(status) || status >= 500

// The longest single wait the backoff below ever makes on its own.
const MAX_SILENT_RETRY_AFTER_SECONDS = 30

/**
 * A 429 that names a long wait is a lockout, not a hiccup. The sign-in throttle
 * locks verification-code sends for 15 minutes after the third; retrying that
 * silently kept the Log in button spinning, with no message, for the whole time.
 */
function isLongLockout(response: Response, payload: any) {
  if (response.status !== 429) return false
  const header = Number(response.headers.get('Retry-After'))
  // Cross-origin replies hide Retry-After unless CORS exposes it; the body still says.
  const seconds = Number.isFinite(header) && header > 0 ? header : Number(payload?.retryAfter)
  return Number.isFinite(seconds) && seconds > MAX_SILENT_RETRY_AFTER_SECONDS
}

async function waitForWriteRetry(delayMs: number, signal?: AbortSignal | null) {
  if (signal?.aborted) throw signal.reason || new DOMException('Request cancelled', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason || new DOMException('Request cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function apiWrite(
  send: () => Promise<Response>,
  options: ApiWriteOptions = {},
): Promise<Response> {
  let attempt = 0
  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason || new DOMException('Request cancelled', 'AbortError')
    }
    let response: Response
    try {
      response = await send()
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason || error
      // Keep callers in their existing loading state while connectivity recovers.
      if (!(error instanceof TypeError)) throw error
      const delay = Math.min((options.retryDelayMs ?? 1000) * 2 ** Math.min(attempt++, 5), 30_000)
      await waitForWriteRetry(delay, options.signal)
      continue
    }

    // No-content responses are valid for endpoints that intentionally return no body.
    if (response.status === 204 || response.status === 205) return response
    let payload: any
    try {
      payload = await response.clone().json()
    } catch {
      payload = null
    }
    if (response.ok && payload !== null && typeof payload === 'object' &&
      // A 2FA challenge is a confirmed login step, not a transient write failure.
      (payload.success !== false || payload.requiresTwoFactor === true) && !payload.dbUnavailable) return response

    if ((isTransientStatus(response.status) && !isLongLockout(response, payload)) ||
      payload?.dbUnavailable || (response.ok && payload === null)) {
      // Retry only unconfirmed/transient outcomes; validation and permission errors
      // still resolve to their existing handlers instead of loading forever.
      const delay = Math.min((options.retryDelayMs ?? 1000) * 2 ** Math.min(attempt++, 5), 30_000)
      await waitForWriteRetry(delay, options.signal)
      continue
    }

    // Login callers can opt out of generic fallback copy while preserving real API details.
    const fallback = options.fallbackError === null
      ? ''
      : options.fallbackError || (response.status === 401
        ? 'Your session could not be verified. Sign in again before continuing.'
        : response.status === 403
          ? 'This action was denied. Check your account permissions.'
          : rejectedRequest)
    const detail = payload?.error || payload?.message || payload?.detail
    const message = typeof detail === 'string' && detail.trim() ? detail : fallback
    const headers = new Headers(response.headers)
    // Preserve authentication and validation details for the existing portal handlers.
    headers.delete('Content-Length')
    headers.delete('Content-Encoding')
    headers.set('Content-Type', 'application/json')
    headers.set('Cache-Control', 'no-store')
    return new Response(JSON.stringify({
      ...(payload && typeof payload === 'object' ? payload : {}),
      success: false,
      ...(message ? { error: message } : {}),
    }), {
      status: response.status,
      headers,
    })
  }
}
