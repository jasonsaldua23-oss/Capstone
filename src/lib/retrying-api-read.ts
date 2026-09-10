// Keep portal loaders pending through outages; writes must never use this helper.
export async function retryingApiRead(
  fetchRead: (attemptSignal: AbortSignal) => Promise<Response>,
  signals: AbortSignal | AbortSignal[],
) {
  // Capacitor WebViews can lag behind desktop browsers: use basic abort listeners,
  // rather than requiring AbortSignal.any/timeout/throwIfAborted to load every section.
  const parents = Array.isArray(signals) ? signals : [signals]
  const lifetime = new AbortController()
  const abort = () => lifetime.abort(parents.find((parent) => parent.aborted)?.reason)
  parents.forEach((parent) => parent.addEventListener('abort', abort, { once: true }))
  if (parents.some((parent) => parent.aborted)) abort()
  const signal = lifetime.signal
  const checkCancelled = () => {
    if (signal.aborted) throw signal.reason || new DOMException('Request cancelled', 'AbortError')
  }
  let attempt = 0
  try {
    while (true) {
      checkCancelled()
      const controller = new AbortController()
      const abortAttempt = () => controller.abort(signal.reason)
      signal.addEventListener('abort', abortAttempt, { once: true })
      const timeout = setTimeout(() => controller.abort(), 20_000)
      try {
        // A hung connection must also retry, without ending the caller's loading state.
        const response = await fetchRead(controller.signal)
        checkCancelled()
        // Authentication, permissions and invalid requests still need their existing handling.
        if (!response.ok && response.status !== 408 && response.status !== 429 && response.status < 500) {
          return response
        }
        if (response.ok) {
          const contentType = response.headers.get('content-type') || ''
          if (response.status === 204 || (!contentType.includes('json') && !contentType.includes('text/html'))) {
            return response
          }
          // Validate a clone so truncated JSON/proxy HTML cannot end a section's loading state.
          const data = await response.clone().json()
          checkCancelled()
          if (data?.success !== false && !data?.dbUnavailable) return response
        }
      } catch (error) {
        checkCancelled()
        // Only failed network/body reads are retried; programming errors remain visible.
        if (!(error instanceof TypeError) && !(error instanceof SyntaxError) &&
          !(error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))) throw error
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abortAttempt)
      }

      // Retry indefinitely with capped backoff, and release timers when the request is cancelled.
      const delay = Math.min(1000 * 2 ** Math.min(attempt++, 5), 30_000)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, delay)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
    }
  } finally {
    parents.forEach((parent) => parent.removeEventListener('abort', abort))
  }
}
