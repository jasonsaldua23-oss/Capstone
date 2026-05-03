import { fetchJsonWithRetry } from '../shared/api-shared'
import { getTabAuthToken } from '@/lib/client-auth'

export function fetchFeedbackMeta() {
  return fetchJsonWithRetry('/api/feedback?page=1&limit=500', { cache: 'no-store' })
}

export async function submitOrderFeedback(body: any) {
  const token = getTabAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch('/api/feedback', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}
