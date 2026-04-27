import { fetchJsonWithRetry } from '../shared/api-shared'

export function fetchCustomerOrders() {
  return fetchJsonWithRetry('/api/customer/orders', {
    cache: 'no-store',
    credentials: 'include',
  })
}

export function fetchReplacementsMeta() {
  return fetchJsonWithRetry('/api/replacements?limit=300', { cache: 'no-store' })
}

export function fetchLegacyCustomerReplacements() {
  return fetchJsonWithRetry('/api/customer/replacements', { cache: 'no-store' })
}

export async function fetchCustomerTracking() {
  const response = await fetch('/api/customer/tracking')
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function createCustomerOrder(body: any) {
  const response = await fetch('/api/customer/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function cancelCustomerOrder(orderId: string) {
  const response = await fetch(`/api/customer/orders/${orderId}/cancel`, {
    method: 'PATCH',
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}
