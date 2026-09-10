'use client'

import { retryingApiRead } from './retrying-api-read'

const TAB_AUTH_TOKEN_KEY = 'tab-auth-token'
const PERSISTENT_TAB_AUTH_TOKEN_KEY = 'persistent-tab-auth-token'
// Persistent credentials are scoped too: another portal must not replace this role on restart.
function tokenPortal(token: string | null): string | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.type === 'customer') return 'customer'
    if (payload.type !== 'staff') return null
    const role = String(payload.role || '').toUpperCase()
    return role === 'DRIVER' ? 'driver' : role === 'WAREHOUSE_STAFF' ? 'warehouse' : ['ADMIN', 'SUPER_ADMIN'].includes(role) ? 'admin' : null
  } catch { return null }
}

function requestedPortal(): string | null {
  const match = window.location.pathname.match(/^\/(?:login\/)?(admin|warehouse|driver|customer)(?:\/|$)/)
  return match?.[1] || sessionStorage.getItem('tab-login-portal')
}
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
// Cancel old-session retries so they cannot publish data after an account change.
let apiReadSession = new AbortController()

function resetApiReadSession() {
  apiReadSession.abort()
  apiReadSession = new AbortController()
}

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
  // Absolute same-origin API URLs need the same auth and loading recovery as relative URLs.
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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
  resetApiReadSession()

  // Fix: keep the active credential tab-scoped even when "Remember me" is enabled.
  // Otherwise another portal login can overwrite localStorage and change this tab's role.
  sessionStorage.setItem(TAB_AUTH_TOKEN_KEY, token)

  if (persistent) {
    localStorage.setItem(PERSISTENT_TAB_AUTH_TOKEN_KEY, token)
    const portal = tokenPortal(token)
    if (portal) localStorage.setItem(`${PERSISTENT_TAB_AUTH_TOKEN_KEY}:${portal}`, token)
    return
  }

  const portal = tokenPortal(token)
  if (portal) localStorage.removeItem(`${PERSISTENT_TAB_AUTH_TOKEN_KEY}:${portal}`)
  localStorage.removeItem(PERSISTENT_TAB_AUTH_TOKEN_KEY)
}

export function getTabAuthToken(): string | null {
  const sessionToken = sessionStorage.getItem(TAB_AUTH_TOKEN_KEY)
  if (sessionToken) return sessionToken
  const portal = requestedPortal()
  const scoped = portal ? localStorage.getItem(`${PERSISTENT_TAB_AUTH_TOKEN_KEY}:${portal}`) : null
  if (scoped) return scoped
  const legacy = localStorage.getItem(PERSISTENT_TAB_AUTH_TOKEN_KEY)
  // Decode only to choose the credential; the server still verifies its signature.
  return !portal || tokenPortal(legacy) === portal ? legacy : null
}

export function hasPersistentTabAuthToken(): boolean {
  const token = getTabAuthToken()
  const portal = tokenPortal(token)
  return Boolean(token && (localStorage.getItem(PERSISTENT_TAB_AUTH_TOKEN_KEY) === token ||
    (portal && localStorage.getItem(`${PERSISTENT_TAB_AUTH_TOKEN_KEY}:${portal}`) === token)))
}

export function clearTabAuthToken() {
  clearApiResponseCache()
  resetApiReadSession()
  const token = getTabAuthToken()
  const portal = tokenPortal(token) || requestedPortal()
  if (portal) localStorage.removeItem(`${PERSISTENT_TAB_AUTH_TOKEN_KEY}:${portal}`)
  sessionStorage.removeItem(TAB_AUTH_TOKEN_KEY)
  if (localStorage.getItem(PERSISTENT_TAB_AUTH_TOKEN_KEY) === token) localStorage.removeItem(PERSISTENT_TAB_AUTH_TOKEN_KEY)
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
  const interceptorLifetime = new AbortController()
  fetchWindow.__originalFetch__ = originalFetch

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) {
      // Address lookup and route geometry also load portal information, but must
      // never receive our API authorization headers or enter the API response cache.
      const url = getApiUrl(input)
      if (getRequestMethod(input, init) === 'GET' && url?.protocol === 'https:' &&
        ['nominatim.openstreetmap.org', 'router.project-osrm.org'].includes(url.hostname)) {
        const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        return retryingApiRead(
          (signal) => originalFetch(input, { ...init, signal }),
          [apiReadSession.signal, interceptorLifetime.signal, ...(callerSignal ? [callerSignal] : [])],
        )
      }
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
    // Cookie-only sessions must keep the same portal on shared API endpoints.
    if (!headers.has('X-Portal')) {
      const portal = sessionStorage.getItem('tab-login-portal')
      if (portal && ['admin', 'warehouse', 'driver', 'customer'].includes(portal)) headers.set('X-Portal', portal)
    }

    const requestInit: RequestInit = {
      ...init,
      headers,
    }
    const method = getRequestMethod(input, init)

    // Any write can affect multiple portal views, so invalidate before sending it.
    if (method !== 'GET') {
      clearApiResponseCache()
      // Reads made while the write is pending may contain the old server state.
      return originalFetch(input, requestInit).finally(clearApiResponseCache)
    }

    const apiUrl = getApiUrl(input)
    // All portal GETs share recovery, including no-store reads and replacement details.
    // Keep the fetch unresolved until data arrives so existing loading UI stays active.
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const readSignals = [
      apiReadSession.signal,
      interceptorLifetime.signal,
      ...(callerSignal ? [callerSignal] : []),
    ]
    const read = () => retryingApiRead(
      (attemptSignal) => originalFetch(input, { ...requestInit, signal: attemptSignal }),
      readSignals,
    )
    const cacheTtl = apiUrl ? getApiCacheTtl(apiUrl.pathname) : 0
    const requestCache = init?.cache ?? (input instanceof Request ? input.cache : undefined)
    // Explicit revalidation must bypass the in-memory cache as well as HTTP caching.
    if (!apiUrl || cacheTtl <= 0 || init?.signal || ['no-store', 'reload', 'no-cache'].includes(requestCache || '')) {
      return read()
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
    const request = read()
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
    interceptorLifetime.abort()
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
