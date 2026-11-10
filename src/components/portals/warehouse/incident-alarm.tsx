'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCheck, Loader2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useVehicleIncidents } from '@/components/portals/shared/use-vehicle-incidents'
import { alarmHeadline, alarmingIncidents } from '@/lib/incident-alarm'
import { getIncidentSiren } from '@/lib/incident-siren'
import { vehicleConditionLabel, type VehicleIncident } from '@/lib/vehicle-incidents'

const subscribeSiren = (listener: () => void) => getIncidentSiren()?.subscribe(listener) ?? (() => undefined)
const sirenBlocked = () => getIncidentSiren()?.isBlocked() ?? false
const formatTime = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The warehouse emergency alarm: while a driver's accident or vehicle-damage report
 * from one of this warehouse's trips is unacknowledged, a siren sounds and a red alert
 * covers the portal. Acknowledging it (here, or on any other laptop) stops both.
 */
export function IncidentAlarm({ onOpenMap }: { onOpenMap: () => void }) {
  const { incidents, respond } = useVehicleIncidents({ status: 'open' })
  const ringing = useMemo(() => alarmingIncidents(incidents), [incidents])
  const isRinging = ringing.length > 0
  const soundBlocked = useSyncExternalStore(subscribeSiren, sirenBlocked, () => false)
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Any click or key in the portal lets a later alarm make sound (browser rule).
  useEffect(() => {
    const unlock = () => getIncidentSiren()?.unlock()
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
    }
  }, [])

  useEffect(() => {
    const siren = getIncidentSiren()
    if (isRinging) siren?.start()
    else siren?.stop()
  }, [isRinging])

  // Signing out, or leaving the portal, silences it.
  useEffect(() => () => getIncidentSiren()?.stop(), [])

  const acknowledge = async (incident: VehicleIncident) => {
    setAcknowledgingId(incident.id)
    setErrors((current) => ({ ...current, [incident.id]: '' }))
    try {
      await respond(incident.id, { action: 'ACKNOWLEDGE' })
      toast.success(`${incident.incidentNumber} acknowledged. ${incident.driverName} has been told.`)
      onOpenMap()
    } catch (error) {
      // It keeps ringing: nobody has acknowledged it yet.
      setErrors((current) => ({
        ...current,
        [incident.id]: error instanceof Error ? error.message : 'Could not acknowledge. Check the connection and try again.',
      }))
    } finally {
      setAcknowledgingId(null)
    }
  }

  if (!isRinging) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incident-alarm-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-red-950/90 p-4 backdrop-blur-sm"
    >
      <div className="max-h-full w-full max-w-lg space-y-3 overflow-y-auto">
        <p id="incident-alarm-title" className="text-center text-sm font-bold uppercase tracking-[0.18em] text-red-100">
          {ringing.length > 1 ? `${ringing.length} emergencies reported` : 'Emergency reported'}
        </p>
        {soundBlocked ? (
          <p className="flex items-center justify-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white">
            <Volume2 className="size-4 shrink-0" aria-hidden="true" />
            Click anywhere to sound the alarm
          </p>
        ) : null}
        {ringing.map((incident, index) => (
          <section
            key={incident.id}
            aria-label={`${alarmHeadline(incident)} ${incident.incidentNumber}`}
            className="rounded-2xl border-4 border-red-600 bg-white p-5 text-center shadow-2xl"
          >
            <AlertTriangle className="mx-auto size-10 text-red-600 motion-safe:animate-pulse" aria-hidden="true" />
            <h2 className="mt-2 text-xl font-black tracking-wide text-red-700">{alarmHeadline(incident)}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {incident.driverName} · {incident.vehiclePlate} · {incident.tripNumber}
            </p>
            <p className="text-sm text-slate-700">
              {vehicleConditionLabel(incident.vehicleCanContinue)}
              {formatTime(incident.reportedAt) ? ` · ${formatTime(incident.reportedAt)}` : ''}
            </p>
            {incident.description ? (
              <p className="mt-2 text-sm italic text-slate-600">&ldquo;{incident.description}&rdquo;</p>
            ) : null}
            {errors[incident.id] ? (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {errors[incident.id]}
              </p>
            ) : null}
            <Button
              autoFocus={index === 0}
              className="mt-4 h-11 w-full bg-red-600 text-base font-bold text-white hover:bg-red-700"
              disabled={acknowledgingId === incident.id}
              onClick={() => void acknowledge(incident)}
            >
              {acknowledgingId === incident.id ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              Acknowledge &amp; open map
            </Button>
          </section>
        ))}
      </div>
    </div>
  )
}
