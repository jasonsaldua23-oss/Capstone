'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CarFront, Loader2, MapPin, Phone, Send, Wrench, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import {
  INCIDENT_TYPE_OPTIONS,
  incidentProgressLabel,
  incidentTypeLabel,
  newIncidentRequestId,
  vehicleConditionLabel,
  type VehicleIncident,
  type VehicleIncidentType,
} from '@/lib/vehicle-incidents'
import type { IncidentReportInput } from './use-trip-incident'

const DESCRIPTION_MAX_LENGTH = 1000

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''

/** Under a disabled "Mark Arrived": why the driver cannot move on (see vehicleStoppedBy). */
export function VehicleStoppedNote({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-5 text-amber-900">
      <Wrench className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  )
}

/** The form a driver fills in when the vehicle has an accident or is damaged. */
export function IncidentReportDialog({
  open,
  onOpenChange,
  tripNumber,
  vehiclePlate,
  hasLiveLocation,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripNumber: string
  vehiclePlate: string
  /** Whether the phone has a recent fix to send; otherwise the trip's last GPS update is used. */
  hasLiveLocation: boolean
  onSubmit: (input: IncidentReportInput) => Promise<{ incident: VehicleIncident; alreadyOpen: boolean }>
}) {
  const [type, setType] = useState<VehicleIncidentType | null>(null)
  const [canContinue, setCanContinue] = useState<boolean | null>(null)
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Kept across retries of one report, replaced only once it has been filed.
  const requestIdRef = useRef(newIncidentRequestId())
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const reset = () => {
    setType(null)
    setCanContinue(null)
    setDescription('')
    setPhoto(null)
    setError('')
    requestIdRef.current = newIncidentRequestId()
  }

  const close = () => {
    if (submitting) return
    onOpenChange(false)
  }

  const submit = async () => {
    if (!type) return setError('Choose what happened.')
    if (canContinue === null) return setError('Say whether the vehicle can continue the trip.')
    if (!description.trim()) return setError('Describe what happened.')
    setSubmitting(true)
    setError('')
    try {
      const { alreadyOpen } = await onSubmit({
        requestId: requestIdRef.current,
        type,
        vehicleCanContinue: canContinue,
        description: description.trim(),
        photo,
      })
      if (alreadyOpen) toast('An incident is already open for this trip. The warehouse has it.')
      else toast.success('Incident reported. The warehouse has been alerted.')
      reset()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The incident could not be reported')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={!submitting}
        className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md"
      >
        <DialogHeader className="px-5 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-[#123a67]">
            <AlertTriangle className="size-5 text-red-600" aria-hidden="true" />
            Report accident or damage
          </DialogTitle>
          <DialogDescription className="text-slate-600">
            {tripNumber}
            {vehiclePlate ? ` · ${vehiclePlate}` : ''}. The warehouse sees the vehicle flagged on the live map.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-5">
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-800">
            <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>If anyone is hurt or in danger, call <a href="tel:911" className="font-bold underline">911</a> first.</span>
          </p>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-semibold text-slate-900">What happened?</legend>
            <div className="grid grid-cols-2 gap-2">
              {INCIDENT_TYPE_OPTIONS.map((option) => {
                const selected = type === option.value
                const Icon = option.value === 'ACCIDENT' ? CarFront : Wrench
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600 ${selected ? 'border-red-500 bg-red-50 ring-1 ring-red-500' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <input
                      type="radio"
                      name="incident-type"
                      value={option.value}
                      checked={selected}
                      disabled={submitting}
                      onChange={() => {
                        setType(option.value)
                        setError('')
                      }}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <Icon className={`size-4 ${selected ? 'text-red-600' : 'text-slate-500'}`} aria-hidden="true" />
                      {option.label}
                    </span>
                    <span className="text-xs leading-4 text-slate-500">{option.hint}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-slate-900">Can the vehicle continue the trip?</legend>
            <div className="grid grid-cols-2 gap-2">
              {[true, false].map((value) => {
                const selected = canContinue === value
                return (
                  <label
                    key={String(value)}
                    className={`flex h-11 cursor-pointer items-center justify-center rounded-xl border text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600 ${selected ? 'border-[#1d4ed8] bg-blue-50 text-[#1d4ed8] ring-1 ring-[#1d4ed8]' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    <input
                      type="radio"
                      name="incident-can-continue"
                      checked={selected}
                      disabled={submitting}
                      onChange={() => {
                        setCanContinue(value)
                        setError('')
                      }}
                      className="sr-only"
                    />
                    {value ? 'Yes, it can' : 'No, it cannot'}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="incident-description" className="text-sm font-semibold text-slate-900">
              Describe what happened <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="incident-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                setError('')
              }}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={3}
              disabled={submitting}
              placeholder="Where it happened, what is damaged, and whether the load is safe"
              className="resize-none text-sm"
            />
            <p className="text-right text-[11px] text-slate-400">{description.length}/{DESCRIPTION_MAX_LENGTH}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-slate-900">Photo <span className="font-normal text-slate-500">(optional)</span></p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                event.target.value = ''
                if (file && !file.type.startsWith('image/')) {
                  setError('Choose a photo (an image file).')
                  return
                }
                setPhoto(file)
              }}
            />
            {photoPreview ? (
              <div className="relative w-fit">
                {/* A local preview of the file about to be sent; nothing is uploaded until Send. */}
                <img src={photoPreview} alt="Incident photo to send" className="h-28 w-40 rounded-xl border border-slate-200 object-cover" />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  disabled={submitting}
                  aria-label="Remove photo"
                  className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" disabled={submitting} onClick={() => photoInputRef.current?.click()} className="gap-2">
                <Camera className="size-4" />
                Add photo
              </Button>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-xs leading-4 text-slate-500">
            <MapPin className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {hasLiveLocation
              ? 'Your current location is sent with the report.'
              : 'Your phone has no recent GPS fix, so the last location uploaded on this trip is used.'}
          </p>

          {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={submitting} onClick={close}>
              Cancel
            </Button>
            <Button type="button" className="h-11 flex-1 gap-2 bg-red-600 text-white hover:bg-red-700" disabled={submitting} onClick={() => void submit()}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {submitting ? 'Sending...' : 'Send report'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const STATUS_TONE = {
  ACCIDENT: 'border-red-200 bg-red-50 text-red-800',
  VEHICLE_DAMAGE: 'border-amber-200 bg-amber-50 text-amber-900',
} as const

/** What the driver sees while their report is open: the same state the warehouse sees. */
export function IncidentStatusDialog({
  incident,
  open,
  onOpenChange,
}: {
  incident: VehicleIncident | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open && incident !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
        {incident ? (
          <>
            <DialogHeader className="px-5 pt-5 text-left">
              <DialogTitle className="flex items-center gap-2 text-[#123a67]">
                <AlertTriangle className={`size-5 ${incident.type === 'ACCIDENT' ? 'text-red-600' : 'text-amber-600'}`} aria-hidden="true" />
                {incidentTypeLabel(incident.type)} reported
              </DialogTitle>
              <DialogDescription className="text-slate-600">
                {incident.incidentNumber} · reported {formatTime(incident.reportedAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 px-5 pb-5 text-sm">
              <p className={`rounded-xl border px-3 py-2.5 font-semibold ${STATUS_TONE[incident.type]}`}>
                {incidentProgressLabel(incident)}
                {incident.acknowledgedAt ? <span className="font-normal"> at {formatTime(incident.acknowledgedAt)}</span> : null}
              </p>
              <p className={incident.vehicleCanContinue ? 'text-slate-700' : 'font-semibold text-red-700'}>
                {vehicleConditionLabel(incident.vehicleCanContinue)}
              </p>
              <p className="whitespace-pre-wrap break-words text-slate-700">{incident.description}</p>
              {incident.photoUrl ? (
                <PodImagePreview src={incident.photoUrl} alt="Incident photo" caption="View photo" className="h-32 w-44 rounded-xl object-cover" />
              ) : null}
              <p className="text-xs text-slate-500">
                The warehouse resolves this report. Until then the vehicle stays flagged on their map, and you can keep updating your deliveries.
              </p>
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
