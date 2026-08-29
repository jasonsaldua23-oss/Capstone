import { fetchJsonWithRetry } from '../shared/api-shared'

async function readReplacementApiResponse(response: Response, fallbackMessage: string) {
  const responseText = await response.text()
  if (responseText) {
    try {
      return JSON.parse(responseText)
    } catch {
      // Fix: preserve a useful message when a proxy or backend returns non-JSON.
      return { success: false, error: responseText.trim() || fallbackMessage }
    }
  }
  return {
    success: response.ok,
    error: response.ok ? undefined : `${fallbackMessage}${response.status ? ` (${response.status})` : ''}`,
  }
}

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

export async function uploadReplacementEvidence(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch('/api/uploads/replacement-evidence', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const data = await readReplacementApiResponse(response, 'Failed to upload replacement evidence')
  return { response, data }
}

export async function submitCustomerReplacementRequest(body: {
  orderId: string
  numberDamagedItems: number
  damageType: string
  description?: string
  evidence: string[]
  replacementLines?: Array<{
    originalOrderItemId: string
    mixedCaseComponentId?: string
    originalProductId?: string
    replacementProductId?: string
    originalProductName?: string
    originalProductSku?: string
    originalProductSize?: string
    replacementProductName?: string
    replacementProductSku?: string
    replacementProductSize?: string
    inputMode?: 'case' | 'bottle'
    lineInputMode?: 'case' | 'bottle'
    quantityPerCase?: number
    qtyPerUnit?: number
    quantityToReplace: number
    quantityToReplaceCases?: number
    quantityToReplaceUnits?: number
    quantityToReplaceBottles?: number
    reason: string
    description?: string
  }>
}) {
  const response = await fetch('/api/customer/replacements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await readReplacementApiResponse(response, 'Failed to submit replacement request')
  return { response, data }
}

export async function cancelCustomerReplacementRequest(replacementId: string) {
  const response = await fetch(`/api/customer/replacements/${encodeURIComponent(replacementId)}/cancel`, {
    method: 'POST',
    credentials: 'include',
  })
  const data = await readReplacementApiResponse(response, 'Failed to cancel replacement request')
  return { response, data }
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

export async function quoteMixedCase(body: {
  caseCapacity: number
  quantity: number
  components: Array<{ productId: string; quantity: number }>
}) {
  const response = await fetch('/api/mixed-cases/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function receiveReplacementReturn(
  replacementId: string,
  body: {
    requestId: string
    returnedLines: Array<{ replacementLineId: string; quantityBaseUnits: number }>
  }
) {
  const response = await fetch(`/api/replacements/${replacementId}/receive-return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function cancelCustomerOrder(orderId: string, reason: string) {
  const response = await fetch(`/api/customer/orders/${orderId}/cancel`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    // Required: persist the customer's stated cancellation reason with the order.
    body: JSON.stringify({ reason }),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}
