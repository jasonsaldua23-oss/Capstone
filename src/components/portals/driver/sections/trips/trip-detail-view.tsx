'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { emitDataSync } from '@/lib/data-sync'
import { stopDriverNavigationSpeech } from '@/lib/native/driver-speech'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import { EmptiesChargeNote } from '@/components/shared/empties-charge-note'
import type { AuthUser } from '@/types'
import { calculateNavigationViewportInsets, type NavigationViewportInsets } from '@/lib/map-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { toast } from 'sonner'
import { DriverGpsLocation, DropPoint, mergeDropPointIntoTrip, stripPhilippinesFromAddress, TERMINAL_DROP_POINT_STATUSES, Trip } from './trip-detail-helpers'
import { Phone, Navigation, CheckCircle, AlertCircle, Camera, ChevronLeft, Play, Flag, Loader2, Route, LocateFixed, Volume2, VolumeX, Plus, Minus } from 'lucide-react'
import { NavInstructionsPanel, type OsrmStep } from '@/components/shared/NavInstructionsPanel'
import { isAutomaticallyRetryableWriteStatus, waitForDriverWriteRetry } from './trip-detail-retry'
import {
  dropPointStatusColors,
  formatCurrency,
  getItemDisplayNameWithSize,
  getItemCategoryLabel,
  getOrderQtyWithUnitLabel,
  getDisplayOrderTotal,
  formatTripScheduledDay,
  getTripScheduledDateKey,
  toManilaDateKey,
  isTripOverdue,
  getOverdueTripMessage,
  ACTIVE_TRIP_BLOCK_MESSAGE,
  speakNavigationPrompt,
} from './trip-detail-format'
import { useDriverTripsSnapshot } from '../layout/portal-state'
import { uploadPodImage } from './trip-detail-camera'
import { toRecordedAtMs } from './trip-detail-location'
import { useTripNavigation } from './use-trip-navigation'
import type { DriverRouteOption } from './trip-navigation-config'
import { DropPointDetailsDialog } from './drop-point-details-dialog'
import { FailedDeliveryDialogs } from './failed-delivery-dialogs'
import { PodCameraDialogs } from './pod-camera-dialogs'
import { useTripPodCamera } from './use-trip-pod-camera'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

