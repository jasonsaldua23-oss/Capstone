export class LocationUploadRejected extends Error {}

/** Keep only the newest unsent fix; serialized retries cannot send the truck backwards. */
export function createLatestLocationUploader<T>(send: (value: T, signal: AbortSignal) => Promise<void>, retryMs = 2500) {
  let latest: { value: T } | null = null
  let busy = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  const pump = async () => {
    if (busy || stopped || !latest) return
    if (timer) clearTimeout(timer)
    timer = null
    busy = true
    const sending = latest
    controller = new AbortController()
    const timeout = setTimeout(() => controller?.abort(), 10000)
    let failed = false
    try {
      await send(sending.value, controller.signal)
      if (latest === sending) latest = null
    } catch (error) {
      if (error instanceof LocationUploadRejected && latest === sending) latest = null
      else failed = true
    } finally {
      clearTimeout(timeout)
      busy = false
      if (!stopped && latest) timer = setTimeout(() => void pump(), failed ? retryMs : 0)
    }
  }
  return {
    // Preserve retry backoff while replacing a failed sample with newer GPS.
    enqueue(value: T) { if (!stopped) { latest = { value }; if (!timer) void pump() } },
    resume() { void pump() },
    clear() { stopped = true; latest = null; controller?.abort(); if (timer) clearTimeout(timer) },
  }
}
