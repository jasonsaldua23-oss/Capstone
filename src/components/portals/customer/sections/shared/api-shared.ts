export async function fetchJsonWithRetry(input: RequestInfo | URL, init?: RequestInit, retries = 5) {
  let lastResponse: Response | null = null
  let lastData: any = {}

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(input, init)
      const data = await response.json().catch(() => ({}))
      lastResponse = response
      lastData = data
      if (response.ok && data?.success !== false) {
        return { response, data }
      }
      if (response?.status === 401 || response?.status === 403) {
        return { response, data }
      }
    } catch (error) {
      lastData = { error: error instanceof Error ? error.message : 'Request failed' }
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)))
    }
  }

  return { response: lastResponse, data: lastData }
}
