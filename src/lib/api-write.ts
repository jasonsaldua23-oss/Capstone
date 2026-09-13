const rejectedRequest = 'The server rejected this request. Check the entered information and try again.'

type ApiWriteOptions = {
  retryDelayMs?: number
  fallbackError?: string | null
}

export async function apiWrite(
  send: () => Promise<Response>,
  options: ApiWriteOptions = {},
): Promise<Response> {
  // Fix: an ambiguous write may already be committed; never replay it automatically.
  {
    let response: Response
    try {
      response = await send()
    } catch (error) {
      // Abort and programming errors must still reach their existing handlers.
      if (!(error instanceof TypeError)) throw error
      throw new Error('The request could not be confirmed. Refresh the record before submitting again.')
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

    if (response.ok) {
      throw new Error('The server response could not confirm this save. Refresh the record before submitting again.')
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
