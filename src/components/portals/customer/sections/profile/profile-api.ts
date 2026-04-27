import { fetchJsonWithRetry } from '../shared/api-shared'

export function fetchCustomerProfile(customerId: string) {
  return fetchJsonWithRetry(`/api/customers/${customerId}`, {
    cache: 'no-store',
    credentials: 'include',
  })
}

export async function updateCustomerProfile(customerId: string, body: any) {
  const response = await fetch(`/api/customers/${customerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

export async function uploadCustomerAvatar(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch('/api/uploads/customer-avatar', {
    method: 'POST',
    body: formData,
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}
