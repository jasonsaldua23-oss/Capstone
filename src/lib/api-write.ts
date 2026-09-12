const rejectedRequest = 'The server rejected this request. Check the entered information and try again.'

type ApiWriteOptions = {
  retryDelayMs?: number
}

const waitForRetry = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs)
})

export async function apiWrite(
  send: () => Promise<Response>,
  options: ApiWriteOptions = {},
): Promise<Response> {
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 3000)

  while (true) {
    let response: Response
    try {
      response = await send()
    } catch (error) {
      // Abort and programming errors must still reach their existing handlers.
      if (!(error instanceof TypeError)) throw error
      // Fix: keep the caller's loading state pending through temporary connection loss.
      await waitForRetry(retryDelayMs)
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
      payload.success !== false && !payload.dbUnavailable) return response

    const temporarilyUnconfirmed =
      response.ok ||
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500 ||
      Boolean(payload?.dbUnavailable)
    if (temporarilyUnconfirmed) {
      // A temporary/malformed response leaves the original fetch promise pending,
      // so buttons and forms keep showing their existing loading state until success.
      await waitForRetry(retryDelayMs)
      continue
    }

    const fallback = response.status === 401
      ? 'Your session could not be verified. Sign in again before continuing.'
      : response.status === 403
        ? 'This action was denied. Check your account permissions.'
        : rejectedRequest
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
      error: message,
    }), {
      status: response.status,
      headers,
    })
  }
}
