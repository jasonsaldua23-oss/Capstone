import { fetchJsonWithRetry } from '../shared/api-shared'

export function fetchCustomerOrders(page = 1, pageSize = 100) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })

  return fetchJsonWithRetry(`/api/customer/orders?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'include',
  })
}

export async function fetchAllCustomerOrders(pageSize = 100) {
  const first = await fetchCustomerOrders(1, pageSize)
  const firstResponse = first.response
  const firstData = first.data

  if (!firstResponse?.ok || firstData?.success === false) {
    return { response: firstResponse, data: firstData }
  }

  const totalPages = Math.max(1, Number(firstData?.totalPages || 1))
  let orders = Array.isArray(firstData?.orders) ? [...firstData.orders] : []

  if (totalPages > 1) {
    const pageNumbers = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2)
    const pageResults = await Promise.all(pageNumbers.map((page) => fetchCustomerOrders(page, pageSize)))
    for (const next of pageResults) {
      if (!next.response?.ok || next.data?.success === false) {
        return { response: next.response, data: next.data }
      }
    }
    for (const next of pageResults) {
      const pageOrders = Array.isArray(next.data?.orders) ? next.data.orders : []
      orders = orders.concat(pageOrders)
    }
  }

  return {
    response: firstResponse,
    data: {
      ...firstData,
      orders,
    },
  }
}

export function fetchReplacementsMeta() {
  return fetchJsonWithRetry('/api/replacements?limit=300', { cache: 'no-store' })
}

export function fetchLegacyCustomerReplacements() {
  return fetchJsonWithRetry('/api/customer/replacements', { cache: 'no-store' })
}

export async function fetchCustomerTracking() {
  const response = await fetch('/api/customer/tracking', { credentials: 'include' })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function createCustomerOrder(body: any) {
  const response = await fetch('/api/customer/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function cancelCustomerOrder(orderId: string) {
  const response = await fetch(`/api/customer/orders/${orderId}/cancel`, {
    method: 'PATCH',
    credentials: 'include',
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}
