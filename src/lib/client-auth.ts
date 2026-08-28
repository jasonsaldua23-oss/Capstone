'use client'

const TAB_AUTH_TOKEN_KEY = 'tab-auth-token'
const PERSISTENT_TAB_AUTH_TOKEN_KEY = 'persistent-tab-auth-token'
const FETCH_PATCH_FLAG = '__tabAuthFetchPatched__'
const DEFAULT_API_CACHE_TTL_MS = 15_000
const REFERENCE_API_CACHE_TTL_MS = 5 * 60_000

type CachedApiResponse = {
  response: Response
  expiresAt: number
}

const apiResponseCache = new Map<string, CachedApiResponse>()
const inFlightApiReads = new Map<string, Promise<Response>>()
let apiCacheGeneration = 0

const uncachedApiPrefixes = [
  '/api/auth/',
  '/api/notifications',
  '/api/customer/tracking',
  '/api/driver/location',
]

const referenceApiPrefixes = [
  '/api/products',
  '/api/warehouses',
  '/api/roles',
  '/api/vehicles',
]

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

function getApiUrl(input: RequestInfo | URL): URL | null {
  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
  try {
    return new URL(requestUrl, window.location.origin)
  } catch {
    return null
  }
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function getApiCacheTtl(pathname: string): number {
  if (uncachedApiPrefixes.some((prefix) => pathname.startsWith(prefix))) return 0
  if (referenceApiPrefixes.some((prefix) => pathname.startsWith(prefix))) return REFERENCE_API_CACHE_TTL_MS
  return DEFAULT_API_CACHE_TTL_MS
}

export function clearApiResponseCache() {
  apiCacheGeneration += 1
  apiResponseCache.clear()
  inFlightApiReads.clear()
}

export function setTabAuthToken(token: string, options?: { persistent?: boolean }) {
  const persistent = Boolean(options?.persistent)
  // A new account token must never reuse responses from the previous session.
  clearApiResponseCache()

  // Fix: keep the active credential tab-scoped even when "Remember me" is enabled.
  // Otherwise another portal login can overwrite localStorage and change this tab's role.
  sessionStorage.setItem(TAB_AUTH_TOKEN_KEY, token)

  if (persistent) {
    localStorage.setItem(PERSISTENT_TAB_AUTH_TOKEN_KEY, token)
    return
  }

  localStorage.removeItem(PERSISTENT_TAB_AUTH_TOKEN_KEY)
}

export function getTabAuthToken(): string | null {
  const sessionToken = sessionStorage.getItem(TAB_AUTH_TOKEN_KEY)
  if (sessionToken) return sessionToken
  return localStorage.getItem(PERSISTENT_TAB_AUTH_TOKEN_KEY)
}

export function hasPersistentTabAuthToken(): boolean {
  return Boolean(localStorage.getItem(PERSISTENT_TAB_AUTH_TOKEN_KEY))
}

export function clearTabAuthToken() {
  clearApiResponseCache()
  sessionStorage.removeItem(TAB_AUTH_TOKEN_KEY)
  localStorage.removeItem(PERSISTENT_TAB_AUTH_TOKEN_KEY)
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
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const hasAuthHeader = headers.has('Authorization')
    if (token && !hasAuthHeader) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const requestInit: RequestInit = {
      ...init,
      headers,
    }
    const method = getRequestMethod(input, init)

    // Any write can affect multiple portal views, so invalidate before sending it.
    if (method !== 'GET') {
      clearApiResponseCache()
      return originalFetch(input, requestInit)
    }

    const apiUrl = getApiUrl(input)
    const cacheTtl = apiUrl ? getApiCacheTtl(apiUrl.pathname) : 0
    if (!apiUrl || cacheTtl <= 0 || init?.signal) {
      return originalFetch(input, requestInit)
    }

    const cacheKey = `${apiUrl.pathname}${apiUrl.search}`
    const cached = apiResponseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.response.clone()
    }
    if (cached) apiResponseCache.delete(cacheKey)

    const pending = inFlightApiReads.get(cacheKey)
    if (pending) return pending.then((response) => response.clone())

    // Cache only successful API responses; failed requests must always be retried.
    const requestGeneration = apiCacheGeneration
    const request = originalFetch(input, requestInit)
      .then((response) => {
        const cacheControl = String(response.headers.get('Cache-Control') || '').toLowerCase()
        const responseAllowsCache = !cacheControl.includes('no-store') && !cacheControl.includes('private')
        if (response.ok && responseAllowsCache && requestGeneration === apiCacheGeneration) {
          apiResponseCache.set(cacheKey, {
            response: response.clone(),
            expiresAt: Date.now() + cacheTtl,
          })
        }
        return response
      })
      .finally(() => {
        // Keep a newer request registered if this older request finishes after invalidation.
        if (inFlightApiReads.get(cacheKey) === request) inFlightApiReads.delete(cacheKey)
      })
    inFlightApiReads.set(cacheKey, request)

    return request.then((response) => response.clone())
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
