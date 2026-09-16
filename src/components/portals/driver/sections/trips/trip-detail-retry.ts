// Mobile radios can briefly lose a response after the server has accepted it.
// Only retry transport, timeout, throttling, and server failures automatically.
export const waitForDriverWriteRetry = (attempt: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4)))
})

export const isAutomaticallyRetryableWriteStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500
