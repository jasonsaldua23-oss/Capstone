// A lost response does not prove a save failed; never replay a mutation automatically.
const unconfirmedSave = 'The server did not confirm this action. Check the latest record before submitting again.'

export async function apiWrite(
  send: () => Promise<Response>,
): Promise<Response> {
  let response: Response
  try {
    response = await send()
  } catch (error) {
    // Preserve deliberate cancellation and programming errors for their existing handlers.
    if (!(error instanceof TypeError)) throw error
    throw new Error(`Connection interrupted. ${unconfirmedSave}`)
  }

  // No-content responses are valid for endpoints that intentionally return no body.
  if (response.status === 204 || response.status === 205) return response
  let payload: any
  try {
    payload = await response.clone().json()
  } catch {
    // Proxy HTML, truncated JSON and empty bodies must never trigger success UI.
    payload = null
  }
  if (response.ok && payload !== null && typeof payload === 'object' &&
    payload.success !== false && !payload.dbUnavailable) return response

  const fallback = response.status === 401
    ? 'Your session could not be verified. Sign in again before continuing.'
    : response.status === 403
      ? 'This action was denied. Check your account permissions.'
      : response.status === 429
        ? 'Too many requests. Wait a moment before trying again.'
        : unconfirmedSave
  const detail = payload?.error || payload?.message || payload?.detail
  const message = typeof detail === 'string' && detail.trim() ? detail : fallback
  const headers = new Headers(response.headers)
  // Preserve retry/authentication/support headers while replacing the response body.
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')
  // Return JSON errors for the existing portal handlers, retaining validation fields.
  // A malformed 2xx response is a gateway failure, not a confirmed save.
  return new Response(JSON.stringify({
    ...(payload && typeof payload === 'object' ? payload : {}),
    success: false,
    error: message,
  }), {
    status: response.ok ? 502 : response.status,
    headers,
  })
}
