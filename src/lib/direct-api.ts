/**
 * Sends portal API calls straight to the API server instead of through the website.
 *
 * Production pages come from Hostinger in the US, which relays /api/* to the API
 * server in Singapore. On 2026-10-01 that relay lost replies: Django answered every
 * POD upload and stop save, nginx handed each reply to Hostinger, the phone received
 * none of them, and the shared writer kept resending while "Confirming delivery" spun
 * for minutes. A call carrying the tab's Bearer token needs no cookies, so it can skip
 * the relay. The backend allows this origin and the portal's headers
 * (CORS_ALLOW_HEADERS in backend/config/settings.py).
 */

/** Website origin -> the API host its pages may call directly. */
export const DIRECT_API_ORIGINS: Readonly<Record<string, string>> = {
  'https://annannsbeveragestrading.com': 'https://api.annannsbeveragestrading.com',
}

/** After a direct call fails, use the website relay for this long before trying direct again. */
export const DIRECT_API_RETRY_AFTER_MS = 60_000

type Send = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** The API host this page may call directly; NEXT_PUBLIC_API_ORIGIN overrides the map. */
export function resolveDirectApiOrigin(pageOrigin: string, configuredOrigin?: string | null): string | null {
  const configured = String(configuredOrigin || '').trim().replace(/\/+$/, '')
  return configured || DIRECT_API_ORIGINS[pageOrigin] || null
}

export function createApiSender({
  send,
  pageOrigin,
  configuredOrigin,
  now = Date.now,
}: {
  send: Send
  pageOrigin: string
  configuredOrigin?: string | null
  now?: () => number
}) {
  const directOrigin = resolveDirectApiOrigin(pageOrigin, configuredOrigin)
  let directRetryAt = 0

  /** Sends one attempt of a same-origin /api/ call. */
  return (input: RequestInfo | URL, init: RequestInit, hasToken: boolean): Promise<Response> => {
    const url = typeof input === 'string' || input instanceof URL ? new URL(String(input), pageOrigin) : null
    const direct = Boolean(
      directOrigin &&
      // Without a token the session lives in the website's HttpOnly cookies.
      hasToken &&
      url &&
      url.origin === pageOrigin &&
      url.pathname.startsWith('/api/') &&
      // Sign-in, restore and logout set or clear those cookies, so they stay on the website.
      !url.pathname.startsWith('/api/auth/') &&
      now() >= directRetryAt,
    )
    if (!direct || !url) return send(input, init)

    return send(`${directOrigin}${url.pathname}${url.search}`, { ...init, credentials: 'omit' }).catch((error: unknown) => {
      // A refused CORS preflight looks exactly like a dropped connection, so resend
      // through the website instead of failing the action.
      if (!(error instanceof TypeError) || init.signal?.aborted) throw error
      directRetryAt = now() + DIRECT_API_RETRY_AFTER_MS
      return send(input, init)
    })
  }
}
