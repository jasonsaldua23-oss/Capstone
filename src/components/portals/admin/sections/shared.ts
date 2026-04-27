'use client'

import { getTabAuthToken } from '@/lib/client-auth'

export function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

export function getDefaultRouteDate() {
  const now = new Date()
  now.setDate(now.getDate() + 1)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function normalizeTripStatus(status: unknown) {
  const value = String(status || '').toUpperCase()
  return value === 'IN_TRANSIT' ? 'IN_PROGRESS' : value
}

export function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

export function formatDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toIsoDateTime(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function formatDateTime(value: unknown) {
  const iso = toIsoDateTime(value)
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleString()
}

export function formatDayLabel(value: unknown) {
  const iso = toIsoDateTime(value)
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function withinRange(value: unknown, startAt: Date) {
  const iso = toIsoDateTime(value)
  if (!iso) return false
  return new Date(iso).getTime() >= startAt.getTime()
}

export function getWarehouseIdFromRow(row: any) {
  const value = row?.warehouseId ?? row?.warehouse_id ?? row?.warehouse?.id ?? row?.warehouse
  return typeof value === 'object' && value !== null ? String(value.id || '') : String(value || '')
}

export function formatRoleLabel(role: string | null | undefined) {
  const value = String(role || '').trim().toUpperCase()
  if (value === 'SUPER_ADMIN') return 'ADMIN'
  return value || 'N/A'
}

export async function safeFetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
): Promise<{ ok: boolean; status: number; data: any }> {
  const retries = options?.retries ?? 1
  const timeoutMs = options?.timeoutMs ?? 12000

  let attempt = 0
  while (attempt <= retries) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }

      const response = await fetch(input, {
        cache: 'no-store',
        credentials: 'include',
        ...init,
        headers,
        signal: controller.signal,
      })

      const text = await response.text()
      const data = text ? JSON.parse(text) : {}
      return { ok: response.ok && data?.success !== false, status: response.status, data }
    } catch (error) {
      if (attempt === retries) {
        const message = error instanceof Error ? error.message : 'Request failed'
        return { ok: false, status: 0, data: { error: message } }
      }
      attempt += 1
    } finally {
      window.clearTimeout(timer)
    }
  }

  return { ok: false, status: 0, data: { error: 'Request failed' } }
}
