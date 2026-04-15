'use client'

const TAB_AUTH_TOKEN_KEY = 'tab-auth-token'
const FETCH_PATCH_FLAG = '__tabAuthFetchPatched__'

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

    const response = await originalFetch(input, {
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
      return originalFetch(input, {
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
