import { fetchJsonWithRetry } from './api-shared'

export function fetchCustomerProducts() {
  return fetchJsonWithRetry('/api/products?page=1&pageSize=100', {
    cache: 'no-store',
    credentials: 'include',
  })
}