// Main driver trip detail screen: controls stop workflow, map state, and proof-of-delivery capture.
export function TripDetailView({
  trip,
  driverUser,
  onBack,
  onTripCompleted,
  locationPermission,
  onStartTracking,
  onRefreshTrips,
  onApplyTripUpdate,
  isTracking,
  currentLocation,
}: {
  trip: Trip
  driverUser: AuthUser | null
  onBack: () => void
  /** Where to send the driver once the trip is closed; falls back to going back. */
  onTripCompleted?: () => void
  locationPermission: 'granted' | 'denied' | 'prompt'
  onStartTracking: () => Promise<boolean>
  onRefreshTrips: () => Promise<Trip[]>
  onApplyTripUpdate: (updater: (trip: Trip) => Trip) => void
  isTracking: boolean
  currentLocation: DriverGpsLocation | null
}) {
  // Delivery and proof-of-delivery state.
  const [activeDropPoint, setActiveDropPoint] = useState<DropPoint | null>(null)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  // The ref, not the state flag, is what stops a second tap: state updates land after
  // the next render, and the button can be pressed again before that happens.
  const [isCompletingTrip, setIsCompletingTrip] = useState(false)
  const isCompletingTripRef = useRef(false)
  const {
    cameraError,
    cameraGps,
    cameraLocationError,
    cameraOverlaySnapshot,
    cameraPermissionHint,
    cameraPermissionSteps,
    captureFromCamera,
    capturedCameraPhoto,
    closeCameraCapture,
    continueCapturedPhoto,
    isCameraAddressLoading,
    isCameraLoading,
    isCameraOpen,
    isCameraPermissionDialogOpen,
    openCameraCapture,
    openPodCameraCapture,
    podDraftByDropPoint,
    setCapturedCameraPhoto,
    setIsCameraPermissionDialogOpen,
    setPodFileForDropPoint,
    videoRef,
  } = useTripPodCamera({
    activeDropPoint,
    driverUser,
  })
  const [returnedEmptiesByDropPoint, setReturnedEmptiesByDropPoint] = useState<Record<string, Array<{
    declarationId?: string
    containerTypeId: string
    containerTypeName: string
    returnedQuantity: number
    returnedCases?: number
    returnedLooseBottles?: number
  }>>>({})

  // Failed-delivery decision flow state.
  const [isFailedDeliveryChoiceOpen, setIsFailedDeliveryChoiceOpen] = useState(false)
  const [failedDeliveryDropPointId, setFailedDeliveryDropPointId] = useState<string | null>(null)
  const [isFailedDeliveryActionWarningOpen, setIsFailedDeliveryActionWarningOpen] = useState(false)
  const [failedDeliveryPendingAction, setFailedDeliveryPendingAction] = useState<'reschedule' | 'cancel' | null>(null)
  const [selectedDriverCancelReasons, setSelectedDriverCancelReasons] = useState<string[]>([])
  const [otherDriverCancelReason, setOtherDriverCancelReason] = useState('')
  const [isArriveWarningOpen, setIsArriveWarningOpen] = useState(false)
  const [arriveTargetDropPointId, setArriveTargetDropPointId] = useState<string | null>(null)
  const [arriveTargetDropPointName, setArriveTargetDropPointName] = useState('')
  // Added: identifies the stop whose arrival request is loading so its action can show progress.
  const [arrivingDropPointId, setArrivingDropPointId] = useState<string | null>(null)
  const [isFailedDeliveryRescheduleOpen, setIsFailedDeliveryRescheduleOpen] = useState(false)
  const [isFailedDeliverySubmitting, setIsFailedDeliverySubmitting] = useState(false)
  const [failedDeliveryRescheduleDropPointId, setFailedDeliveryRescheduleDropPointId] = useState<string | null>(null)
  const [failedDeliveryReceiveAgain, setFailedDeliveryReceiveAgain] = useState<'tomorrow' | 'other_date'>('tomorrow')
  const [failedDeliveryOtherDate, setFailedDeliveryOtherDate] = useState('')
  const [isDeliveredWarningOpen, setIsDeliveredWarningOpen] = useState(false)
  const [isConfirmDeliveredSubmitting, setIsConfirmDeliveredSubmitting] = useState(false)
  const [deliveredTargetDropPointId, setDeliveredTargetDropPointId] = useState<string | null>(null)
  const [deliveredTargetDropPointName, setDeliveredTargetDropPointName] = useState('')
  const [isStartTripConfirmOpen, setIsStartTripConfirmOpen] = useState(false)
  const [loadConfirmed, setLoadConfirmed] = useState(false)
  // Added: the server's refusal (e.g. overdue, another active trip) stays on screen, not only in a toast.
  const [startError, setStartError] = useState<string | null>(null)
  const { trips: driverTrips } = useDriverTripsSnapshot()
  // Added: an overdue trip can never start, and a driver runs one trip at a time.
  // trip_start enforces both; this only stops the driver loading the truck for nothing.
  const tripIsOverdue = isTripOverdue(trip)
  const hasOtherActiveTrip = driverTrips.some(
    (row) => row?.id !== trip.id && String(row?.status || '').toUpperCase() === 'IN_PROGRESS'
  )
  const startBlockedReason = tripIsOverdue
    ? getOverdueTripMessage(trip)
    : hasOtherActiveTrip
      ? ACTIVE_TRIP_BLOCK_MESSAGE
      : null
  const [selectedDropPointForDetails, setSelectedDropPointForDetails] = useState<DropPoint | null>(null)

  // Mobile bottom sheet and map UX state.
  // Fix: one mounted sheet owns the whole drag, including its collapsed summary.
  const [mobileSheetPeekHeight, setMobileSheetPeekHeight] = useState(112)
  const mobileSheetPeekSnap = `${mobileSheetPeekHeight}px`
  const [mobileSheetSnapPoint, setMobileSheetSnapPoint] = useState<number | string | null>('112px')
  const isMobileSheetOpen = typeof mobileSheetSnapPoint === 'number'
  const [mobileSheetAnimationEpoch, setMobileSheetAnimationEpoch] = useState(0)
  const [mobileMapRecenterSignal, setMobileMapRecenterSignal] = useState(0)
  const [mobileMapZoomInSignal, setMobileMapZoomInSignal] = useState(0)
  const [mobileMapZoomOutSignal, setMobileMapZoomOutSignal] = useState(0)
  const [mobileMapRecenterCenter, setMobileMapRecenterCenter] = useState<[number, number] | null>(null)
  const [mobileNavigationViewportInsets, setMobileNavigationViewportInsets] = useState<NavigationViewportInsets>({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  })
  const [isUpdating, setIsUpdating] = useState(false)
  const [routeSteps, setRouteSteps] = useState<OsrmStep[]>([])
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [routeOptions, setRouteOptions] = useState<DriverRouteOption[]>([])
  const [activeRouteOptionIndex, setActiveRouteOptionIndex] = useState(0)
  const [navigationRouteOrigin, setNavigationRouteOrigin] = useState<{ tripId: string; lat: number; lng: number; revision: number } | null>(null)
  const navigationRouteRequestInFlightRef = useRef(false)
  const navigationRouteLastRequestAtRef = useRef(0)
  const navigationRouteRetryAtRef = useRef(0)
  const navigationRouteAbortRef = useRef<AbortController | null>(null)
  const navigationRouteSelectionEpochRef = useRef(0)
  const [navigationRouteCheckEpoch, setNavigationRouteCheckEpoch] = useState(0)
  useEffect(() => {
    // Fix: request completion and a stationary detour must recover without another GPS event.
    const check = () => setNavigationRouteCheckEpoch((value) => value + 1)
    const timer = window.setInterval(check, 1000)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [trip.id])
  const navigationStopsKeyRef = useRef('')
  const [is3DPerspective, setIs3DPerspective] = useState(false)
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true)
  const [previewDriverLocation, setPreviewDriverLocation] = useState<DriverGpsLocation | null>(null)
  // Refs for camera stream lifecycle and gesture handling.
  const spokenNavigationPromptsRef = useRef<Set<string>>(new Set())
  const mobileMapViewportRef = useRef<HTMLDivElement | null>(null)
  const mobileTopOverlayRef = useRef<HTMLDivElement | null>(null)
  const mobileDrawerRef = useRef<HTMLDivElement | null>(null)
  const mobileSheetPeekRef = useRef<HTMLDivElement | null>(null)
  const mobileSheetHeaderGestureRef = useRef({ startY: 0, dragged: false })
  const isMobileViewport = useIsMobile()
  // Derived drop points sorted by sequence for consistent rendering and logic.
  const sortedDropPoints = useMemo(
    () => [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence),
    [trip.dropPoints]
  )
  const startTripLoadSummary = useMemo(() => {
    const totals = new Map<string, { productName: string; quantity: number; unit: string }>()
    for (const dropPoint of sortedDropPoints) {
      const order = dropPoint?.order
      const items = Array.isArray(order?.items) ? order.items : []
      for (const item of items) {
        const productName = getItemDisplayNameWithSize(item)
        const quantityLabel = getOrderQtyWithUnitLabel(item, order)
        const match = quantityLabel.match(/^x?(\d+(?:\.\d+)?)\s+(.+)$/i)
        const quantity = match ? Math.max(0, Number(match[1]) || 0) : Math.max(0, Number(item?.quantity || 0))
        const rawUnit = String(match?.[2] || item?.productUnit || item?.product?.unit || 'unit').toLowerCase()
        // Keep case loads and loose-bottle loads distinct for the driver's physical count.
        const unit = rawUnit.includes('bottle') ? 'bottle' : rawUnit.includes('case') ? 'case' : rawUnit.replace(/s$/, '') || 'unit'
        const key = `${productName.toLowerCase()}|${unit}`
        const current = totals.get(key)
        totals.set(key, { productName, unit, quantity: (current?.quantity || 0) + quantity })
      }
    }
    return Array.from(totals.values()).sort((a, b) => a.productName.localeCompare(b.productName))
  }, [sortedDropPoints])
  const terminalDropPointStatuses = TERMINAL_DROP_POINT_STATUSES
  const effectiveCompletedDropPoints = Math.max(
    Number(trip.completedDropPoints || 0),
    sortedDropPoints.filter((point) => terminalDropPointStatuses.has(String(point.status || '').toUpperCase())).length
  )
  // Every stop delivered, which is what the end-of-trip confirmation celebrates.
  const allDropPointsCompleted =
    sortedDropPoints.length > 0 &&
    sortedDropPoints.every((point) => String(point.status || '').toUpperCase() === 'COMPLETED')
  // Fix: cancelled deliveries are resolved too, matching the trip-completion API.
  // Anything pending, in transit, arrived or skipped still needs the driver.
  const unresolvedDropPointCount = sortedDropPoints.filter(
    (point) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(point.status || '').toUpperCase())
  ).length
  const canCompleteTrip = sortedDropPoints.length > 0 && unresolvedDropPointCount === 0
  const highlightedDropPoint = activeDropPoint || sortedDropPoints[0] || null
  const mobileSheetSnapPoints = useMemo<Array<number | string>>(
    () => [mobileSheetPeekSnap, 0.52, 0.88, 1], [mobileSheetPeekSnap]
  )
  useEffect(() => {
    const header = mobileSheetPeekRef.current
    if (!header || !isMobileViewport) return
    // Include the safe-area padding and wrapped text so collapse never hides the trip summary.
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(header.getBoundingClientRect().height)
      if (height <= 0) return
      setMobileSheetPeekHeight(height)
      setMobileSheetSnapPoint((previous) => typeof previous === 'number' ? previous : `${height}px`)
    })
    observer.observe(header)
    return () => observer.disconnect()
  }, [isMobileViewport, mobileSheetAnimationEpoch])
  // Vaul renders the sheet at the height of its largest snap point and slides it
  // down for the smaller ones, so the scrollable area has to be capped at the part
  // that is actually on screen. Without this the list below the fold could not be
  // reached at all: the container scrolled, but its lower half sat past the bottom
  // of the display.
  const mobileSheetVisibleFraction =
    typeof mobileSheetSnapPoint === 'number' && mobileSheetSnapPoint > 0 ? mobileSheetSnapPoint : 0.52
  const tripCompletionSection =
    trip.status === 'IN_PROGRESS' ? (
      <>
        {(allDropPointsCompleted || canCompleteTrip) && (
          <div className="space-y-3">
            {allDropPointsCompleted ? (
              <div className="flex items-start gap-3 rounded-xl border border-[#c9e7d4] bg-[#f1faf4] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dcf1e4]">
                  <CheckCircle className="h-5 w-5 text-[#16984e]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[#14532d]">All Drop Points Completed!</p>
                  <p className="mt-1 text-[13px] leading-5 text-[#3f6b50]">
                    Every delivery on this trip has been completed. Complete the trip to close it and return to your dashboard.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[#e4d9b8] bg-[#fdf8ea] p-4">
                <p className="text-[15px] font-semibold text-[#7a5c15]">All drop points are resolved</p>
                <p className="mt-1 text-[13px] leading-5 text-[#8a7135]">
                  Some deliveries could not be completed. You can still close the trip; the recorded outcomes stay on each order.
                </p>
              </div>
            )}
            <Button
              onClick={() => void handleCompleteTrip()}
              disabled={!canCompleteTrip || isCompletingTrip}
              className="h-12 w-full bg-green-600 hover:bg-green-700 disabled:opacity-60"
            >
              {isCompletingTrip ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              ) : (
                <Flag className="h-5 w-5 mr-2" />
              )}
              {isCompletingTrip ? 'Completing Trip' : 'Complete Trip'}
            </Button>
          </div>
        )}
        {!canCompleteTrip && unresolvedDropPointCount > 0 && (
          <p className="text-center text-[13px] text-slate-500">
            {unresolvedDropPointCount} drop point{unresolvedDropPointCount === 1 ? '' : 's'} still to complete before this trip can be closed.
          </p>
        )}
      </>
    ) : null
  const hasBlockingDialogOpen =
    isStartTripConfirmOpen ||
    isArriveWarningOpen ||
    isDeliveredWarningOpen ||
    isFailedDeliveryActionWarningOpen ||
    isCameraOpen ||
    isCameraPermissionDialogOpen ||
    isFailedDeliveryChoiceOpen ||
    isFailedDeliveryRescheduleOpen

  useEffect(() => {
    if (!isMobileViewport) return

    const mapViewport = mobileMapViewportRef.current
    const topOverlay = mobileTopOverlayRef.current
    if (!mapViewport || !topOverlay) return

    const updateCameraInsets = () => {
      const bottomOverlay = mobileDrawerRef.current
      const measured = calculateNavigationViewportInsets(
        mapViewport.getBoundingClientRect(),
        topOverlay.getBoundingClientRect(),
        bottomOverlay?.getBoundingClientRect()
      )
      const next = {
        top: Math.round(measured.top),
        bottom: Math.round(measured.bottom),
        left: Math.round(measured.left),
        right: Math.round(measured.right),
      }
      setMobileNavigationViewportInsets((previous) =>
        previous.top === next.top &&
        previous.bottom === next.bottom &&
        previous.left === next.left &&
        previous.right === next.right
          ? previous
          : next
      )
    }

    const resizeObserver = new ResizeObserver(updateCameraInsets)
    resizeObserver.observe(mapViewport)
    resizeObserver.observe(topOverlay)
    if (mobileDrawerRef.current) resizeObserver.observe(mobileDrawerRef.current)
    if (mobileSheetPeekRef.current) resizeObserver.observe(mobileSheetPeekRef.current)

    window.addEventListener('resize', updateCameraInsets)
    window.visualViewport?.addEventListener('resize', updateCameraInsets)
    updateCameraInsets()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateCameraInsets)
      window.visualViewport?.removeEventListener('resize', updateCameraInsets)
    }
  }, [isMobileSheetOpen, isMobileViewport, mobileSheetAnimationEpoch, mobileSheetSnapPoint])

  // Refresh immediately after writes so status changes reflect server DB state without delay.
  const refreshTripsInBackground = () => {
    void onRefreshTrips().catch(() => {
      // The optimistic update keeps the driver flow responsive; the next poll will reconcile.
    })
  }

  useEffect(() => {
    if (!activeDropPoint) return
    const nextActiveDropPoint = (trip.dropPoints || []).find((point) => point.id === activeDropPoint.id) || null
    if (nextActiveDropPoint && nextActiveDropPoint !== activeDropPoint) {
      setActiveDropPoint(nextActiveDropPoint)
    }
  }, [activeDropPoint, trip.dropPoints])

  // Fetch OSRM steps logic moved down below waypoints calculation
  // Turn-by-turn step advancement is defined below, once the active route
  // geometry the steps belong to is in scope, so progress can be measured along
  // the route instead of by a fixed radius around the next maneuver.

  useEffect(() => {
    // Fix: route steps refresh as the driver's GPS position changes. Keep spoken
    // prompt keys across those refreshes so the same instruction is not repeated.
    spokenNavigationPromptsRef.current.clear()
    stopDriverNavigationSpeech()
    return stopDriverNavigationSpeech
  }, [trip.id])

  // Reset mobile sheet and recenter state when user switches to a different trip.
  useEffect(() => {
    setMobileSheetSnapPoint(mobileSheetPeekSnap)
    setMobileMapRecenterCenter(null)
    setMobileMapRecenterSignal(0)
  }, [trip.id])

  // Fix: downward gestures stop at the summary instead of dismissing into an empty strip.
  const handleMobileSheetSnapPointChange = (next: number | string | null) => {
    setMobileSheetSnapPoint(next !== null && mobileSheetSnapPoints.includes(next) ? next : mobileSheetPeekSnap)
  }
  const handleMobileSheetOpenChange = (open: boolean) => {
    if (!open) setMobileSheetSnapPoint(mobileSheetPeekSnap)
  }
  const handleMobileSheetAnimationEnd = () => {
    setMobileSheetAnimationEpoch((previous) => previous + 1)
  }

  const getEmptiesShortfallAmount = (dropPoint: any): number => {
    const declaredEmpties = (dropPoint?.declaredEmpties || []) as Array<{
      declarationId?: string
      containerTypeId: string
      declaredQuantity?: number
      depositValue?: number
    }>
    if (!declaredEmpties.length) return 0
    const counted = returnedEmptiesByDropPoint[String(dropPoint?.id || '')] || []
    let shortfall = 0
    for (const entry of declaredEmpties) {
      const declared = Math.max(0, Number(entry.declaredQuantity || 0))
      if (declared <= 0) continue
      const declarationId = entry.declarationId || entry.containerTypeId
      const stored = counted.find((row) => (row.declarationId || row.containerTypeId) === declarationId)?.returnedQuantity
      const collected = Math.min(Math.max(0, stored ?? declared), declared)
      const short = declared - collected
      if (short <= 0) continue
      shortfall += (Number(entry.depositValue || 0) * short) / declared
    }
    return Math.round(shortfall * 100) / 100
  }

  // Starts a trip after location tracking is available and trip is still in a startable state.
  const handleStartTrip = async (): Promise<boolean> => {
    const latestTrip = trip
    const currentStatus = String(latestTrip.status || '').toUpperCase()
    if (currentStatus !== 'PLANNED') {
      toast.error(`Trip cannot be started because status is ${currentStatus.replace(/_/g, ' ')}`)
      refreshTripsInBackground()
      return false
    }
    if (startBlockedReason) {
      setStartError(startBlockedReason)
      toast.error(startBlockedReason)
      return false
    }
    // Added: block before location tracking starts; the API repeats this rule server-side.
    // Fix: compare Philippine calendar days, the same day key trip_start uses.
    const scheduledKey = getTripScheduledDateKey(latestTrip)
    if (!scheduledKey || scheduledKey !== toManilaDateKey()) {
      const message = scheduledKey
        ? `Trip can only be started on its scheduled date: ${formatTripScheduledDay(latestTrip)}`
        : 'Trip cannot be started because its scheduled date is not set'
      setStartError(message)
      toast.error(message)
      return false
    }
    if (!loadConfirmed) {
      toast.error('Confirm Load before starting the trip')
      return false
    }

    setStartError(null)
    setIsUpdating(true)
    try {
      // Do not mark the route active until its location session is running.
      if (!await onStartTracking()) {
        toast.error('Location tracking must be active before the trip can start.')
        return false
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await fetch(`/api/trips/${trip.id}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              confirmLoad: true,
              latitude: currentLocation?.lat ?? null,
              longitude: currentLocation?.lng ?? null,
            }),
          })
          const payload = await response.json().catch(() => ({}))
          if (response.ok && payload?.success !== false) {
            const startedAt = payload?.trip?.actualStartAt || new Date().toISOString()
            onApplyTripUpdate((currentTrip) => ({
              ...currentTrip,
              ...payload?.trip,
              status: 'IN_PROGRESS',
              actualStartAt: startedAt,
              dropPoints: (currentTrip.dropPoints || []).map((point) => ({
                ...point,
                order: point.order
                  ? {
                    ...point.order,
                    status: 'OUT_FOR_DELIVERY',
                  }
                  : point.order,
              })),
            }))
            toast.success(payload?.alreadyStarted ? 'Trip session is already open.' : (payload?.message || 'Trip started'))
            emitDataSync(['orders', 'trips'])
            refreshTripsInBackground()
            return true
          }
          if (!isAutomaticallyRetryableWriteStatus(response.status)) {
            const message = payload?.error || 'Failed to start trip'
            setStartError(message)
            toast.error(message)
            refreshTripsInBackground()
            return false
          }
        } catch {
          // Keep the start dialog open while a temporary mobile-network failure recovers.
        }
        await waitForDriverWriteRetry(attempt)
      }
    } finally {
      setIsUpdating(false)
    }
  }

  const openArriveWarning = (dropPoint: DropPoint) => {
    setArriveTargetDropPointId(String(dropPoint.id || ''))
    setArriveTargetDropPointName(String(dropPoint.locationName || `Stop ${dropPoint.sequence || ''}`).trim())
    setIsArriveWarningOpen(true)
  }

  const openDeliveredWarning = (dropPoint: DropPoint) => {
    setDeliveryError(null)
    setDeliveredTargetDropPointId(String(dropPoint.id || ''))
    setDeliveredTargetDropPointName(String(dropPoint.locationName || `Stop ${dropPoint.sequence || ''}`).trim())
    setIsDeliveredWarningOpen(true)
  }

  const submitDeliveredForDropPoint = async (dropPoint: DropPoint): Promise<boolean> => {
    setDeliveryError(null)
    const dropPointId = String(dropPoint?.id || '').trim()
    const podDraft = podDraftByDropPoint[dropPointId]
    const podImageFile = podDraft?.file || null
    const existingPodPhotoUrl = String(dropPoint?.deliveryPhoto || '').trim()
    if (!podImageFile && !existingPodPhotoUrl) {
      setDeliveryError('Capture a POD photo before confirming delivery.')
      toast.error('Capture POD photo first')
      openPodCameraCapture(String(dropPoint.id || ''))
      return false
    }
    try {
      const imageUrl = podImageFile ? await uploadPodImage(podImageFile) : existingPodPhotoUrl
      // An untouched counter means the driver agreed with the declaration, so the
      // declared quantity is what gets submitted rather than an empty payload.
      const storedEmpties = returnedEmptiesByDropPoint[dropPointId] || []
      const declaredEmpties = ((dropPoint as any)?.declaredEmpties || []) as Array<{ declarationId?: string; containerTypeId: string; containerTypeName?: string; declaredQuantity?: number }>
      const returnedEmpties = declaredEmpties.length
        ? declaredEmpties
            .filter((entry) => entry?.containerTypeId)
            .map((entry) => ({
              containerTypeId: entry.containerTypeId,
              containerTypeName: entry.containerTypeName || '',
              declarationId: entry.declarationId || entry.containerTypeId,
              returnedQuantity:
                storedEmpties.find((stored) => (stored.declarationId || stored.containerTypeId) === (entry.declarationId || entry.containerTypeId))?.returnedQuantity
                ?? Math.max(0, Number(entry.declaredQuantity || 0)),
            }))
        : storedEmpties
      const completed = await handleUpdateDropPoint(dropPoint.id, 'COMPLETED', deliveryNote, {
        recipientName: 'Customer',
        deliveryPhoto: imageUrl,
      }, { returnedEmpties })
      if (completed) {
        setPodFileForDropPoint(dropPointId, null)
        setDeliveryNote('')
      }
      return completed
    } catch (error: any) {
      setDeliveryError(error?.message || 'POD upload failed.')
      toast.error(error?.message || 'Failed to upload POD image')
      return false
    }
  }

  // Closes the trip once every stop has an outcome, then returns the driver home.
  const handleCompleteTrip = async () => {
    if (isCompletingTripRef.current) return
    isCompletingTripRef.current = true
    setIsCompletingTrip(true)
    try {
      const response = await fetch(`/api/trips/${trip.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        toast.error(payload?.error || 'The trip could not be completed. Please try again.')
        return
      }
      // A repeat call reports the trip as already completed rather than failing, so
      // the driver still ends up back on the dashboard either way.
      toast.success(payload?.alreadyCompleted ? 'This trip was already completed.' : 'Trip completed.')
      onApplyTripUpdate((currentTrip) => ({
        ...currentTrip,
        ...(payload?.trip || {}),
        status: 'COMPLETED',
      }))
      emitDataSync(['trips', 'orders'])
      void onRefreshTrips()
      if (onTripCompleted) {
        onTripCompleted()
      } else {
        onBack()
      }
    } catch {
      toast.error('The trip could not be completed. Please check your connection and try again.')
    } finally {
      isCompletingTripRef.current = false
      setIsCompletingTrip(false)
    }
  }

  // Updates a single drop point status and then syncs local state and global data subscribers.
  const handleUpdateDropPoint = async (
    dropPointId: string,
    status: string,
    notes?: string,
    pod?: { recipientName?: string; deliveryPhoto?: string },
    options?: {
      releaseInventory?: boolean
      rescheduleRequested?: boolean
      rescheduleWindow?: 'today' | 'tomorrow' | 'other_date'
      rescheduleDate?: string
      returnedEmpties?: Array<{ containerTypeId: string; returnedQuantity: number }>
    }
  ): Promise<boolean> => {
    setIsUpdating(true)
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await fetch(`/api/trips/${trip.id}/drop-points/${dropPointId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status,
              notes,
              recipientName: pod?.recipientName,
              deliveryPhoto: pod?.deliveryPhoto,
              releaseInventory: options?.releaseInventory,
              rescheduleRequested: options?.rescheduleRequested,
              rescheduleWindow: options?.rescheduleWindow,
              rescheduleDate: options?.rescheduleDate,
              returnedEmpties: options?.returnedEmpties,
            }),
          })
          const payload = await response.json().catch(() => ({}))
          if (response.ok && payload?.success !== false) {
            const actualStatus = String(payload?.dropPoint?.status || status).toUpperCase()
            const deferredLaterToday = status === 'FAILED' && options?.rescheduleWindow === 'today' && actualStatus === 'PENDING'
            const dropPointPatch: Partial<DropPoint> = {
              ...(payload?.dropPoint || {}),
              id: dropPointId,
              status: actualStatus,
              deliveryPhoto: pod?.deliveryPhoto ?? payload?.dropPoint?.deliveryPhoto,
              order:
                payload?.order && (trip.dropPoints || []).find((point) => point.id === dropPointId)?.order
                  ? {
                    ...(trip.dropPoints || []).find((point) => point.id === dropPointId)!.order!,
                    ...payload.order,
                  }
                  : undefined,
            }
            onApplyTripUpdate((currentTrip) => mergeDropPointIntoTrip(currentTrip, dropPointId, dropPointPatch))
            if (deferredLaterToday) {
              toast.success('Order moved to the end of this route for later today')
            } else {
              toast.success(`Drop point marked as ${actualStatus.toLowerCase()}`)
            }
            emitDataSync(['orders', 'trips'])
            refreshTripsInBackground()
            return true
          }
          if (status !== 'COMPLETED' || !isAutomaticallyRetryableWriteStatus(response.status)) {
            toast.error(payload?.error || 'Failed to update drop point')
            // Preserve the form and captured POD when validation fails.
            if (status === 'COMPLETED') setDeliveryError(payload?.error || 'Delivery confirmation could not be saved.')
            return false
          }
        } catch {
          if (status !== 'COMPLETED') {
            toast.error('Unable to save the delivery update. Check your connection and try again.')
            return false
          }
          // Keep the confirmation screen visible while an offline/weak connection recovers.
        }
        await waitForDriverWriteRetry(attempt)
      }
    } finally {
      setIsUpdating(false)
    }
  }

  // POD image input handler with per-drop-point preview generation.

  // Failed-delivery modal open/close helpers.
  const openFailedDeliveryChoice = (dropPointId: string) => {
    setFailedDeliveryDropPointId(dropPointId)
    setIsFailedDeliveryChoiceOpen(true)
  }

  const closeFailedDeliveryChoice = () => {
    setIsFailedDeliveryChoiceOpen(false)
    setFailedDeliveryDropPointId(null)
    setSelectedDriverCancelReasons([])
    setOtherDriverCancelReason('')
  }

  const openFailedDeliveryActionWarning = (action: 'reschedule' | 'cancel') => {
    if (action === 'cancel') {
      setSelectedDriverCancelReasons([])
      setOtherDriverCancelReason('')
    }
    setFailedDeliveryPendingAction(action)
    setIsFailedDeliveryActionWarningOpen(true)
  }

  const openFailedDeliveryReschedule = (dropPointId: string) => {
    setFailedDeliveryRescheduleDropPointId(dropPointId)
    setFailedDeliveryReceiveAgain('tomorrow')
    setFailedDeliveryOtherDate('')
    setIsFailedDeliveryRescheduleOpen(true)
  }

  const closeFailedDeliveryReschedule = () => {
    setIsFailedDeliveryRescheduleOpen(false)
    setFailedDeliveryRescheduleDropPointId(null)
    setFailedDeliveryReceiveAgain('tomorrow')
    setFailedDeliveryOtherDate('')
  }

  // Closes camera capture UI and clears camera-related temporary state.

  // Camera and state cleanup effects.

  useEffect(() => {
    const sorted = [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence)
    const nextActionable =
      sorted.find((point) => ['PENDING', 'IN_TRANSIT', 'ARRIVED'].includes(String(point.status || '').toUpperCase())) ||
      sorted[0] ||
      null
    setActiveDropPoint(nextActionable)
  }, [trip.id, trip.dropPoints])

  useEffect(() => {
    if (currentLocation?.lat && currentLocation?.lng) {
      setPreviewDriverLocation({
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        accuracy: Number.isFinite(Number(currentLocation.accuracy)) ? Number(currentLocation.accuracy) : null,
        // Fix: preserve unavailable sensors instead of coercing null to zero,
        // which made road matching treat a moving driver as stationary.
        heading: currentLocation.heading != null && Number.isFinite(Number(currentLocation.heading)) ? Number(currentLocation.heading) : null,
        speed: currentLocation.speed != null && Number.isFinite(Number(currentLocation.speed)) ? Number(currentLocation.speed) : null,
        recordedAt: toRecordedAtMs(currentLocation.recordedAt) ?? Date.now(),
      })
      return
    }
    if (!navigator.geolocation) return

    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        const lat = Number(position.coords.latitude)
        const lng = Number(position.coords.longitude)
        const acc = Number(position.coords.accuracy)
        // Reject inaccurate cell-tower fixes (> 150 m) for the preview marker.
        if (Number.isFinite(lat) && Number.isFinite(lng) && (!Number.isFinite(acc) || acc <= 150)) {
          setPreviewDriverLocation({
            lat,
            lng,
            accuracy: Number.isFinite(acc) ? acc : null,
            // Browser heading and speed are nullable when the sensor has no reading.
            heading: position.coords.heading !== null && Number.isFinite(Number(position.coords.heading)) ? Number(position.coords.heading) : null,
            speed: position.coords.speed !== null && Number.isFinite(Number(position.coords.speed)) ? Number(position.coords.speed) : null,
            recordedAt: Number(position.timestamp || Date.now()),
          })
        }
      },
      () => {
        // Best effort only for map preview marker.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    )

    return () => {
      cancelled = true
    }
  }, [
    trip.id,
    currentLocation?.lat,
    currentLocation?.lng,
    currentLocation?.accuracy,
    currentLocation?.heading,
    currentLocation?.speed,
    currentLocation?.recordedAt,
  ])

  const {
    currentVehicleSpeedLabel,
    driverLocationMarker,
    exactDriverLocationLabel,
    handleMobileMapRecenter,
    handleRouteLineSelect,
    handleToggleMapPerspective,
    liveDistanceToManeuverMeters,
    mapCenter,
    mapLocations,
    mapRouteLines,
    mobileMapCenter,
  } = useTripNavigation({
    activeRouteOptionIndex,
    currentLocation,
    currentStepIndex,
    isTracking,
    mobileMapRecenterCenter,
    navigationRouteAbortRef,
    navigationRouteCheckEpoch,
    navigationRouteLastRequestAtRef,
    navigationRouteOrigin,
    navigationRouteRequestInFlightRef,
    navigationRouteRetryAtRef,
    navigationRouteSelectionEpochRef,
    navigationStopsKeyRef,
    previewDriverLocation,
    routeOptions,
    routeSteps,
    setActiveRouteOptionIndex,
    setCurrentStepIndex,
    setIs3DPerspective,
    setMobileMapRecenterCenter,
    setMobileMapRecenterSignal,
    setNavigationRouteOrigin,
    setPreviewDriverLocation,
    setRouteOptions,
    setRouteSteps,
    sortedDropPoints,
    spokenNavigationPromptsRef,
    trip,
    voiceGuidanceEnabled,
  })
  const renderEmptiesReturnInput = (dropPoint: DropPoint) => {
    // The customer's checkout declaration is what has to be verified: it already
    // reduced what they pay, and anything short is charged back on the order.
    const declaredEmpties = ((dropPoint as any)?.declaredEmpties || []) as Array<{
      declarationId?: string
      containerTypeId: string
      containerTypeName?: string
      productName?: string
      declaredQuantity?: number
      declaredUnits?: number
      containersPerUnit?: number
      containersPerCase?: number
      declaredCases?: number
      declaredLooseBottles?: number
      isRefundClaim?: boolean
      countsByCase?: boolean
      unitLabel?: string
      depositValue?: number
    }>

    // Cased goods are counted in cases and loose goods in bottles; a driver hands
    // back twelve cases, not two hundred and eighty-eight bottles. The stored value
    // stays in containers so the settlement arithmetic is untouched.
    const containerTypesMap = new Map<string, {
      containerTypeId: string
      typeName: string
      declared: number
      perUnit: number
      containersPerCase: number
      declaredCases: number
      declaredLooseBottles: number
      isRefundClaim: boolean
      depositValue: number
    }>()
    for (const entry of declaredEmpties) {
      if (!entry?.containerTypeId) continue
      const declarationId = entry.declarationId || entry.containerTypeId
      const perUnit = Math.max(1, Number(entry.containersPerUnit || 1))
      const containersPerCase = Math.max(1, Number(entry.containersPerCase || perUnit))
      containerTypesMap.set(declarationId, {
        containerTypeId: entry.containerTypeId,
        // Show the exact product selected for the refund when it is available.
        typeName: entry.productName || entry.containerTypeName || 'Returnable Container',
        declared: Math.max(0, Number(entry.declaredQuantity || 0)),
        perUnit,
        containersPerCase,
        declaredCases: Math.max(0, Number(entry.declaredCases ?? (perUnit > 1 ? entry.declaredUnits : 0) ?? 0)),
        declaredLooseBottles: Math.max(0, Number(entry.declaredLooseBottles ?? (perUnit > 1 ? 0 : entry.declaredQuantity) ?? 0)),
        isRefundClaim: Boolean(entry.isRefundClaim),
        depositValue: Math.max(0, Number(entry.depositValue || 0)),
      })
    }

    if (containerTypesMap.size === 0) {
      // Older payloads carry no declaration; still let the driver record a count.
      const returnableItems = ((dropPoint as any)?.order?.orderItems || []).filter((item: any) => item.product?.packagingType === 'RETURNABLE')
      for (const item of returnableItems) {
        const cType = item.product?.containerTypeId
        if (cType && !containerTypesMap.has(cType)) {
          containerTypesMap.set(cType, {
            containerTypeId: cType,
            typeName: item.product?.containerTypeName || 'Returnable Container',
            declared: 0,
            perUnit: 1,
            containersPerCase: Math.max(1, Number(item.product?.containersPerCase || 1)),
            declaredCases: 0,
            declaredLooseBottles: 0,
            isRefundClaim: false,
            depositValue: 0,
          })
        }
      }
    }

    if (containerTypesMap.size === 0) return null

    const dropPointId = dropPoint.id!
    const currentEmpties = returnedEmptiesByDropPoint[dropPointId] || []

    const handleUpdateQuantity = (
      declarationId: string,
      cTypeId: string,
      cTypeName: string,
      returnedCases: number,
      returnedLooseBottles: number,
      maxCases: number,
      maxLooseBottles: number,
      containersPerCase: number,
    ) => {
      // Keep the UI breakdown while submitting the combined bottle quantity used
      // by the existing deposit settlement and bottle inventory records.
      const cases = Math.min(Math.max(0, returnedCases), Math.max(0, maxCases))
      const looseBottles = Math.min(Math.max(0, returnedLooseBottles), Math.max(0, maxLooseBottles))
      const qty = (cases * containersPerCase) + looseBottles
      setReturnedEmptiesByDropPoint(prev => {
        const current = prev[dropPointId] || []
        const existingIdx = current.findIndex(e => (e.declarationId || e.containerTypeId) === declarationId)
        let next = [...current]
        if (existingIdx >= 0) {
          next[existingIdx] = { ...next[existingIdx], returnedQuantity: qty, returnedCases: cases, returnedLooseBottles: looseBottles }
        } else {
          next.push({ declarationId, containerTypeId: cTypeId, containerTypeName: cTypeName, returnedQuantity: qty, returnedCases: cases, returnedLooseBottles: looseBottles })
        }
        return { ...prev, [dropPointId]: next }
      })
    }

    return (
      <div className="space-y-3 border-t border-b border-slate-200 py-3 mb-3 bg-slate-50/50 -mx-4 px-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">Empties collected</p>
          <p className="text-xs text-slate-500">Count what the customer actually hands over. Anything short of the declared amount is charged back on this order.</p>
        </div>
        {Array.from(containerTypesMap.entries()).map(([declarationId, {
          containerTypeId: cTypeId,
          typeName,
          declared,
          containersPerCase,
          declaredCases,
          declaredLooseBottles,
          isRefundClaim,
          depositValue: declaredDepositValue,
        }]) => {
          const stored = currentEmpties.find(e => (e.declarationId || e.containerTypeId) === declarationId)
          const storedQuantity = Math.min(Math.max(0, Number(stored?.returnedQuantity ?? declared)), declared)
          const currentCases = Math.min(
            declaredCases,
            Math.max(0, Number(stored?.returnedCases ?? (stored ? Math.floor(storedQuantity / containersPerCase) : declaredCases))),
          )
          const currentLooseBottles = Math.min(
            declaredLooseBottles,
            Math.max(0, Number(stored?.returnedLooseBottles ?? (stored ? storedQuantity - (currentCases * containersPerCase) : declaredLooseBottles))),
          )
          const currentVal = (currentCases * containersPerCase) + currentLooseBottles
          const short = Math.max(0, declared - currentVal)
          const shortCases = Math.max(0, declaredCases - currentCases)
          const shortLooseBottles = Math.max(0, declaredLooseBottles - currentLooseBottles)
          const formatBreakdown = (cases: number, bottles: number) => [
            cases > 0 ? `${cases} case${cases === 1 ? '' : 's'}` : '',
            bottles > 0 ? `${bottles} loose bottle${bottles === 1 ? '' : 's'}` : '',
          ].filter(Boolean).join(' + ') || '0 bottles'
          return (
            <div key={declarationId} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium text-slate-700">{typeName}</p>
                  {isRefundClaim ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                      Refunded empty
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  Customer declared: {formatBreakdown(declaredCases, declaredLooseBottles)}
                </p>
                {short > 0 ? (
                  <p className="text-xs font-semibold text-[#b42318]">
                    {formatBreakdown(shortCases, shortLooseBottles)} short -{' '}
                    {formatCurrency((declaredDepositValue * short) / Math.max(1, declared))} added to this order
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {declaredCases > 0 ? (
                  <div className="flex shrink-0 items-center space-x-2 rounded-lg border bg-white px-1 py-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-600" onClick={(e) => { e.stopPropagation(); handleUpdateQuantity(declarationId, cTypeId, typeName, currentCases - 1, currentLooseBottles, declaredCases, declaredLooseBottles, containersPerCase) }} disabled={currentCases <= 0}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-[4.5rem] text-center text-sm font-medium">{currentCases} case{currentCases === 1 ? '' : 's'}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-600" onClick={(e) => { e.stopPropagation(); handleUpdateQuantity(declarationId, cTypeId, typeName, currentCases + 1, currentLooseBottles, declaredCases, declaredLooseBottles, containersPerCase) }} disabled={currentCases >= declaredCases}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
                {declaredLooseBottles > 0 ? (
                  <div className="flex shrink-0 items-center space-x-2 rounded-lg border bg-white px-1 py-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-600" onClick={(e) => { e.stopPropagation(); handleUpdateQuantity(declarationId, cTypeId, typeName, currentCases, currentLooseBottles - 1, declaredCases, declaredLooseBottles, containersPerCase) }} disabled={currentLooseBottles <= 0}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-[5rem] text-center text-sm font-medium">{currentLooseBottles} bottle{currentLooseBottles === 1 ? '' : 's'}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-600" onClick={(e) => { e.stopPropagation(); handleUpdateQuantity(declarationId, cTypeId, typeName, currentCases, currentLooseBottles + 1, declaredCases, declaredLooseBottles, containersPerCase) }} disabled={currentLooseBottles >= declaredLooseBottles}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className={isMobileViewport ? 'space-y-0 p-0' : 'space-y-4 p-4'}>
          {/* Header */}
          <div className="hidden rounded-2xl border border-emerald-300/40 bg-blue-700 px-3 pb-3 pt-2.5 text-white shadow-[0_12px_26px_rgba(2,132,199,0.22)] md:mt-0 md:block md:px-4 md:pb-4 md:pt-3">
            <Button variant="ghost" size="sm" className="mb-1 h-6 p-0 text-[11px] text-white hover:bg-white/10 md:mb-2 md:h-7 md:text-xs" onClick={onBack}>
              &lt; Back to Trips
            </Button>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold leading-tight md:text-xl">{trip.tripNumber}</h2>
                <p className="text-slate-300 text-xs md:text-sm">{trip.vehicle?.licensePlate}</p>
                <p className="text-slate-300 text-xs md:text-sm">Schedule: {formatTripScheduledDay(trip)}</p>
                {/* Added: show the running total from successfully delivered stops. */}
                <p className="text-slate-200 text-xs md:text-sm">Cash collected: {formatCurrency(Number(trip.cashCollectedTotal || 0))}</p>
              </div>
              <Badge className="border border-slate-300/20 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-900 md:px-2.5 md:py-1 md:text-xs">
                {effectiveCompletedDropPoints}/{trip.totalDropPoints} Completed
              </Badge>
            </div>
          </div>

          {/* Location Permission Warning */}
          {locationPermission === 'denied' && !driverLocationMarker && (
            <div className="rounded border-l-4 border-red-500 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
                <div>
                  <p className="font-medium text-red-800">Location Access Required</p>
                  <p className="mt-1 text-sm text-red-600">
                    Please enable location access in your browser settings to enable live tracking.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Dialog
            open={isStartTripConfirmOpen}
            onOpenChange={(open) => {
              if (isUpdating) return
              setIsStartTripConfirmOpen(open)
            }}
          >
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-[#123a67]">{isUpdating ? 'Opening trip session...' : 'Start Trip?'}</DialogTitle>
                <DialogDescription className="text-slate-600">
                  {isUpdating
                    ? 'Please keep the Driver app open while the session is confirmed.'
                    : <>This will mark the trip as <span className="font-semibold">IN PROGRESS</span>.</>}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[calc(100dvh-8rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-2 text-sm text-slate-700">
                {isUpdating ? (
                  <div role="status" className="flex min-h-32 flex-col items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-4 py-6 text-center">
                    <Loader2 className="mb-3 h-7 w-7 animate-spin text-emerald-600" />
                    <p className="font-semibold text-slate-900">Opening delivery session</p>
                    <p className="mt-1 text-slate-600">Waiting for the server to confirm this trip.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                      <p className="font-medium text-slate-900">{trip.tripNumber || 'Selected Trip'}</p>
                      <p>Make sure all assigned orders are loaded before continuing.</p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-900">Trip Load Summary</p>
                        <span className="text-xs text-slate-500">{startTripLoadSummary.length} product{startTripLoadSummary.length === 1 ? '' : 's'}</span>
                      </div>
                      {startTripLoadSummary.length > 0 ? (
                        <ul className="divide-y divide-slate-100">
                          {startTripLoadSummary.map((item) => (
                            <li key={`${item.productName}-${item.unit}`} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                              <span className="min-w-0 font-medium text-slate-700">{item.productName}</span>
                              <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                                {item.quantity.toLocaleString()} {item.unit}{item.quantity === 1 ? '' : 's'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">No products are assigned to this trip.</p>
                      )}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={loadConfirmed}
                        onChange={(event) => setLoadConfirmed(event.target.checked)}
                        disabled={Boolean(startBlockedReason)}
                        className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                      />
                      Confirm Load
                    </label>
                    {(startError || startBlockedReason) && (
                      <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                        {startError || startBlockedReason}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button type="button" variant="outline" onClick={() => setIsStartTripConfirmOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={async () => {
                          if (await handleStartTrip()) setIsStartTripConfirmOpen(false)
                        }}
                        disabled={!loadConfirmed || Boolean(startBlockedReason)}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Start Trip
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isArriveWarningOpen} onOpenChange={setIsArriveWarningOpen}>
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-[1.2rem] font-black tracking-[-0.02em] text-emerald-700">Confirm Mark Arrived</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 px-5 pb-5 pt-2 text-sm text-slate-700">
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p>Please confirm that you are physically at the drop point before continuing.</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="font-medium text-slate-900">{arriveTargetDropPointName || 'Drop Point'}</p>
                </div>
                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => setIsArriveWarningOpen(false)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="h-11 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={async () => {
                      const targetId = String(arriveTargetDropPointId || '').trim()
                      setIsArriveWarningOpen(false)
                      if (!targetId) return
                      setArrivingDropPointId(targetId)
                      try {
                        await handleUpdateDropPoint(targetId, 'ARRIVED')
                      } finally {
                        setArrivingDropPointId(null)
                      }
                    }}
                    disabled={isUpdating || !arriveTargetDropPointId}
                  >
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Navigation className="mr-2 h-4 w-4" />}
                    Confirm Arrived
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={isDeliveredWarningOpen}
            onOpenChange={(open) => {
              if (isConfirmDeliveredSubmitting) return
              setIsDeliveredWarningOpen(open)
            }}
          >
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-[#0f3d72]">{isConfirmDeliveredSubmitting ? 'Confirming delivery...' : 'Confirm Mark as Delivered'}</DialogTitle>
                <DialogDescription className="text-slate-600">
                  {isConfirmDeliveredSubmitting
                    ? 'Please keep the Driver app open while the delivery is saved.'
                    : 'You are about to complete this stop and set the order status to delivered.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 px-5 pb-5 pt-2 text-sm text-slate-700">
                {isConfirmDeliveredSubmitting ? (
                  <div role="status" className="flex min-h-32 flex-col items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
                    <Loader2 className="mb-3 h-7 w-7 animate-spin text-emerald-600" />
                    <p className="font-semibold text-slate-900">Confirming delivery</p>
                    <p className="mt-1 text-slate-600">Uploading the POD and saving this completed stop.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                      <p>Please confirm POD photo and delivery details are correct.</p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <p className="font-medium text-slate-900">{deliveredTargetDropPointName || 'Drop Point'}</p>
                    </div>
                    {deliveryError && <p role="alert" className="text-sm text-red-600">{deliveryError}</p>}
                    <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                      <Button type="button" variant="outline" onClick={() => setIsDeliveredWarningOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={async () => {
                          const targetId = String(deliveredTargetDropPointId || '').trim()
                          if (!targetId) return
                          const targetDropPoint = sortedDropPoints.find((point) => String(point.id) === targetId)
                          if (!targetDropPoint) return
                          setIsConfirmDeliveredSubmitting(true)
                          try {
                            const completed = await submitDeliveredForDropPoint(targetDropPoint)
                            if (completed) setIsDeliveredWarningOpen(false)
                          } finally {
                            setIsConfirmDeliveredSubmitting(false)
                          }
                        }}
                        disabled={isUpdating || !deliveredTargetDropPointId}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Confirm Delivered
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Route Map */}
          {!isMobileViewport ? (
            <div className="hidden rounded-2xl border border-sky-200/60 bg-white/90 p-4 pt-0 shadow-[0_14px_30px_rgba(15,23,42,0.12)] backdrop-blur md:block md:rounded-2xl md:border md:border-sky-200/60 md:bg-white/90 md:shadow-[0_14px_30px_rgba(15,23,42,0.12)] md:backdrop-blur">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-slate-900">Route Map</h3>
                  <Button
                    variant={is3DPerspective ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleToggleMapPerspective}
                  >
                    3D View
                  </Button>
                  <Button
                    variant={voiceGuidanceEnabled ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setVoiceGuidanceEnabled((previous) => !previous)}
                  >
                    {voiceGuidanceEnabled ? <Volume2 className="mr-1 h-3.5 w-3.5" /> : <VolumeX className="mr-1 h-3.5 w-3.5" />}
                    Voice
                  </Button>
                </div>
                <p className="text-xs font-medium text-slate-700">
                  Exact Driver Location: {exactDriverLocationLabel || 'Unavailable'}
                </p>
              </div>
              {!mapCenter ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">
                  No map data for this trip yet. Add delivery coordinates to order shipping addresses.
                </div>
              ) : (
                <div className="relative">
                  {trip.status === 'IN_PROGRESS' && routeSteps.length > 0 && (
                    <div className="absolute left-4 top-4 z-[1000] w-80">
                      <NavInstructionsPanel
                        steps={routeSteps}
                        currentStepIndex={currentStepIndex}
                        showUpcomingManeuver
                        liveManeuverDistanceMeters={liveDistanceToManeuverMeters}
                        destinationName={highlightedDropPoint?.locationName}
                        variant="mobile-compact"
                        onSpeak={voiceGuidanceEnabled ? speakNavigationPrompt : undefined}
                      />
                    </div>
                  )}
                  <LiveTrackingMap
                    locations={mapLocations}
                    routeLines={mapRouteLines}
                    onRouteLineSelect={handleRouteLineSelect}
                    center={mapCenter}
                    zoom={13}
                    navigationPerspective
                    is3DPerspective={is3DPerspective}
                    recenterSignal={mobileMapRecenterSignal}
                    restrictToNegrosOccidental
                    showDriverSelfBadge
                    showZoomControls={false}
                    className="h-[240px] w-full overflow-hidden rounded-xl border shadow-sm md:h-[400px]"
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* Start Trip Button - Desktop */}
          {!isMobileViewport && trip.status === 'PLANNED' && tripIsOverdue && (
            // Added: an overdue trip offers no Start, only the reason.
            <div role="status" className="hidden rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 md:block">
              {startBlockedReason}
            </div>
          )}
          {!isMobileViewport && trip.status === 'PLANNED' && !tripIsOverdue && (
            <div className="hidden space-y-2 md:block">
              {startBlockedReason && (
                <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  {startBlockedReason}
                </p>
              )}
              <Button
                className="h-12 w-full gap-2 rounded-xl bg-[#1d4ed8] text-lg font-semibold text-white shadow-[0_10px_24px_rgba(29,78,216,0.28)] transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  // Fix: load confirmation belongs only in the Start Trip dialog.
                  setLoadConfirmed(false)
                  setStartError(null)
                  setIsStartTripConfirmOpen(true)
                }}
                disabled={isUpdating || Boolean(startBlockedReason)}
              >
                {isUpdating ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
                Start Trip
              </Button>
            </div>
          )}

          {isMobileViewport ? (
            <div className="relative overflow-hidden md:hidden">
              <div ref={mobileMapViewportRef} className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#f8fbfe]">
                {/* Top Navigation & Status Bar */}
                <div ref={mobileTopOverlayRef} className="pointer-events-none absolute left-0 right-0 top-0 z-[1000] flex flex-col gap-2.5 px-4 pt-4">
                  {trip.status === 'IN_PROGRESS' && routeSteps.length > 0 && (
                    <div className="mt-1">
                      <NavInstructionsPanel
                        steps={routeSteps}
                        currentStepIndex={currentStepIndex}
                        showUpcomingManeuver
                        liveManeuverDistanceMeters={liveDistanceToManeuverMeters}
                        destinationName={highlightedDropPoint?.locationName}
                        variant="mobile-compact"
                        onSpeak={voiceGuidanceEnabled ? speakNavigationPrompt : undefined}
                      />
                    </div>
                  )}

                  <div className="pointer-events-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onBack}
                      aria-label="Back to trips"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-sm transition hover:bg-slate-50"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 shadow-sm">
                      Route Map
                    </div>
                    <div className="min-w-0 flex-1 truncate rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-900 shadow-sm">
                      Exact: {exactDriverLocationLabel || 'Unavailable'}
                    </div>
                  </div>
                </div>

                {/* Map Area */}
                <div className={`relative flex-1 w-full bg-slate-100 overflow-hidden transition-all duration-500 map-container-3d-wrapper ${is3DPerspective ? 'is-3d' : ''}`}>
                  {!mobileMapCenter ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-600">
                      No map data for this trip yet. Add delivery coordinates to order shipping addresses.
                    </div>
                  ) : (
                    <>
                      <LiveTrackingMap
                        locations={mapLocations}
                        routeLines={mapRouteLines}
                        onRouteLineSelect={handleRouteLineSelect}
                        center={mobileMapCenter}
                        zoom={13}
                        navigationPerspective
                        is3DPerspective={is3DPerspective}
                        restrictToNegrosOccidental
                        showDriverSelfBadge
                        recenterSignal={mobileMapRecenterSignal}
                        zoomInSignal={mobileMapZoomInSignal}
                        zoomOutSignal={mobileMapZoomOutSignal}
                        navigationViewportInsets={mobileNavigationViewportInsets}
                        showZoomControls={false}
                        className="absolute inset-0 h-full w-full overflow-hidden rounded-none border-0 shadow-none"
                      />
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleMobileMapRecenter}
                  aria-label="Recenter map to driver location"
                  className="absolute bottom-[calc(env(safe-area-inset-bottom)+8.25rem)] right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.14)] backdrop-blur"
                >
                  <LocateFixed className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={handleToggleMapPerspective}
                  aria-label="Toggle 3D View"
                  className={`absolute bottom-[calc(env(safe-area-inset-bottom)+11.45rem)] right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border shadow-[0_8px_18px_rgba(15,23,42,0.14)] backdrop-blur transition-all ${is3DPerspective ? 'bg-sky-600 border-sky-700 text-white' : 'bg-white/95 border-slate-200 text-slate-900'}`}
                >
                  <span className="text-sm font-bold">3D</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceGuidanceEnabled((previous) => !previous)}
                  aria-label={voiceGuidanceEnabled ? 'Turn voice guidance off' : 'Turn voice guidance on'}
                  className={`absolute bottom-[calc(env(safe-area-inset-bottom)+14.65rem)] right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border shadow-[0_8px_18px_rgba(15,23,42,0.14)] backdrop-blur transition-all ${voiceGuidanceEnabled ? 'bg-emerald-600 border-emerald-700 text-white' : 'bg-white/95 border-slate-200 text-slate-900'}`}
                >
                  {voiceGuidanceEnabled ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5" />}
                </button>

                {/* Added: compact zoom controls positioned directly above voice guidance. */}
                <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+17.85rem)] right-4 z-40 flex flex-col overflow-hidden rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.14)] backdrop-blur">
                  <button
                    type="button"
                    onClick={() => setMobileMapZoomInSignal((previous) => previous + 1)}
                    aria-label="Zoom in"
                    className="flex h-10 w-10 items-center justify-center transition hover:bg-slate-50 active:bg-slate-100"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                  <div className="mx-2 h-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={() => setMobileMapZoomOutSignal((previous) => previous + 1)}
                    aria-label="Zoom out"
                    className="flex h-10 w-10 items-center justify-center transition hover:bg-slate-50 active:bg-slate-100"
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                </div>

                {/* Start Trip Button - Mobile */}
                {trip.status === 'PLANNED' && tripIsOverdue && (
                  // Added: an overdue trip offers no Start, only the reason.
                  <div role="status" className="absolute bottom-[calc(env(safe-area-inset-bottom)+7rem)] left-4 right-4 z-[1100] rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm font-medium text-amber-900 shadow-lg backdrop-blur">
                    {startBlockedReason}
                  </div>
                )}
                {trip.status === 'PLANNED' && !tripIsOverdue && (
                  <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+7rem)] left-4 right-4 z-[1100] space-y-2">
                    {startBlockedReason && (
                      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm font-medium text-amber-900 shadow-lg backdrop-blur">
                        {startBlockedReason}
                      </p>
                    )}
                    <Button
                      className="h-12 w-full gap-2 rounded-xl bg-[#1d4ed8] text-lg font-semibold text-white shadow-[0_10px_24px_rgba(29,78,216,0.28)] transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        // Fix: require a fresh confirmation inside the Start Trip dialog.
                        setLoadConfirmed(false)
                        setStartError(null)
                        setIsStartTripConfirmOpen(true)
                      }}
                      disabled={isUpdating || Boolean(startBlockedReason)}
                    >
                      {isUpdating ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Play className="h-5 w-5" />
                      )}
                      Start Trip
                    </Button>
                  </div>
                )}

                <Drawer
                  open={!hasBlockingDialogOpen}
                  onOpenChange={handleMobileSheetOpenChange}
                  direction="bottom"
                  dismissible={false}
                  repositionInputs={false}
                  handleOnly={false}
                  modal={false}
                  fixed
                  snapPoints={mobileSheetSnapPoints}
                  activeSnapPoint={mobileSheetSnapPoint}
                  setActiveSnapPoint={handleMobileSheetSnapPointChange}
                  onAnimationEnd={handleMobileSheetAnimationEnd}
                >
                  <DrawerContent
                    ref={mobileDrawerRef}
                    hideOverlay
                    className="driver-trip-drawer-motion !bottom-0 !left-0 !right-0 !w-full !max-w-none !z-[1200] !mt-0 !h-[100dvh] !max-h-[100dvh] transform-gpu will-change-transform !rounded-t-[24px] [&>div:first-child]:hidden border-x-0 border-t border-white/80 bg-white/96 shadow-[0_-18px_50px_rgba(15,23,42,0.18)]"
                  >
                    <div
                      ref={mobileSheetPeekRef}
                      aria-hidden={false}
                      role="button"
                      tabIndex={0}
                      aria-label={isMobileSheetOpen ? 'Collapse trip drop points' : 'Expand trip drop points'}
                      aria-expanded={isMobileSheetOpen}
                      className="!m-0 !h-auto min-h-[112px] !w-full shrink-0 touch-none !rounded-none !bg-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 text-left"
                      onPointerDown={(event) => {
                        mobileSheetHeaderGestureRef.current = { startY: event.clientY, dragged: false }
                      }}
                      onPointerMove={(event) => {
                        if (Math.abs(event.clientY - mobileSheetHeaderGestureRef.current.startY) > 5) {
                          mobileSheetHeaderGestureRef.current.dragged = true
                        }
                      }}
                      onClick={() => {
                        // Fix: a released drag must not also trigger the summary's tap action.
                        if (!mobileSheetHeaderGestureRef.current.dragged) {
                          setMobileSheetSnapPoint(isMobileSheetOpen ? mobileSheetPeekSnap : 0.52)
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setMobileSheetSnapPoint(isMobileSheetOpen ? mobileSheetPeekSnap : 0.52)
                        }
                      }}
                    >
                      <span className="mx-auto mb-2 block h-1.5 w-14 rounded-full bg-slate-300" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Drop Points</p>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-black tracking-[-0.02em] text-slate-900">{trip.tripNumber}</p>
                          <p className="text-[11px] text-slate-500">Schedule: {formatTripScheduledDay(trip)}</p>
                          {/* Added: keep the running trip cash visible on the mobile driver view. */}
                          <p className="text-[11px] font-semibold text-emerald-700">Cash collected: {formatCurrency(Number(trip.cashCollectedTotal || 0))}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <p className="text-xs font-black text-slate-900">
                            {currentVehicleSpeedLabel}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {effectiveCompletedDropPoints}/{trip.totalDropPoints} Delivered
                          </span>
                        </div>
                      </div>
                    </div>
                    <div
                      inert={!isMobileSheetOpen}
                      className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] pt-2 pr-3"
                      style={{ maxHeight: `calc(${(isMobileSheetOpen ? mobileSheetVisibleFraction : 1) * 100}dvh - ${mobileSheetPeekHeight}px)` }}
                    >
                      <DrawerTitle className="sr-only">Trip drop points</DrawerTitle>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Drop Points</p>
                          <h3 className="text-xl font-black tracking-[-0.02em] text-slate-900">{highlightedDropPoint?.locationName || 'Trip overview'}</h3>
                          <p className="text-sm text-slate-500">
                            {highlightedDropPoint ? `${highlightedDropPoint.sequence}/${trip.totalDropPoints} | ${highlightedDropPoint.status}` : `${effectiveCompletedDropPoints}/${trip.totalDropPoints} Completed`}
                          </p>
                        </div>
                        {highlightedDropPoint ? (
                          <Badge className={dropPointStatusColors[highlightedDropPoint.status] || 'bg-gray-100'}>
                            {highlightedDropPoint.status}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-3 pb-1">
                        {sortedDropPoints.map((dropPoint) => (
                          <Card
                            key={dropPoint.id}
                            className={`cursor-pointer rounded-2xl border transition-all duration-200 ${activeDropPoint?.id === dropPoint.id ? 'border-slate-900/30 bg-slate-900/5 shadow-[0_6px_16px_rgba(15,23,42,0.08)]' : 'border-slate-200/70 bg-white/90 shadow-[0_4px_12px_rgba(15,23,42,0.04)]'}`}
                            onClick={() => setActiveDropPoint(activeDropPoint?.id === dropPoint.id ? null : dropPoint)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${dropPoint.status === 'COMPLETED' ? 'bg-green-500 text-white' :
                                    dropPoint.status === 'FAILED' ? 'bg-red-500 text-white' :
                                      'bg-gray-200 text-gray-600'
                                  }`}>
                                  {dropPoint.status === 'COMPLETED' ? <CheckCircle className="h-4 w-4" /> : dropPoint.sequence}
                                </div>
                                {/* Fix: let mobile details shrink so the status badge stays inside the card. */}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1 break-words">
                                      <p className="font-medium text-slate-900">{dropPoint.locationName}</p>
                                      <p className="text-sm text-slate-500">{stripPhilippinesFromAddress(dropPoint.address)}</p>
                                      {dropPoint.order ? (
                                        <>
                                          <p className="mt-1 text-xs text-sky-700">{dropPoint.order.orderNumber}</p>
                                          {(() => {
                                            const orderNumberKey = String(dropPoint.order?.orderNumber || '').trim().toUpperCase()
                                            const isReplacementOrder = Boolean((dropPoint.order as any)?.isScheduledReplacement) || orderNumberKey.startsWith('RPL-')
                                            if (isReplacementOrder) {
                                              return (
                                                <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                                  <p className="text-[11px] font-semibold text-emerald-800">
                                                    Replacement Delivery • Free / No Collection (₱0.00)
                                                  </p>
                                                </div>
                                              )
                                            }
                                            const emptiesShortfall = getEmptiesShortfallAmount(dropPoint)
                                            const orderTotal = getDisplayOrderTotal(dropPoint.order)
                                            return (
                                              <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
                                                <p className="text-[11px] font-semibold text-amber-800">
                                                  Total Price: {formatCurrency(orderTotal)}
                                                </p>
                                                {emptiesShortfall > 0 ? (
                                                  <>
                                                    <p className="mt-1 text-[10px] text-amber-700">
                                                      + {formatCurrency(emptiesShortfall)} deposit for empties not handed over
                                                    </p>
                                                    <p className="mt-0.5 text-[11px] font-bold text-amber-900">
                                                      Collect: {formatCurrency(orderTotal + emptiesShortfall)}
                                                    </p>
                                                  </>
                                                ) : null}
                                                <EmptiesChargeNote order={dropPoint.order} className="mt-1.5" />
                                              </div>
                                            )
                                          })()}
                                          {(dropPoint.order.items || []).length > 0 ? (
                                            <div className="mt-1 rounded-md bg-slate-50 px-2 py-1.5">
                                              {(() => {
                                                const orderNumberKey = String(dropPoint.order?.orderNumber || '').trim().toUpperCase()
                                                const isReplacementOrder = Boolean((dropPoint.order as any)?.isScheduledReplacement) || orderNumberKey.startsWith('RPL-')
                                                return (
                                                  <div className="mb-1 flex flex-wrap items-center gap-2">
                                                    <p className="text-[11px] font-semibold text-slate-600">
                                                      {isReplacementOrder ? 'Replacement Details' : 'Order Details'}
                                                    </p>
                                                    {isReplacementOrder ? (
                                                      <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                                                        Replacement
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                )
                                              })()}
                                              <div className="mt-1 space-y-0.5">
                                                {(dropPoint.order.items || []).map((item, index) => (
                                                  <div key={`${dropPoint.id}-mobile-item-${index}`} className="text-[11px] text-slate-600">
                                                    <p>{getItemDisplayNameWithSize(item)} {getOrderQtyWithUnitLabel(item, dropPoint.order)}</p>
                                                    {getItemCategoryLabel(item) ? <p className="text-[10px] text-slate-500">{getItemCategoryLabel(item)}</p> : null}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}
                                        </>
                                      ) : null}
                                    </div>
                                    <Badge className={dropPointStatusColors[dropPoint.status] || 'bg-gray-100'}>
                                      {dropPoint.status}
                                    </Badge>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-3">
                                    {dropPoint.contactPhone ? (
                                      <a href={`tel:${dropPoint.contactPhone}`} className="inline-flex items-center gap-1 text-sm text-sky-700">
                                        <Phone className="h-4 w-4" />
                                        Call Contact
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              {activeDropPoint?.id === dropPoint.id && trip.status === 'IN_PROGRESS' && (
                                <div
                                  className="mt-4 space-y-3 border-t pt-4"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {['PENDING', 'IN_TRANSIT'].includes(String(dropPoint.status || '').toUpperCase()) && (
                                    <Button
                                      className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                                      onClick={(e) => { e.stopPropagation(); openArriveWarning(dropPoint); }}
                                      disabled={isUpdating}
                                    >
                                      {arrivingDropPointId === String(dropPoint.id) ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                      ) : (
                                        <Navigation className="mr-2 h-4 w-4" />
                                      )}
                                      {arrivingDropPointId === String(dropPoint.id) ? 'Marking Arrived...' : 'Mark Arrived'}
                                    </Button>
                                  )}
                                  {dropPoint.status === 'ARRIVED' && (
                                    <div className="space-y-3">
                                      {renderEmptiesReturnInput(dropPoint)}
                                      <Textarea
                                        placeholder="Add delivery notes..."
                                        value={deliveryNote}
                                        onChange={(e) => setDeliveryNote(e.target.value)}
                                      />
                                      <div className="space-y-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="w-full"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openPodCameraCapture(String(dropPoint.id || ''))
                                          }}
                                        >
                                          <Camera className="mr-2 h-4 w-4" />
                                          {podDraftByDropPoint[String(dropPoint.id || '')]?.preview ? 'Retake POD Photo' : 'Capture POD Photo'}
                                        </Button>
                                        <p className="text-xs text-slate-500">Camera access is required before marking as delivered.</p>
                                        {podDraftByDropPoint[String(dropPoint.id || '')]?.preview ? (
                                          <PodImagePreview
                                            src={podDraftByDropPoint[String(dropPoint.id || '')]?.preview || ''}
                                            alt="POD preview"
                                            // Fix: contain the POD image so no captured edges or overlay text are cropped.
                                            className="h-64 w-full rounded-md border border-slate-200 bg-slate-950 object-contain"
                                          />
                                        ) : null}
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <Button
                                          className="bg-emerald-600 hover:bg-emerald-700"
                                          onClick={async (e) => {
                                            e.stopPropagation()
                                            openDeliveredWarning(dropPoint)
                                          }}
                                          disabled={isUpdating}
                                        >
                                          <CheckCircle className="mr-2 h-4 w-4" />
                                          Delivered
                                        </Button>
                                        <Button
                                          variant="destructive"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openFailedDeliveryChoice(dropPoint.id)
                                          }}
                                          disabled={isUpdating}
                                        >
                                          <AlertCircle className="mr-2 h-4 w-4" />
                                          Failed
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                      {tripCompletionSection ? (
                        <div className="mt-4 space-y-3 px-1 pb-2">{tripCompletionSection}</div>
                      ) : null}
                    </div>
                  </DrawerContent>
                </Drawer>
              </div>
            </div>
          ) : null}

          {/* Drop Points List */}
          <div className="hidden md:block">
            <h3 className="mb-3 font-semibold text-slate-900">Drop Points</h3>
            <div className="space-y-3">
              {sortedDropPoints.map((dropPoint) => (
                <Card
                  key={dropPoint.id}
                  className={`cursor-pointer rounded-lg border transition-all duration-200 ${activeDropPoint?.id === dropPoint.id ? 'border-slate-900/30 bg-slate-900/5 shadow-[0_4px_12px_rgba(0,0,0,0.1)]' : 'border-slate-200/50 bg-white/90 shadow-[0_2px_6px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 hover:shadow-[0_6px_12px_rgba(0,0,0,0.08)]'}`}
                  onClick={() => setActiveDropPoint(activeDropPoint?.id === dropPoint.id ? null : dropPoint)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${dropPoint.status === 'COMPLETED' ? 'bg-green-500 text-white' :
                          dropPoint.status === 'FAILED' ? 'bg-red-500 text-white' :
                            'bg-gray-200 text-gray-600'
                        }`}>
                        {dropPoint.status === 'COMPLETED' ? <CheckCircle className="h-4 w-4" /> : dropPoint.sequence}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{dropPoint.locationName}</p>
                            <p className="text-sm text-slate-500">{stripPhilippinesFromAddress(dropPoint.address)}</p>
                            {dropPoint.order && (
                              <>
                                <p className="mt-1 text-xs text-sky-700">{dropPoint.order.orderNumber}</p>
                                {(() => {
                                  const orderNumberKey = String(dropPoint.order?.orderNumber || '').trim().toUpperCase()
                                  const isReplacementOrder = Boolean((dropPoint.order as any)?.isScheduledReplacement) || orderNumberKey.startsWith('RPL-')
                                  if (isReplacementOrder) {
                                    return (
                                      <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                        <p className="text-[11px] font-semibold text-emerald-800">
                                          Replacement Delivery • Free / No Collection (₱0.00)
                                        </p>
                                      </div>
                                    )
                                  }
                                  return (
                                    <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
                                      <p className="text-[11px] font-semibold text-amber-800">
                                        Total Price: {formatCurrency(getDisplayOrderTotal(dropPoint.order))}
                                        {getEmptiesShortfallAmount(dropPoint) > 0 ? (
                                          <span className="ml-2 font-bold">
                                            &middot; Collect {formatCurrency(getDisplayOrderTotal(dropPoint.order) + getEmptiesShortfallAmount(dropPoint))}
                                            {' '}(incl. {formatCurrency(getEmptiesShortfallAmount(dropPoint))} empties deposit)
                                          </span>
                                        ) : null}
                                      </p>
                                    </div>
                                  )
                                })()}
                                {(dropPoint.order.items || []).length > 0 ? (
                                  <div className="mt-1 rounded-md bg-slate-50 px-2 py-1.5 md:mt-2 md:px-3 md:py-2.5">
                                    {(() => {
                                      const orderNumberKey = String(dropPoint.order?.orderNumber || '').trim().toUpperCase()
                                      const isReplacementOrder = Boolean((dropPoint.order as any)?.isScheduledReplacement) || orderNumberKey.startsWith('RPL-')
                                      return (
                                        <div className="mb-1 flex items-center gap-2 md:mb-2">
                                          <p className="text-[11px] font-semibold text-slate-600 md:text-sm">
                                            {isReplacementOrder ? 'Replacement Details' : 'Order Details'}
                                          </p>
                                          {isReplacementOrder ? (
                                            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                                              Replacement
                                            </span>
                                          ) : null}
                                        </div>
                                      )
                                    })()}
                                    <div className="mt-1 space-y-0.5 md:mt-2 md:space-y-1">
                                      {(dropPoint.order.items || []).map((item, index) => (
                                        <div key={`${dropPoint.id}-item-${index}`} className="text-[11px] text-slate-600 md:text-sm">
                                          <p>{getItemDisplayNameWithSize(item)} {getOrderQtyWithUnitLabel(item, dropPoint.order)}</p>
                                          {getItemCategoryLabel(item) ? <p className="text-[10px] text-slate-500 md:text-xs">{getItemCategoryLabel(item)}</p> : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {(dropPoint.deliveryPhoto || podDraftByDropPoint[String(dropPoint.id || '')]?.preview) ? (
                                  <div className="mt-2 rounded-md bg-slate-50 px-2 py-2">
                                    <p className="text-[11px] font-semibold text-slate-600">POD Photo</p>
                                    <PodImagePreview
                                      src={dropPoint.deliveryPhoto || podDraftByDropPoint[String(dropPoint.id || '')]?.preview || ''}
                                      alt="POD"
                                      className="mt-1 h-40 w-full rounded border border-slate-200 bg-slate-950 object-contain"
                                    />
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                          <Badge className={dropPointStatusColors[dropPoint.status] || 'bg-gray-100'}>
                            {dropPoint.status}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          {dropPoint.contactPhone && (
                            <a href={`tel:${dropPoint.contactPhone}`} className="inline-flex items-center gap-1 text-sm text-sky-700">
                              <Phone className="h-4 w-4" />
                              Call Contact
                            </a>
                           )}
                         </div>
                      </div>
                    </div>

                    {/* Drop Point Actions */}
                    {activeDropPoint?.id === dropPoint.id && trip.status === 'IN_PROGRESS' && (
                      <div
                        className="mt-2 space-y-2 border-t pt-2 md:mt-4 md:space-y-3 md:pt-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {['PENDING', 'IN_TRANSIT'].includes(String(dropPoint.status || '').toUpperCase()) && (
                          <Button
                            className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={(e) => { e.stopPropagation(); openArriveWarning(dropPoint); }}
                            disabled={isUpdating}
                          >
                            {arrivingDropPointId === String(dropPoint.id) ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Navigation className="mr-2 h-4 w-4" />
                            )}
                            {arrivingDropPointId === String(dropPoint.id) ? 'Marking Arrived...' : 'Mark Arrived'}
                          </Button>
                        )}
                        {dropPoint.status === 'ARRIVED' && (
                          <div className="space-y-2 md:space-y-3">
                            {renderEmptiesReturnInput(dropPoint)}
                            <Textarea
                              className="min-h-[72px] text-sm md:min-h-[88px]"
                              placeholder="Add delivery notes..."
                              value={deliveryNote}
                              onChange={(e) => setDeliveryNote(e.target.value)}
                            />
                            <div className="space-y-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 w-full text-sm md:h-10 md:text-base"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openPodCameraCapture(String(dropPoint.id || ''))
                                }}
                              >
                                <Camera className="h-4 w-4 mr-2" />
                                {podDraftByDropPoint[String(dropPoint.id || '')]?.preview ? 'Retake POD Photo' : 'Capture POD Photo'}
                              </Button>
                              <p className="text-[11px] text-slate-500 md:text-xs">Camera access is required before marking as delivered.</p>
                              {podDraftByDropPoint[String(dropPoint.id || '')]?.preview ? (
                                <PodImagePreview
                                  src={podDraftByDropPoint[String(dropPoint.id || '')]?.preview || ''}
                                  alt="POD preview"
                                  className="h-64 w-full rounded-md border border-slate-200 bg-slate-950 object-contain md:h-80"
                                />
                              ) : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                className="h-9 bg-emerald-600 text-sm hover:bg-emerald-700 md:h-10 md:text-base"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  openDeliveredWarning(dropPoint)
                                }}
                                disabled={isUpdating}
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Delivered
                              </Button>
                              <Button
                                variant="destructive"
                                className="h-9 text-sm md:h-10 md:text-base"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openFailedDeliveryChoice(dropPoint.id)
                                }}
                                disabled={isUpdating}
                              >
                                <AlertCircle className="h-4 w-4 mr-2" />
                                Failed
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {tripCompletionSection}
        </div>
      </div>

      <PodCameraDialogs
        cameraError={cameraError}
        cameraGps={cameraGps}
        cameraLocationError={cameraLocationError}
        cameraOverlaySnapshot={cameraOverlaySnapshot}
        cameraPermissionHint={cameraPermissionHint}
        cameraPermissionSteps={cameraPermissionSteps}
        captureFromCamera={captureFromCamera}
        capturedCameraPhoto={capturedCameraPhoto}
        closeCameraCapture={closeCameraCapture}
        continueCapturedPhoto={continueCapturedPhoto}
        isCameraAddressLoading={isCameraAddressLoading}
        isCameraLoading={isCameraLoading}
        isCameraOpen={isCameraOpen}
        isCameraPermissionDialogOpen={isCameraPermissionDialogOpen}
        openCameraCapture={openCameraCapture}
        setCapturedCameraPhoto={setCapturedCameraPhoto}
        setIsCameraPermissionDialogOpen={setIsCameraPermissionDialogOpen}
        videoRef={videoRef}
      />

      <FailedDeliveryDialogs
        closeFailedDeliveryChoice={closeFailedDeliveryChoice}
        closeFailedDeliveryReschedule={closeFailedDeliveryReschedule}
        deliveryNote={deliveryNote}
        failedDeliveryDropPointId={failedDeliveryDropPointId}
        failedDeliveryOtherDate={failedDeliveryOtherDate}
        failedDeliveryPendingAction={failedDeliveryPendingAction}
        failedDeliveryReceiveAgain={failedDeliveryReceiveAgain}
        failedDeliveryRescheduleDropPointId={failedDeliveryRescheduleDropPointId}
        handleUpdateDropPoint={handleUpdateDropPoint}
        isFailedDeliveryActionWarningOpen={isFailedDeliveryActionWarningOpen}
        isFailedDeliveryChoiceOpen={isFailedDeliveryChoiceOpen}
        isFailedDeliveryRescheduleOpen={isFailedDeliveryRescheduleOpen}
        isFailedDeliverySubmitting={isFailedDeliverySubmitting}
        isUpdating={isUpdating}
        openFailedDeliveryActionWarning={openFailedDeliveryActionWarning}
        openFailedDeliveryReschedule={openFailedDeliveryReschedule}
        otherDriverCancelReason={otherDriverCancelReason}
        selectedDriverCancelReasons={selectedDriverCancelReasons}
        setFailedDeliveryOtherDate={setFailedDeliveryOtherDate}
        setFailedDeliveryPendingAction={setFailedDeliveryPendingAction}
        setFailedDeliveryReceiveAgain={setFailedDeliveryReceiveAgain}
        setIsFailedDeliveryActionWarningOpen={setIsFailedDeliveryActionWarningOpen}
        setIsFailedDeliverySubmitting={setIsFailedDeliverySubmitting}
        setOtherDriverCancelReason={setOtherDriverCancelReason}
        setSelectedDriverCancelReasons={setSelectedDriverCancelReasons}
        trip={trip}
      />

      <DropPointDetailsDialog
        selectedDropPointForDetails={selectedDropPointForDetails}
        setSelectedDropPointForDetails={setSelectedDropPointForDetails}
      />
    </div>
  )
}
