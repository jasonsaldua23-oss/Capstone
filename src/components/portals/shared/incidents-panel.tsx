'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCheck, Loader2, MapPin, ShieldCheck, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import { ACTION_ADVANCE, ACTION_DECIDE } from '@/components/portals/shared/row-actions'
import {
  INCIDENT_OUTCOME_OPTIONS,
  incidentLocationNote,
  incidentOutcomeLabel,
  incidentProgressLabel,
  incidentStatusLabel,
  incidentTypeLabel,
  vehicleConditionLabel,
  type VehicleIncident,
  type VehicleIncidentOutcome,
} from '@/lib/vehicle-incidents'
import type { IncidentResponse } from './use-vehicle-incidents'

const NOTES_MAX_LENGTH = 1000

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''

const formatWhen = (iso: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? formatTime(iso)
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Accidents read red and vehicle damage amber, on the map and here alike.
const TONE_CLASSES = {
  ACCIDENT: { bar: 'bg-red-600', icon: 'text-red-600', ring: 'ring-red-200' },
  VEHICLE_DAMAGE: { bar: 'bg-amber-500', icon: 'text-amber-600', ring: 'ring-amber-200' },
} as const

const STATUS_CLASSES = {
  REPORTED: 'bg-red-50 text-red-700 ring-red-200',
  ACKNOWLEDGED: 'bg-amber-50 text-amber-800 ring-amber-200',
  RESOLVED: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const

/**
 * The incidents section of the Live Tracking details panel. `onRespond` is passed
 * only by the warehouse portal; each incident's own `canManage` (decided by the
 * server from the trip's warehouse) still gates its buttons.
 */
export function IncidentsList({
  incidents,
  isLoading,
  onRespond,
}: {
  incidents: VehicleIncident[]
  isLoading: boolean
  onRespond?: (incidentId: string, body: IncidentResponse) => Promise<unknown>
}) {
  const [resolving, setResolving] = useState<VehicleIncident | null>(null)
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)

  if (isLoading && incidents.length === 0) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="size-4 animate-spin" />
        Loading incidents...
      </p>
    )
  }
  if (incidents.length === 0) {
    return <p className="text-sm text-slate-500">No accidents or vehicle damage reported</p>
  }

  const acknowledge = async (incident: VehicleIncident) => {
    if (!onRespond) return
    setAcknowledgingId(incident.id)
    try {
      await onRespond(incident.id, { action: 'ACKNOWLEDGE' })
      toast.success(`${incident.incidentNumber} acknowledged. ${incident.driverName} has been told.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The incident could not be acknowledged')
    } finally {
      setAcknowledgingId(null)
    }
  }

  return (
    <div className="space-y-2">
      {incidents.map((incident) => (
        <IncidentCard
          key={incident.id}
          incident={incident}
          canRespond={Boolean(onRespond) && incident.canManage}
          acknowledging={acknowledgingId === incident.id}
          onAcknowledge={() => void acknowledge(incident)}
          onResolve={() => setResolving(incident)}
        />
      ))}
      <ResolveIncidentDialog
        incident={resolving}
        onClose={() => setResolving(null)}
        onSubmit={async (outcome, notes) => {
          if (!onRespond || !resolving) return
          await onRespond(resolving.id, { action: 'RESOLVE', outcome, notes })
          toast.success(`${resolving.incidentNumber} resolved.`)
          setResolving(null)
        }}
      />
    </div>
  )
}

function IncidentCard({
  incident,
  canRespond,
  acknowledging,
  onAcknowledge,
  onResolve,
}: {
  incident: VehicleIncident
  canRespond: boolean
  acknowledging: boolean
  onAcknowledge: () => void
  onResolve: () => void
}) {
  const tone = TONE_CLASSES[incident.type]
  const hasLocation = incident.latitude !== null && incident.longitude !== null
  return (
    <article
      aria-label={`${incidentTypeLabel(incident.type)} ${incident.incidentNumber}`}
      className={`relative overflow-hidden rounded-xl bg-slate-50 p-2.5 pl-3.5 ${incident.isOpen ? `ring-1 ${tone.ring}` : ''}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${incident.isOpen ? tone.bar : 'bg-slate-300'}`} />
      <div className="flex items-start gap-2">
        <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${incident.isOpen ? tone.icon : 'text-slate-400'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">
              {incidentTypeLabel(incident.type)}
              <span className="ml-1.5 whitespace-nowrap text-xs font-normal tabular-nums text-slate-500">{incident.incidentNumber}</span>
            </p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_CLASSES[incident.status]}`}>
              {incidentStatusLabel(incident.status)}
            </span>
          </div>
          <p className="truncate text-xs text-slate-600">
            {incident.driverName} · {incident.vehiclePlate || 'No plate'} · {incident.tripNumber}
          </p>
          <p className="text-xs text-slate-500">
            Reported {formatWhen(incident.reportedAt)} ·{' '}
            <span className={incident.vehicleCanContinue ? 'text-slate-600' : 'font-medium text-red-700'}>
              {vehicleConditionLabel(incident.vehicleCanContinue)}
            </span>
          </p>
        </div>
      </div>

      <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{incident.description}</p>

      <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-4 text-slate-500">
        <MapPin className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span>
          {hasLocation ? (
            <span className="tabular-nums text-slate-700">
              {incident.latitude?.toFixed(5)}, {incident.longitude?.toFixed(5)}
              {' · '}
            </span>
          ) : null}
          {incidentLocationNote(incident)}
        </span>
      </p>

      {incident.photoUrl ? (
        <div className="mt-2 w-28">
          <PodImagePreview
            src={incident.photoUrl}
            alt={`Photo of ${incidentTypeLabel(incident.type).toLowerCase()} ${incident.incidentNumber}`}
            caption="View photo"
            className="h-20 w-28 rounded-md object-cover"
          />
        </div>
      ) : null}

      {incident.isOpen ? (
        <p className="mt-2 text-[11px] font-medium text-slate-600">{incidentProgressLabel(incident)}</p>
      ) : (
        <div className="mt-2 space-y-0.5 rounded-lg bg-white px-2 py-1.5 text-[11px] leading-4 text-slate-600 ring-1 ring-slate-200">
          <p>
            <span className="font-medium text-slate-800">
              {incident.resolutionOutcome ? incidentOutcomeLabel(incident.resolutionOutcome) : 'Resolved'}
            </span>
            {incident.resolvedBy ? ` · ${incident.resolvedBy}` : ''}
            {incident.resolvedAt ? `, ${formatWhen(incident.resolvedAt)}` : ''}
          </p>
          {incident.resolutionNotes ? <p className="whitespace-pre-wrap break-words">{incident.resolutionNotes}</p> : null}
        </div>
      )}

      {canRespond ? (
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          {incident.status === 'REPORTED' ? (
            <Button size="sm" className={ACTION_ADVANCE} disabled={acknowledging} onClick={onAcknowledge}>
              {acknowledging ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
              Acknowledge<span className="sr-only"> {incident.incidentNumber}</span>
            </Button>
          ) : null}
          <Button size="sm" className={ACTION_DECIDE} disabled={acknowledging} onClick={onResolve}>
            <CheckCheck className="size-3.5" />
            Resolve<span className="sr-only"> {incident.incidentNumber}</span>
          </Button>
        </div>
      ) : null}
    </article>
  )
}

function ResolveIncidentDialog({
  incident,
  onClose,
  onSubmit,
}: {
  incident: VehicleIncident | null
  onClose: () => void
  onSubmit: (outcome: VehicleIncidentOutcome, notes: string) => Promise<void>
}) {
  const [outcome, setOutcome] = useState<VehicleIncidentOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const close = () => {
    if (saving) return
    setOutcome(null)
    setNotes('')
    setError('')
    onClose()
  }

  const submit = async () => {
    if (!outcome) {
      setError('Choose how the incident was resolved.')
      return
    }
    if (!notes.trim()) {
      setError('Add notes on how the incident was resolved.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSubmit(outcome, notes.trim())
      setOutcome(null)
      setNotes('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The incident could not be resolved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={incident !== null} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!saving}>
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>Resolve {incident?.incidentNumber}</DialogTitle>
          <DialogDescription>
            {incident
              ? `${incidentTypeLabel(incident.type)} reported by ${incident.driverName} on ${incident.tripNumber} (${incident.vehiclePlate}). The map stops flagging the vehicle once this is resolved.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-slate-900">What happened to the vehicle?</legend>
          {INCIDENT_OUTCOME_OPTIONS.map((option) => {
            const selected = outcome === option.value
            const Icon = option.value === 'RESUMED' ? CheckCheck : Wrench
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                <input
                  type="radio"
                  name="incident-outcome"
                  value={option.value}
                  checked={selected}
                  disabled={saving}
                  onChange={() => setOutcome(option.value)}
                  className="mt-1 size-4 accent-emerald-600"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                    <Icon className="size-4 text-slate-500" aria-hidden="true" />
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
                </span>
              </label>
            )
          })}
        </fieldset>

        {outcome === 'SENT_FOR_REPAIR' && incident?.tripStatus === 'IN_PROGRESS' ? (
          // The server keeps the driver from moving on (incident_lifecycle.stopping_incident).
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
            {incident.tripNumber} is still on the road. {incident.driverName} cannot go on to another stop until you transfer its load or cancel it in Trips.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="incident-resolution-notes">Notes <span className="text-red-600">*</span></Label>
          <Textarea
            id="incident-resolution-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={NOTES_MAX_LENGTH}
            rows={3}
            disabled={saving}
            placeholder="What was done, and where the vehicle is now"
            className="resize-none text-sm"
          />
          <p className="text-right text-[11px] text-slate-400">{notes.length}/{NOTES_MAX_LENGTH}</p>
        </div>

        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
            Resolve incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
