import { fetchJsonWithRetry } from '../shared/api-shared'

export function fetchFeedbackMeta() {
  return fetchJsonWithRetry('/api/feedback?page=1&limit=500', { cache: 'no-store' })
}

export async function submitOrderFeedback(body: any) {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}
