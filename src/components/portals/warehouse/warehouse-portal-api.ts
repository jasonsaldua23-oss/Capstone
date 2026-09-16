import { getTabAuthToken } from '@/lib/client-auth'

/**
 * Resilient JSON fetch for the warehouse portal: retries transient failures and read timeouts while section loaders remain pending.
 */

export const safeFetchJson = async (
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
) => {
  const retries = options?.retries ?? 5
  const timeoutMs = options?.timeoutMs ?? 12000
  // Read timeouts retry in the shared fetch layer while section loaders remain pending.
  const isRead = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'GET'
  let lastError = 'Request failed'
  let lastStatus = 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = isRead ? undefined : window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      const response = await fetch(input, {
        ...(init || {}),
        headers,
        credentials: init?.credentials ?? 'include',
        signal: isRead ? (init?.signal ?? (input instanceof Request ? input.signal : undefined)) : controller.signal,
      })
      lastStatus = response.status
      const data = await response.json().catch(() => ({}))
      const dbUnavailable = Boolean(data?.dbUnavailable)
      if (response.ok && data?.success !== false && !dbUnavailable) {
        return { ok: true as const, data, status: response.status }
      }
      lastError = data?.error || `Request failed (${response.status})`
      const nonRetriable =
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 405 ||
        response.status === 409 ||
        response.status === 410 ||
        response.status === 422
      if (nonRetriable) {
        return { ok: false as const, data, status: response.status, error: lastError }
      }
    } catch (error: any) {
      lastError = error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed'
    } finally {
      window.clearTimeout(timeout)
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)))
    }
  }

  return { ok: false as const, data: null, status: lastStatus, error: lastError }
}
