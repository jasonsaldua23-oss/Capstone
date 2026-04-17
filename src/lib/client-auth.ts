'use client'

const TAB_AUTH_TOKEN_KEY = 'tab-auth-token'
const FETCH_PATCH_FLAG = '__tabAuthFetchPatched__'
const API_GET_TIMEOUT_MS = 15000
const API_GET_RETRIES = 1
const API_RETRY_DELAY_MS = 350
const DB_BACKOFF_MS = 5000

let apiBackoffUntil = 0

function createTransientApiFailureResponse(status: number, error: string, dbUnavailable = false): Response {
  return new Response(
    JSON.stringify({
      success: false,
      dbUnavailable,
      error,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

function isApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') {
    return input.startsWith('/api/')
  }

  const requestUrl = input instanceof URL ? input.toString() : input.url
  try {
    const parsed = new URL(requestUrl, window.location.origin)
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

export function setTabAuthToken(token: string) {
  sessionStorage.setItem(TAB_AUTH_TOKEN_KEY, token)
}

export function getTabAuthToken(): string | null {
  return sessionStorage.getItem(TAB_AUTH_TOKEN_KEY)
}

export function clearTabAuthToken() {
  sessionStorage.removeItem(TAB_AUTH_TOKEN_KEY)
}

export function installTabAuthFetchInterceptor() {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const fetchWindow = window as Window & {
    [FETCH_PATCH_FLAG]?: boolean
    __originalFetch__?: typeof fetch
  }

  if (fetchWindow[FETCH_PATCH_FLAG]) {
    return () => {}
  }

  const originalFetch = window.fetch.bind(window)
  fetchWindow.__originalFetch__ = originalFetch

  const fetchApiWithResilience = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(
      init?.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    const isReadRequest = method === 'GET' || method === 'HEAD'
    const now = Date.now()

    if (isReadRequest && now < apiBackoffUntil) {
      return createTransientApiFailureResponse(503, 'Database is temporarily unavailable', true)
    }

    const maxAttempts = isReadRequest ? API_GET_RETRIES + 1 : 1
    let lastError: unknown = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const hasExternalSignal = Boolean(init?.signal)
      const controller = hasExternalSignal ? null : new AbortController()
      const timeoutId =
        isReadRequest && controller
          ? window.setTimeout(() => controller.abort(), API_GET_TIMEOUT_MS)
          : null

      try {
        const response = await originalFetch(input, {
          ...init,
          signal: hasExternalSignal ? init?.signal : controller?.signal,
        })

        if (isReadRequest) {
          if (response.status === 429 || response.status >= 500) {
            if (response.status === 503 || response.status === 504 || response.status === 429) {
              apiBackoffUntil = Date.now() + DB_BACKOFF_MS
            }
            if (attempt < maxAttempts) {
              await new Promise((resolve) => window.setTimeout(resolve, API_RETRY_DELAY_MS * attempt))
              continue
            }
          }

          try {
            const cloned = response.clone()
            const body = await cloned.json().catch(() => null)
            if (body && typeof body === 'object' && (body as Record<string, unknown>).dbUnavailable) {
              apiBackoffUntil = Date.now() + DB_BACKOFF_MS
            }
          } catch {
            // ignore body inspection failures
          }
        }

        return response
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error || '')
        const retryable =
          isReadRequest &&
          /abort|timed out|network|failed to fetch|econnreset|econnrefused|connection/i.test(
            message.toLowerCase()
          )

        if (retryable) {
          apiBackoffUntil = Date.now() + DB_BACKOFF_MS
        }

        if (isReadRequest && retryable && attempt >= maxAttempts) {
          const isAbort =
            (error as any)?.name === 'AbortError' ||
            message.toLowerCase().includes('abort')
          return createTransientApiFailureResponse(
            isAbort ? 408 : 503,
            isAbort ? 'Request timed out' : 'Temporary network issue',
            true
          )
        }

        if (!retryable || attempt >= maxAttempts) {
          throw error
        }

        await new Promise((resolve) => window.setTimeout(resolve, API_RETRY_DELAY_MS * attempt))
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Request failed')
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) {
      return originalFetch(input, init)
    }

    const token = getTabAuthToken()
    if (!token) {
      return originalFetch(input, init)
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const hasAuthHeader = headers.has('Authorization')
    if (!hasAuthHeader) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const response = await fetchApiWithResilience(input, {
      ...init,
      headers,
    })

    // Recover from stale per-tab tokens by retrying once without the injected header.
    if (!hasAuthHeader && (response.status === 401 || response.status === 403)) {
      clearTabAuthToken()
      const retryHeaders = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      )
      retryHeaders.delete('Authorization')
      return fetchApiWithResilience(input, {
        ...init,
        headers: retryHeaders,
      })
    }

    return response
  }

  fetchWindow[FETCH_PATCH_FLAG] = true

  return () => {
    const currentWindow = window as Window & {
      [FETCH_PATCH_FLAG]?: boolean
      __originalFetch__?: typeof fetch
    }
    if (currentWindow.__originalFetch__) {
      window.fetch = currentWindow.__originalFetch__
      currentWindow.__originalFetch__ = undefined
    }
    currentWindow[FETCH_PATCH_FLAG] = false
  }
}
