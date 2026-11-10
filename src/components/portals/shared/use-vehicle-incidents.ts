'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import {
  parseIncident,
  parseIncidents,
  sortIncidents,
  type VehicleIncident,
  type VehicleIncidentOutcome,
} from '@/lib/vehicle-incidents'

export type IncidentResponse =
  | { action: 'ACKNOWLEDGE' }
  | { action: 'RESOLVE'; outcome: VehicleIncidentOutcome; notes: string }

/**
 * The incidents a portal may see: a day's, plus any still open (see GET /api/incidents),
 * or one trip's. Refreshed whenever the server's `incidents` scope moves, so a report
 * made on a driver's phone reaches every open map within a poll.
 */
export function useVehicleIncidents({
  date,
  tripId,
  status,
  enabled = true,
}: {
  date?: string
  tripId?: string
  /** Only the open ones, or only the resolved ones; all of them when omitted. */
  status?: 'open' | 'resolved'
  enabled?: boolean
}) {
  const [incidents, setIncidents] = useState<VehicleIncident[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  // Only the newest request may write: a slow answer for the previous date must not
  // replace the one for the date now selected.
  const latestRequestRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const requestNumber = latestRequestRef.current + 1
    latestRequestRef.current = requestNumber
    const params = new URLSearchParams({ pageSize: '100' })
    if (date) params.set('date', date)
    if (tripId) params.set('tripId', tripId)
    if (status) params.set('status', status)
    try {
      const response = await fetch(`/api/incidents?${params.toString()}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (requestNumber !== latestRequestRef.current) return
      if (response.ok && payload?.success !== false) setIncidents(parseIncidents(payload?.incidents))
    } catch {
      // Keep the last list on screen; the next sync tick or focus tries again.
    } finally {
      if (requestNumber === latestRequestRef.current) setIsLoading(false)
    }
  }, [date, enabled, status, tripId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const unsubscribe = subscribeDataSync((message) => {
      if ((message.scopes || []).includes('incidents')) void refresh()
    })
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [enabled, refresh])

  /** Acknowledge or resolve; throws with the server's reason when it is refused. */
  const respond = useCallback(async (incidentId: string, body: IncidentResponse) => {
    const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success === false) {
      throw new Error(String(payload?.error || 'The incident could not be updated. Please try again.'))
    }
    const updated = parseIncident(payload?.incident)
    if (updated) {
      setIncidents((current) => sortIncidents(current.map((row) => (row.id === updated.id ? updated : row))))
    }
    emitDataSync(['incidents'])
    return updated
  }, [])

  return { incidents, isLoading, refresh, respond }
}
