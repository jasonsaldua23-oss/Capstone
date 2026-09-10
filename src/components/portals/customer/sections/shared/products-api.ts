import { fetchJsonWithRetry } from './api-shared'

export async function fetchCustomerProducts() {
  const options: RequestInit = {
    cache: 'no-store',
    credentials: 'include',
  }
  const first = await fetchJsonWithRetry('/api/products?page=1&pageSize=100', options)
  if (!first.response?.ok || first.data?.success === false) return first
  const products = [...(first.data?.products || first.data?.data || [])]
  // New sessions have no previous catalog snapshot: load all pages before publishing it.
  for (let page = 2; page <= Number(first.data?.totalPages || 1); page += 1) {
    const next = await fetchJsonWithRetry(`/api/products?page=${page}&pageSize=100`, options)
    if (!next.response?.ok || next.data?.success === false) return next
    products.push(...(next.data?.products || next.data?.data || []))
  }
  return { ...first, data: { ...first.data, products } }
}
