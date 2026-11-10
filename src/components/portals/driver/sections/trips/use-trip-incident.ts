'use client'

import { useCallback, useMemo } from 'react'
import { prepareImageForUpload } from '@/lib/client-image'
import { emitDataSync } from '@/lib/data-sync'
import { parseIncident, vehicleStoppedBy, type VehicleIncident, type VehicleIncidentType } from '@/lib/vehicle-incidents'
import { useVehicleIncidents } from '@/components/portals/shared/use-vehicle-incidents'
import type { DriverGpsLocation } from './trip-detail-helpers'
import {
  isFreshRecordedAt,
  isValidDeviceCoordinate,
  MAX_REAL_CURRENT_LOCATION_AGE_MS,
  toRecordedAtMs,
} from './trip-detail-location'
import { isAutomaticallyRetryableWriteStatus, waitForDriverWriteRetry } from './trip-detail-retry'

export type IncidentReportInput = {
  /** One per report, reused by every retry of it, so a lost reply never files it twice. */
  requestId: string
  type: VehicleIncidentType
  vehicleCanContinue: boolean
  description: string
  photo: File | null
}

// Retries back off 1, 2, 4 and 8 s: about a quarter of a minute before the driver is
// told to resend or phone instead. An emergency report must not spin for ever.
const MAX_ATTEMPTS = 5

class IncidentReportError extends Error {}

/** The phone's own position, if it is a recent real fix; otherwise the server uses the trip's last GPS update. */
export function reportableLocation(location: DriverGpsLocation | null) {
  const lat = Number(location?.lat)
  const lng = Number(location?.lng)
  if (!isValidDeviceCoordinate(lat, lng) || !isFreshRecordedAt(location?.recordedAt, MAX_REAL_CURRENT_LOCATION_AGE_MS)) {
    return null
  }
  const accuracy = Number(location?.accuracy)
  return {
    latitude: lat,
    longitude: lng,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    recordedAt: toRecordedAtMs(location?.recordedAt) ?? Date.now(),
  }
}

async function withRetries<T>(attemptOnce: () => Promise<T | undefined>, offlineMessage: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await attemptOnce()
      if (result !== undefined) return result
    } catch (error) {
      // A refusal from the server is final; anything else is the connection.
      if (error instanceof IncidentReportError) throw error
    }
    if (attempt < MAX_ATTEMPTS - 1) await waitForDriverWriteRetry(attempt)
  }
  throw new IncidentReportError(offlineMessage)
}

async function uploadIncidentPhoto(file: File): Promise<string> {
  const prepared = await prepareImageForUpload(file)
  return withRetries(async () => {
    const formData = new FormData()
    formData.append('file', prepared)
    const response = await fetch('/api/incidents/photo', { method: 'POST', body: formData })
    const payload = await response.json().catch(() => ({}))
    if (response.ok && payload?.imageUrl) return String(payload.imageUrl)
    if (!isAutomaticallyRetryableWriteStatus(response.status)) {
      throw new IncidentReportError(String(payload?.error || 'The photo could not be uploaded'))
    }
    return undefined
  }, 'No connection: the photo could not be uploaded. Try again, or send the report without it.')
}

/** The trip's incidents, the one still open (if any), whether it stops the truck, and how to report a new one. */
export function useTripIncident({
  tripId,
  enabled,
  currentLocation,
}: {
  tripId: string
  enabled: boolean
  currentLocation: DriverGpsLocation | null
}) {
  const { incidents, isLoading, refresh } = useVehicleIncidents({ tripId, enabled })
  const openIncident = useMemo(() => incidents.find((incident) => incident.isOpen) || null, [incidents])
  // A truck that cannot move keeps the driver from reaching another stop.
  const stoppedBy = useMemo(() => vehicleStoppedBy(incidents), [incidents])

  const reportIncident = useCallback(
    async (input: IncidentReportInput): Promise<{ incident: VehicleIncident; alreadyOpen: boolean }> => {
      const photoUrl = input.photo ? await uploadIncidentPhoto(input.photo) : null
      const location = reportableLocation(currentLocation)
      const body = JSON.stringify({
        requestId: input.requestId,
        tripId,
        type: input.type,
        vehicleCanContinue: input.vehicleCanContinue,
        description: input.description,
        photoUrl,
        ...(location || {}),
      })
      const result = await withRetries(async () => {
        const response = await fetch('/api/incidents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        const payload = await response.json().catch(() => ({}))
        const incident = parseIncident(payload?.incident)
        if (response.ok && incident) return { incident, alreadyOpen: false }
        // Someone (perhaps this same driver, on another device) already reported it.
        if (response.status === 409 && incident) return { incident, alreadyOpen: true }
        if (!isAutomaticallyRetryableWriteStatus(response.status)) {
          throw new IncidentReportError(String(payload?.error || 'The incident could not be reported'))
        }
        return undefined
      }, 'No connection: the report was not sent. Try again, or call the warehouse.')
      emitDataSync(['incidents'])
      void refresh()
      return result
    },
    [currentLocation, refresh, tripId]
  )

  return { incidents, openIncident, stoppedBy, isLoading, reportIncident }
}
