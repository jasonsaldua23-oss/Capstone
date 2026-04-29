'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { emitDataSync } from '@/lib/data-sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHandle, DrawerTitle } from '@/components/ui/drawer'
import { prepareImageForUpload } from '@/lib/client-image'
import { useIsMobile } from '@/hooks/use-mobile'
import { toast } from 'sonner'
import {
  checkNativeCameraPermission,
  DriverGpsLocation,
  DropPoint,
  isNativeCapacitorApp,
  MAX_SPARE_DAMAGE_PHOTOS,
  mergeDropPointIntoTrip,
  NEGROS_OCCIDENTAL_BOUNDS,
  NEGROS_OCCIDENTAL_CENTER,
  openNativeAppSettings,
  SPARE_DAMAGE_REASON_OPTIONS,
  SpareReplacementLine,
  stripPhilippinesFromAddress,
  TERMINAL_DROP_POINT_STATUSES,
  Trip,
} from './trip-detail-helpers'
import {
  Truck, Package, Home, User, LogOut, Menu, Phone, Navigation, CheckCircle, Clock, AlertCircle, Camera,
  ChevronLeft, ChevronRight, Play, Pause, Flag, MessageSquare, Loader2, Route, CalendarClock,
  LocateFixed, Trophy, RotateCcw, Search
} from 'lucide-react'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

// Main driver trip detail screen: controls stop workflow, map state, camera capture, and replacement actions.
export function TripDetailView({
  trip,
  onBack,
  locationPermission,
  onStartTracking,
  onRefreshTrips,
  onApplyTripUpdate,
  isTracking,
  currentLocation,
}: {
  trip: Trip
  onBack: () => void
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
  const [podImageFile, setPodImageFile] = useState<File | null>(null)
  const [podImagePreview, setPodImagePreview] = useState<string | null>(null)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [capturedCameraPhoto, setCapturedCameraPhoto] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraLoading, setIsCameraLoading] = useState(false)
  const [isCameraPermissionDialogOpen, setIsCameraPermissionDialogOpen] = useState(false)
  const [cameraPermissionHint, setCameraPermissionHint] = useState<string>('')

  // Spare/replacement workflow state.
  const [isSpareReplaceOpen, setIsSpareReplaceOpen] = useState(false)
  const [isReplacementWarningOpen, setIsReplacementWarningOpen] = useState(false)
  const [replacementTargetDropPointId, setReplacementTargetDropPointId] = useState<string | null>(null)
  const [replacementTargetDropPointName, setReplacementTargetDropPointName] = useState('')
  const [spareTargetDropPointId, setSpareTargetDropPointId] = useState<string | null>(null)
  const [spareOrderItemId, setSpareOrderItemId] = useState('')
  const [spareQuantity, setSpareQuantity] = useState('1')
  const [spareReplacementLines, setSpareReplacementLines] = useState<SpareReplacementLine[]>([])
  const [spareOutcome, setSpareOutcome] = useState<'RESOLVED' | 'PARTIALLY_REPLACED'>('RESOLVED')
  const [sparePartiallyReplacedQuantity, setSparePartiallyReplacedQuantity] = useState(0)
  const [spareFollowUpReturnId, setSpareFollowUpReturnId] = useState<string | null>(null)
  const [spareDamageReason, setSpareDamageReason] = useState('Broken bottles')
  const [spareOtherDamageReason, setSpareOtherDamageReason] = useState('')
  const [spareDamagePhotoFiles, setSpareDamagePhotoFiles] = useState<File[]>([])
  const [spareDamagePhotoPreviews, setSpareDamagePhotoPreviews] = useState<string[]>([])
  const [isSpareReplacing, setIsSpareReplacing] = useState(false)

  // Failed-delivery decision flow state.
  const [isFailedDeliveryChoiceOpen, setIsFailedDeliveryChoiceOpen] = useState(false)
  const [failedDeliveryDropPointId, setFailedDeliveryDropPointId] = useState<string | null>(null)
  const [isFailedDeliveryActionWarningOpen, setIsFailedDeliveryActionWarningOpen] = useState(false)
  const [failedDeliveryPendingAction, setFailedDeliveryPendingAction] = useState<'reschedule' | 'cancel' | null>(null)
  const [isArriveWarningOpen, setIsArriveWarningOpen] = useState(false)
  const [arriveTargetDropPointId, setArriveTargetDropPointId] = useState<string | null>(null)
  const [arriveTargetDropPointName, setArriveTargetDropPointName] = useState('')
  const [isFailedDeliveryRescheduleOpen, setIsFailedDeliveryRescheduleOpen] = useState(false)
  const [failedDeliveryRescheduleDropPointId, setFailedDeliveryRescheduleDropPointId] = useState<string | null>(null)
  const [failedDeliveryReceiveAgain, setFailedDeliveryReceiveAgain] = useState<'today' | 'tomorrow' | 'other_date'>('today')
  const [failedDeliveryOtherDate, setFailedDeliveryOtherDate] = useState('')
  const [isDeliveredWarningOpen, setIsDeliveredWarningOpen] = useState(false)
  const [deliveredTargetDropPointId, setDeliveredTargetDropPointId] = useState<string | null>(null)
  const [deliveredTargetDropPointName, setDeliveredTargetDropPointName] = useState('')
  const [isStartTripConfirmOpen, setIsStartTripConfirmOpen] = useState(false)

  // Mobile bottom sheet and map UX state.
  const [mobileSheetSnapPoint, setMobileSheetSnapPoint] = useState<number | string | null>(0.52)
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  const [showMobileSheetPeek, setShowMobileSheetPeek] = useState(true)
  const [mobileMapRecenterSignal, setMobileMapRecenterSignal] = useState(0)
  const [mobileMapRecenterCenter, setMobileMapRecenterCenter] = useState<[number, number] | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [roadRoutePoints, setRoadRoutePoints] = useState<[number, number][]>([])
  const [previewDriverLocation, setPreviewDriverLocation] = useState<DriverGpsLocation | null>(null)
  // Refs for camera stream lifecycle and gesture handling.
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const mobileSheetTouchStartYRef = useRef<number | null>(null)
  const mobileSheetPeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cameraCaptureTarget, setCameraCaptureTarget] = useState<'pod' | 'spare'>('pod')
  const isMobileViewport = useIsMobile()
  // Derived drop points sorted by sequence for consistent rendering and logic.
  const sortedDropPoints = useMemo(
    () => [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence),
    [trip.dropPoints]
  )
  const terminalDropPointStatuses = TERMINAL_DROP_POINT_STATUSES
  const effectiveCompletedDropPoints = Math.max(
    Number(trip.completedDropPoints || 0),
    sortedDropPoints.filter((point) => terminalDropPointStatuses.has(String(point.status || '').toUpperCase())).length
  )
  const highlightedDropPoint = activeDropPoint || sortedDropPoints[0] || null
  const mobileSheetSnapPoints: Array<number | string> = [0.52, 0.88, 0.98]
  const hasBlockingDialogOpen =
    isCameraOpen ||
    isCameraPermissionDialogOpen ||
    isSpareReplaceOpen ||
    isFailedDeliveryChoiceOpen ||
    isFailedDeliveryRescheduleOpen

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

  // Reset mobile sheet and recenter state when user switches to a different trip.
  useEffect(() => {
    if (mobileSheetPeekTimeoutRef.current) {
      clearTimeout(mobileSheetPeekTimeoutRef.current)
      mobileSheetPeekTimeoutRef.current = null
    }
    setIsMobileSheetOpen(false)
    setShowMobileSheetPeek(true)
    setMobileSheetSnapPoint(0.52)
    setMobileMapRecenterCenter(null)
    setMobileMapRecenterSignal(0)
  }, [trip.id])

  // Cleanup delayed timers to avoid setting state on unmounted component.
  useEffect(() => {
    return () => {
      if (mobileSheetPeekTimeoutRef.current) {
        clearTimeout(mobileSheetPeekTimeoutRef.current)
      }
    }
  }, [])

  // Opens full mobile sheet and hides the collapsed peek button.
  const openMobileSheet = () => {
    if (mobileSheetPeekTimeoutRef.current) {
      clearTimeout(mobileSheetPeekTimeoutRef.current)
      mobileSheetPeekTimeoutRef.current = null
    }
    setShowMobileSheetPeek(false)
    setIsMobileSheetOpen(true)
  }

  // Normalizes snap points to known values so drawer state remains predictable.
  const handleMobileSheetSnapPointChange = (next: number | string | null) => {
    if (next === null || next === undefined) {
      setMobileSheetSnapPoint(0.52)
      return
    }

    if (mobileSheetSnapPoints.includes(next)) {
      setMobileSheetSnapPoint(next)
      setShowMobileSheetPeek(false)
      setIsMobileSheetOpen(true)
      return
    }

    setMobileSheetSnapPoint(0.52)
  }

  // Controls open/close transitions and delayed peek reappearance.
  const handleMobileSheetOpenChange = (open: boolean) => {
    if (!open) {
      setIsMobileSheetOpen(false)
      setMobileSheetSnapPoint(0.52)
      if (mobileSheetPeekTimeoutRef.current) {
        clearTimeout(mobileSheetPeekTimeoutRef.current)
      }
      mobileSheetPeekTimeoutRef.current = setTimeout(() => {
        setShowMobileSheetPeek(true)
        mobileSheetPeekTimeoutRef.current = null
      }, 160)
      return
    }

    if (mobileSheetPeekTimeoutRef.current) {
      clearTimeout(mobileSheetPeekTimeoutRef.current)
      mobileSheetPeekTimeoutRef.current = null
    }
    setShowMobileSheetPeek(false)
    setIsMobileSheetOpen(open)
    if (open && typeof mobileSheetSnapPoint === 'number' && mobileSheetSnapPoint < 0.52) {
      setMobileSheetSnapPoint(0.52)
    }
  }

  // Touch handlers enable upward swipe on peek button to open the sheet.
  const handleMobileSheetPeekTouchStart = (event: React.TouchEvent<HTMLButtonElement>) => {
    mobileSheetTouchStartYRef.current = event.touches[0]?.clientY ?? null
  }

  const handleMobileSheetPeekTouchMove = (event: React.TouchEvent<HTMLButtonElement>) => {
    if (mobileSheetTouchStartYRef.current === null) return
    const currentY = event.touches[0]?.clientY
    if (typeof currentY !== 'number') return
    if (mobileSheetTouchStartYRef.current - currentY > 24) {
      openMobileSheet()
      mobileSheetTouchStartYRef.current = null
    }
  }

  const handleMobileSheetPeekTouchEnd = () => {
    mobileSheetTouchStartYRef.current = null
  }

  const dropPointStatusColors: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border border-amber-200',
    IN_TRANSIT: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
    ARRIVED: 'bg-sky-100 text-sky-800 border border-sky-200',
    COMPLETED: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    FAILED: 'bg-rose-100 text-rose-800 border border-rose-200',
    CANCELLED: 'bg-slate-200 text-slate-800 border border-slate-300',
  }

  // Helpers for finding replacement records attached to the active drop point.
  const getDropPointReplacementItems = (dropPoint: DropPoint | null) => {
    if (!dropPoint?.order) return []
    return dropPoint.order.items || []
  }

  const getDropPointOpenReplacement = (dropPoint: DropPoint | null) => {
    const replacements = dropPoint?.order?.replacements || []
    const openCandidates = replacements.filter((entry) => {
      const isClosed = Boolean(entry?.isClosed)
      const remainingQty = Number((entry as any)?.remainingQuantity ?? 0)
      return !isClosed && remainingQty > 0
    })
    if (openCandidates.length === 0) {
      return replacements.find((entry) => !entry.isClosed) || null
    }
    return openCandidates
      .slice()
      .sort((a: any, b: any) => {
        const aTime = new Date(String(a?.processedAt || a?.createdAt || a?.reportedAt || 0)).getTime()
        const bTime = new Date(String(b?.processedAt || b?.createdAt || b?.reportedAt || 0)).getTime()
        return bTime - aTime
      })[0] || null
  }

  const getOpenReplacementQuantities = (openReplacement: any, orderedQuantity: number) => {
    const parseMeta = () => {
      const notes = String(openReplacement?.notes || '')
      const markerIndex = notes.lastIndexOf('Meta:')
      if (markerIndex < 0) return {}
      try {
        const parsed = JSON.parse(notes.slice(markerIndex + 'Meta:'.length).trim())
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }
    const meta = parseMeta() as any
    const targetQty = Number(
      openReplacement?.quantityToReplace
      ?? meta?.quantityToReplace
      ?? openReplacement?.damagedQuantity
      ?? meta?.damagedQuantity
      ?? orderedQuantity
    )
    const replacedQty = Number(
      openReplacement?.quantityReplaced
      ?? openReplacement?.replacementQuantity
      ?? meta?.quantityReplaced
      ?? 0
    )
    const explicitRemaining = Number(openReplacement?.remainingQuantity ?? meta?.remainingQuantity)
    const normalizedTargetQty = Number.isFinite(targetQty) ? targetQty : orderedQuantity
    const normalizedReplacedQty = Number.isFinite(replacedQty) ? replacedQty : 0
    const derivedRemaining = Math.max(normalizedTargetQty - normalizedReplacedQty, 0)
    const remainingQty = Number.isFinite(normalizedTargetQty)
      ? derivedRemaining
      : Number.isFinite(explicitRemaining)
        ? Math.max(explicitRemaining, 0)
        : 0
    return {
      targetQty: normalizedTargetQty,
      replacedQty: normalizedReplacedQty,
      remainingQty,
    }
  }

  const getReplacementProgress = (dropPoint: DropPoint | null) => {
    const openReplacement = getDropPointOpenReplacement(dropPoint)
    if (!openReplacement) {
      return {
        openReplacement: null,
        replacedQuantity: 0,
        remainingQuantity: 0,
      }
    }

    const selectedItem = getDropPointReplacementItems(dropPoint).find((item) => item.id === openReplacement.originalOrderItemId) || null
    const orderedQuantity = Number(selectedItem?.quantity || 0)
    const quantities = getOpenReplacementQuantities(openReplacement, orderedQuantity)
    return {
      openReplacement,
      replacedQuantity: quantities.replacedQty,
      remainingQuantity: quantities.remainingQty,
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2,
    }).format(amount)
  const formatTripSchedule = (value: string | null | undefined) => {
    const raw = String(value || '').trim()
    if (!raw) return 'Not set'
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return raw
    return parsed.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  const ETA_SPEED_KMH = 28
  // Geospatial helpers used for route/movement calculations.
  const haversineKm = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
    const radiusKm = 6371
    const toRad = (value: number) => (value * Math.PI) / 180
    const dLat = toRad(to.lat - from.lat)
    const dLng = toRad(to.lng - from.lng)
    const lat1 = toRad(from.lat)
    const lat2 = toRad(to.lat)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return radiusKm * c
  }

  // Starts a trip after location tracking is available and trip is still in a startable state.
  const handleStartTrip = async () => {
    const latestTrip = trip
    const currentStatus = String(latestTrip.status || '').toUpperCase()
    if (currentStatus !== 'PLANNED') {
      toast.error(`Trip cannot be started because status is ${currentStatus.replace(/_/g, ' ')}`)
      refreshTripsInBackground()
      return
    }

    const notLoadedOrders = (latestTrip.dropPoints || [])
      .filter((point) => point.order)
      .filter((point) => !['LOADED', 'DISPATCHED'].includes(String((point.order as any)?.warehouseStage || '').toUpperCase()))
      .map((point) => String(point.order?.orderNumber || point.order?.id || 'Unknown order'))

    if (notLoadedOrders.length > 0) {
      toast.error(`Trip cannot start. Orders not loaded: ${notLoadedOrders.slice(0, 3).join(', ')}`)
      refreshTripsInBackground()
      return
    }

    const locationReady = await onStartTracking()
    if (!locationReady) {
      return
    }

    setIsUpdating(true)
    try {
      const response = await fetch(`/api/trips/${trip.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
                  warehouseStage: ['LOADED', 'DISPATCHED'].includes(String(point.order.warehouseStage || '').toUpperCase())
                    ? 'DISPATCHED'
                    : point.order.warehouseStage,
                  status: ['LOADED', 'DISPATCHED'].includes(String(point.order.warehouseStage || '').toUpperCase())
                    ? 'OUT_FOR_DELIVERY'
                    : (point.order as any).status,
                }
              : point.order,
          })),
        }))
        toast.success(payload?.message || 'Trip started')
        emitDataSync(['orders', 'trips'])
        refreshTripsInBackground()
      } else {
        toast.error(payload?.error || 'Failed to start trip')
        refreshTripsInBackground()
      }
    } catch (error) {
      toast.error('An error occurred')
      refreshTripsInBackground()
    } finally {
      setIsUpdating(false)
    }
  }

  const openArriveWarning = (dropPoint: DropPoint) => {
    setArriveTargetDropPointId(String(dropPoint.id || ''))
    setArriveTargetDropPointName(String(dropPoint.locationName || `Stop ${dropPoint.sequence || ''}`).trim())
    setIsArriveWarningOpen(true)
  }

  const openReplacementWarning = (dropPoint: DropPoint) => {
    setReplacementTargetDropPointId(String(dropPoint.id || ''))
    setReplacementTargetDropPointName(String(dropPoint.locationName || `Stop ${dropPoint.sequence || ''}`).trim())
    setIsReplacementWarningOpen(true)
  }

  const openDeliveredWarning = (dropPoint: DropPoint) => {
    setDeliveredTargetDropPointId(String(dropPoint.id || ''))
    setDeliveredTargetDropPointName(String(dropPoint.locationName || `Stop ${dropPoint.sequence || ''}`).trim())
    setIsDeliveredWarningOpen(true)
  }

  const submitDeliveredForDropPoint = async (dropPoint: DropPoint) => {
    if (getDropPointOpenReplacement(dropPoint)) {
      toast.error('Resolve the remaining replacement before marking this drop point as delivered')
      return
    }
    const existingPodPhotoUrl = String(dropPoint?.deliveryPhoto || '').trim()
    if (!podImageFile && !existingPodPhotoUrl) {
      toast.error('Capture POD photo first')
      openCameraCapture('pod')
      return
    }
    try {
      const imageUrl = podImageFile ? await uploadPodImage(podImageFile) : existingPodPhotoUrl
      await handleUpdateDropPoint(dropPoint.id, 'COMPLETED', deliveryNote, {
        recipientName: 'Customer',
        deliveryPhoto: imageUrl,
      })
      handlePodFileChange(null)
      setDeliveryNote('')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to upload POD image')
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
    }
  ) => {
    setIsUpdating(true)
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
      } else {
        toast.error(payload?.error || 'Failed to update drop point')
        refreshTripsInBackground()
      }
    } catch (error) {
      toast.error('An error occurred')
      refreshTripsInBackground()
    } finally {
      setIsUpdating(false)
    }
  }

  const toDataUrl = async (file: File): Promise<string> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Failed to prepare damage photo'))
      reader.readAsDataURL(file)
    })
    if (!dataUrl) {
      throw new Error('Failed to prepare damage photo')
    }
    return dataUrl
  }

  // Orders still waiting for warehouse "LOADED" confirmation.
  const notLoadedTripOrders = (trip.dropPoints || [])
    .filter((point) => point.order)
    .filter((point) => !['LOADED', 'DISPATCHED'].includes(String((point.order as any)?.warehouseStage || '').toUpperCase()))
    .map((point) => String(point.order?.orderNumber || point.order?.id || 'Unknown order'))

  const uploadPodImage = async (file: File) => {
    const preparedFile = await prepareImageForUpload(file)
    const formData = new FormData()
    formData.append('file', preparedFile)
    const response = await fetch('/api/uploads/pod-image', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok && payload?.success !== false && payload?.imageUrl) {
      return String(payload.imageUrl)
    }

    const errorMessage = String(payload?.error || 'Failed to upload POD image')
    if (/upload storage is unavailable/i.test(errorMessage)) {
      toast('Storage is not configured on this deployment. The image will be saved inline for this record.')
      return toDataUrl(preparedFile)
    }
    throw new Error(errorMessage)
  }

  const uploadDamageImage = async (file: File) => {
    const preparedFile = await prepareImageForUpload(file)
    const formData = new FormData()
    formData.append('file', preparedFile)
    const response = await fetch('/api/uploads/damage-image', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok && payload?.success !== false && payload?.imageUrl) {
      return String(payload.imageUrl)
    }

    const errorMessage = String(payload?.error || 'Failed to upload damage image')
    if (/upload storage is unavailable/i.test(errorMessage)) {
      toast('Storage is not configured on this deployment. The image will be saved inline for this record.')
      return toDataUrl(preparedFile)
    }
    throw new Error(errorMessage)
  }

  // POD image input handler with local preview generation.
  const handlePodFileChange = (file: File | null) => {
    setPodImageFile(file)
    setPodImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return file ? URL.createObjectURL(file) : null
    })
  }

  const attachCameraStreamToVideo = async () => {
    const stream = cameraStreamRef.current
    const video = videoRef.current
    if (!stream || !video) return

    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    await video.play().catch(() => {})
  }

  const getWebCameraPermissionState = async (): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> => {
    try {
      const permissionsApi = (navigator as any)?.permissions
      if (!permissionsApi?.query) return 'unknown'
      const result = await permissionsApi.query({ name: 'camera' as PermissionName })
      const state = String(result?.state || '').toLowerCase()
      if (state === 'granted' || state === 'denied' || state === 'prompt') {
        return state
      }
      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

  const ensureWebCameraPermission = async (): Promise<{ granted: boolean; reason?: string }> => {
    if (!window.isSecureContext) {
      return { granted: false, reason: 'Camera requires a secure connection (HTTPS). Open this app over HTTPS to allow camera on mobile.' }
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, reason: 'This browser/device does not expose camera APIs for this page.' }
    }

    const permissionState = await getWebCameraPermissionState()
    if (permissionState === 'denied') {
      return { granted: false, reason: 'Camera permission denied. Please enable camera access in browser/app settings.' }
    }

    // Explicitly verify/request permission every time camera flow starts.
    try {
      const preflightStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      preflightStream.getTracks().forEach((track) => track.stop())
      return { granted: true }
    } catch (error: any) {
      const errName = String(error?.name || '')
      const denied =
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errName === 'SecurityError'
      if (denied) {
        return { granted: false, reason: 'Camera permission denied. Please enable camera access in browser/app settings.' }
      }
      if (errName === 'NotFoundError') {
        return { granted: false, reason: 'No camera device was found on this phone.' }
      }
      if (errName === 'NotReadableError') {
        return { granted: false, reason: 'Camera is busy in another app. Close other camera apps and retry.' }
      }
      if (errName === 'TypeError') {
        return { granted: false, reason: 'Camera is unavailable for this page. On mobile this usually means non-HTTPS access.' }
      }
      return { granted: false, reason: 'Unable to access camera on this device/browser.' }
    }
  }

  // Stops active camera tracks to release device resources immediately.
  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  // Opens camera flow and requests permission when needed.
  const openCameraCapture = (target: 'pod' | 'spare' = 'pod') => {
    if (isNativeCapacitorApp()) {
      setCameraCaptureTarget(target)
      setCapturedCameraPhoto(null)
      setCameraError(null)
      setCameraPermissionHint('')
      setIsCameraOpen(false)
      void (async () => {
        try {
          const permission = await checkNativeCameraPermission()
          if (!permission.granted) {
            handleCameraPermissionDenied(permission.reason)
            return
          }
          const cameraModule = await import('@capacitor/camera')
          const photo = await cameraModule.Camera.getPhoto({
            source: cameraModule.CameraSource.Camera,
            resultType: cameraModule.CameraResultType.Uri,
            quality: 90,
            allowEditing: false,
          })
          const photoPath = String(photo?.webPath || photo?.path || '').trim()
          if (!photoPath) throw new Error('Failed to capture photo')
          const fileResponse = await fetch(photoPath)
          const blob = await fileResponse.blob()
          const mimeType = blob.type || 'image/jpeg'
          const ext = mimeType.includes('png') ? 'png' : 'jpg'
          const file = new File([blob], `pod-camera-${Date.now()}.${ext}`, { type: mimeType })
          if (target === 'spare') {
            appendSpareDamagePhotos([file])
          } else {
            handlePodFileChange(file)
          }
        } catch (error: any) {
          const message = String(error?.message || '')
          if (/cancelled|canceled|user cancelled|user canceled/i.test(message)) {
            return
          }
          handleCameraPermissionDenied(message || 'Unable to access camera on this device.')
        }
      })()
      return
    }

    void (async () => {
      const permission = await ensureWebCameraPermission()
      if (!permission.granted) {
        handleCameraPermissionDenied(permission.reason)
        return
      }

      setCameraCaptureTarget(target)
      setCapturedCameraPhoto(null)
      setCameraError(null)
      setCameraPermissionHint('')
      setIsCameraOpen(true)
    })()
  }

  // Opens spare replacement dialog preloaded with the selected drop point.
  const openSpareReplacement = (dropPoint: DropPoint) => {
    const items = getDropPointReplacementItems(dropPoint)
    const openReplacement = getDropPointOpenReplacement(dropPoint)
    const selectedItemId = openReplacement?.originalOrderItemId || items[0]?.id || ''
    const selectedItem = items.find((item) => item.id === selectedItemId) || null
    const openReplacementQuantities = openReplacement
      ? getOpenReplacementQuantities(openReplacement, Number(selectedItem?.quantity || 0))
      : null
    const remainingQuantity = openReplacement
      ? openReplacementQuantities?.remainingQty ?? 0
      : items.length
        ? 1
        : 0
    setSpareTargetDropPointId(dropPoint.id)
    setSpareOrderItemId(selectedItemId)
    setSpareQuantity(String(openReplacement ? remainingQuantity : items.length ? 1 : 0))
    setSpareReplacementLines(openReplacement
      ? []
      : selectedItemId
        ? [{ orderItemId: selectedItemId, quantityToReplace: '1', quantityReplaced: '1' }]
        : []
    )
    setSpareOutcome('RESOLVED')
    setSparePartiallyReplacedQuantity(openReplacement ? remainingQuantity : 0)
    setSpareFollowUpReturnId(openReplacement?.id || null)
    setSpareDamageReason('Broken bottles')
    setSpareOtherDamageReason('')
    setSpareDamagePhotoFiles([])
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return []
    })
    setIsSpareReplaceOpen(true)
  }

  // Failed-delivery modal open/close helpers.
  const openFailedDeliveryChoice = (dropPointId: string) => {
    setFailedDeliveryDropPointId(dropPointId)
    setIsFailedDeliveryChoiceOpen(true)
  }

  const closeFailedDeliveryChoice = () => {
    setIsFailedDeliveryChoiceOpen(false)
    setFailedDeliveryDropPointId(null)
  }

  const openFailedDeliveryActionWarning = (action: 'reschedule' | 'cancel') => {
    setFailedDeliveryPendingAction(action)
    setIsFailedDeliveryActionWarningOpen(true)
  }

  const openFailedDeliveryReschedule = (dropPointId: string) => {
    setFailedDeliveryRescheduleDropPointId(dropPointId)
    setFailedDeliveryReceiveAgain('today')
    setFailedDeliveryOtherDate('')
    setIsFailedDeliveryRescheduleOpen(true)
  }

  const closeFailedDeliveryReschedule = () => {
    setIsFailedDeliveryRescheduleOpen(false)
    setFailedDeliveryRescheduleDropPointId(null)
    setFailedDeliveryReceiveAgain('today')
    setFailedDeliveryOtherDate('')
  }

  // Spare damage photo helpers: set, append, clear.
  const setSpareDamagePhotos = (files: File[]) => {
    const limitedFiles = files.slice(0, MAX_SPARE_DAMAGE_PHOTOS)
    setSpareDamagePhotoFiles(limitedFiles)
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return limitedFiles.map((file) => URL.createObjectURL(file))
    })
  }

  const appendSpareDamagePhotos = (files: File[]) => {
    const nextFiles = files.filter((file) => Boolean(file))
    if (!nextFiles.length) return

    const remainingSlots = MAX_SPARE_DAMAGE_PHOTOS - spareDamagePhotoFiles.length
    if (remainingSlots <= 0) {
      toast.error(`Only ${MAX_SPARE_DAMAGE_PHOTOS} damage photos are allowed`)
      return
    }

    const filesToAdd = nextFiles.slice(0, remainingSlots)
    if (nextFiles.length > remainingSlots) {
      toast.error(`Only ${MAX_SPARE_DAMAGE_PHOTOS} damage photos are allowed`)
    }
    setSpareDamagePhotos([...spareDamagePhotoFiles, ...filesToAdd])
  }

  const clearSpareDamagePhoto = (index?: number) => {
    if (typeof index === 'number') {
      setSpareDamagePhotos(spareDamagePhotoFiles.filter((_, currentIndex) => currentIndex !== index))
    } else {
      setSpareDamagePhotos([])
    }
  }

  // Fully resets spare replacement modal state.
  const closeSpareReplacement = () => {
    setIsSpareReplaceOpen(false)
    setSpareTargetDropPointId(null)
    setSpareOrderItemId('')
    setSpareQuantity('1')
    setSpareReplacementLines([])
    setSpareOutcome('RESOLVED')
    setSparePartiallyReplacedQuantity(0)
    setSpareFollowUpReturnId(null)
    setSpareDamageReason('Broken bottles')
    setSpareOtherDamageReason('')
    setSpareDamagePhotoFiles([])
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return []
    })
    setIsSpareReplacing(false)
  }

  // Convenience wrapper to reuse camera flow for spare damage evidence capture.
  const openSpareCameraCapture = () => {
    openCameraCapture('spare')
  }

  // Submits replacement data and updates the trip optimistically.
  const submitSpareReplacement = async () => {
    const targetDropPoint = (trip.dropPoints || []).find((point) => point.id === spareTargetDropPointId) || null
    if (!targetDropPoint) {
      toast.error('Invalid drop point for on-delivery replacement')
      return
    }
    const openReplacement = getDropPointOpenReplacement(targetDropPoint)
    const orderId = String(targetDropPoint.order?.id || '').trim()
    if (!orderId) {
      toast.error('Order reference is missing for this drop point')
      return
    }
    const selectedItem = (targetDropPoint.order?.items || []).find((item) => item.id === spareOrderItemId) || null
    const replacementLines = spareFollowUpReturnId
      ? []
      : spareReplacementLines
          .map((line) => {
            const item = (targetDropPoint.order?.items || []).find((candidate) => candidate.id === line.orderItemId) || null
            return {
              item,
              orderItemId: line.orderItemId,
              quantityToReplace: Number(line.quantityToReplace),
              quantityReplaced: spareOutcome === 'RESOLVED' ? Number(line.quantityToReplace) : Number(line.quantityReplaced),
            }
          })
          .filter((line) => line.item && Number(line.quantityToReplace) > 0)
    if (spareFollowUpReturnId && spareOutcome === 'RESOLVED' && !selectedItem) {
      toast.error('Select an item to replace')
      return
    }
    if (!spareFollowUpReturnId && replacementLines.length === 0) {
      toast.error('Select at least one damaged product')
      return
    }
    for (const line of replacementLines) {
      if (!Number.isFinite(line.quantityToReplace) || line.quantityToReplace <= 0 || !Number.isInteger(line.quantityToReplace)) {
        toast.error('Each damaged product needs a whole quantity to replace')
        return
      }
      if (!Number.isFinite(line.quantityReplaced) || line.quantityReplaced < 0 || !Number.isInteger(line.quantityReplaced)) {
        toast.error('Each replacement quantity must be a whole number')
        return
      }
      if (line.quantityReplaced > line.quantityToReplace) {
        toast.error('Quantity replaced cannot exceed quantity to replace')
        return
      }
      if (line.item && line.quantityToReplace > Number(line.item.quantity || 0)) {
        toast.error(`${line.item.product?.name || 'Product'} quantity exceeds ordered quantity`)
        return
      }
    }
    const replacementQuantity = Number(spareQuantity)
    if (spareFollowUpReturnId && (!Number.isFinite(replacementQuantity) || replacementQuantity < 0 || !Number.isInteger(replacementQuantity))) {
      toast.error('Quantity must be a whole number (0 or higher)')
      return
    }
    if (spareFollowUpReturnId && spareOutcome === 'RESOLVED' && replacementQuantity <= 0) {
      toast.error('Resolved outcome requires replacement quantity greater than zero')
      return
    }
    if (spareFollowUpReturnId && spareOutcome === 'PARTIALLY_REPLACED' && sparePartiallyReplacedQuantity <= 0) {
      toast.error('Partially Replaced requires specifying how many items were replaced')
      return
    }
    if (spareFollowUpReturnId && spareOutcome === 'PARTIALLY_REPLACED' && sparePartiallyReplacedQuantity > replacementQuantity) {
      toast.error('Partially replaced quantity cannot exceed damaged quantity')
      return
    }
    if (spareFollowUpReturnId && spareOutcome !== 'RESOLVED') {
      toast.error('Follow-up replacement must be submitted as resolved')
      return
    }
    if (spareFollowUpReturnId && (!openReplacement || openReplacement.id !== spareFollowUpReturnId)) {
      toast.error('The selected follow-up replacement is no longer available')
      return
    }
    if (spareFollowUpReturnId) {
      try {
        const refreshedTrips = await onRefreshTrips()
        const refreshedTrip = (refreshedTrips || []).find((entry) => String(entry?.id || '') === String(trip.id || ''))
        const refreshedDropPoint = (refreshedTrip?.dropPoints || []).find((point) => String(point?.id || '') === String(targetDropPoint.id || ''))
        const refreshedOpenReplacement = getDropPointOpenReplacement(refreshedDropPoint || null)
        if (!refreshedOpenReplacement || String(refreshedOpenReplacement.id || '') !== String(spareFollowUpReturnId)) {
          toast.error('This follow-up replacement was already resolved or changed. Please reopen it.')
          return
        }
        const refreshedSelectedItem = (refreshedDropPoint?.order?.items || []).find((item) => item.id === spareOrderItemId) || null
        const freshReplacement = getOpenReplacementQuantities(refreshedOpenReplacement, Number(refreshedSelectedItem?.quantity || 0))
        const freshRemainingQty = Number(freshReplacement.remainingQty || 0)
        if (Number.isFinite(freshRemainingQty) && freshRemainingQty > 0 && replacementQuantity !== freshRemainingQty) {
          setSpareQuantity(String(freshRemainingQty))
          if (spareOutcome === 'PARTIALLY_REPLACED') {
            setSparePartiallyReplacedQuantity(freshRemainingQty)
          }
          toast.error(`Remaining quantity is now ${freshRemainingQty}. Quantity was updated, please submit again.`)
          return
        }
      } catch {
        toast.error('Unable to verify latest replacement state. Please try again.')
        return
      }
    }
    if (spareFollowUpReturnId && selectedItem) {
      const remainingQty = getOpenReplacementQuantities(openReplacement, Number(selectedItem.quantity || 0)).remainingQty
      if (replacementQuantity !== remainingQty) {
        toast.error(`Follow-up replacement must use the remaining quantity of ${remainingQty}`)
        return
      }
    }
    if (spareFollowUpReturnId && selectedItem && replacementQuantity > Number(selectedItem.quantity || 0)) {
      toast.error('Replacement quantity exceeds ordered quantity')
      return
    }
    const spareReason = (spareDamageReason === 'Others' ? spareOtherDamageReason : spareDamageReason).trim()
    if (!spareReason) {
      toast.error('Replacement reason is required')
      return
    }
    if (!spareDamagePhotoFiles.length) {
      toast.error('At least one damage photo is required')
      return
    }
    if (spareDamagePhotoFiles.length > MAX_SPARE_DAMAGE_PHOTOS) {
      toast.error(`Only ${MAX_SPARE_DAMAGE_PHOTOS} damage photos are allowed`)
      return
    }

    setIsSpareReplacing(true)
    try {
      const damagePhotos = await Promise.all(spareDamagePhotoFiles.map((photo) => uploadDamageImage(photo)))
      const response = await fetch('/api/driver/replacements/from-spare-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          productId: spareFollowUpReturnId ? selectedItem?.productId : undefined,
          tripId: trip.id,
          dropPointId: targetDropPoint.id,
          orderItemId: spareFollowUpReturnId ? selectedItem?.id || '' : undefined,
          followUpReturnId: spareFollowUpReturnId || undefined,
          quantity: spareFollowUpReturnId ? replacementQuantity : undefined,
          items: spareFollowUpReturnId
            ? undefined
            : replacementLines.map((line) => ({
                orderItemId: line.orderItemId,
                quantityToReplace: line.quantityToReplace,
                quantityReplaced: line.quantityReplaced,
              })),
          outcome: spareOutcome,
          partiallyReplacedQuantity: spareOutcome === 'PARTIALLY_REPLACED' ? sparePartiallyReplacedQuantity : undefined,
          reason: spareReason,
          damagePhoto: damagePhotos[0],
          damagePhotos,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to process on-delivery replacement')
      }
      const remainingSpareProducts = Number(payload?.remainingSpareProducts ?? 0)
      toast.success(
        spareOutcome === 'RESOLVED'
          ? `Damage reported and resolved on delivery. Remaining spare products: ${remainingSpareProducts}`
          : `Damage reported as partially replaced. Follow-up required. Remaining spare products: ${remainingSpareProducts}`
      )
      const returnedReplacements = Array.isArray(payload?.replacements)
        ? payload.replacements
        : payload?.replacement
          ? [payload.replacement]
          : []
      if (returnedReplacements.length && targetDropPoint.order) {
        const nextReplacements = returnedReplacements.map((replacement: any) => ({
          ...replacement,
          remainingQuantity: Number(replacement?.remainingQuantity ?? payload?.remainingReplacementQty ?? 0),
          isClosed: spareOutcome === 'RESOLVED',
          originalOrderItemId: replacement.originalOrderItemId || (spareFollowUpReturnId ? selectedItem?.id : null) || null,
          dropPointId: replacement.dropPointId || targetDropPoint.id,
        }))
        const existingReplacements = targetDropPoint.order.replacements || []
        const nextReturns = [
          ...existingReplacements.filter((entry) => !nextReplacements.some((replacement: any) => replacement.id === entry.id)),
          ...nextReplacements,
        ]
        onApplyTripUpdate((currentTrip) =>
          mergeDropPointIntoTrip(currentTrip, targetDropPoint.id, {
            order: {
              ...targetDropPoint.order!,
              replacements: nextReturns,
            },
          })
        )
      }
      setSparePartiallyReplacedQuantity(0)
      closeSpareReplacement()
      emitDataSync(['orders', 'trips', 'replacements'])
      refreshTripsInBackground()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to process on-delivery replacement')
    } finally {
      setIsSpareReplacing(false)
    }
  }

  // Closes camera capture UI and clears camera-related temporary state.
  const closeCameraCapture = () => {
    stopCameraStream()
    setIsCameraOpen(false)
    setIsCameraLoading(false)
    setCapturedCameraPhoto(null)
  }

  // Tries to deep-link users into OS/app settings to unblock camera permission.
  const openCameraSettings = async () => {
    if (isNativeCapacitorApp()) {
      const opened = await openNativeAppSettings()
      if (!opened) {
        toast.message('If settings did not open, follow the steps shown below.')
      }
      return
    }

    try {
      const ua = navigator.userAgent.toLowerCase()
      const isAndroid = ua.includes('android')
      const isIOS = ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')
      const isEdge = ua.includes('edg/')
      const isChrome = ua.includes('chrome') && !isEdge
      const isFirefox = ua.includes('firefox')

      if (!isAndroid && !isIOS) {
        if (isEdge) {
          window.location.href = 'edge://settings/content/camera'
          return
        }
        if (isChrome) {
          window.location.href = 'chrome://settings/content/camera'
          return
        }
        if (isFirefox) {
          window.open('about:preferences#privacy', '_blank')
          return
        }
      }

      if (ua.includes('android')) {
        window.location.href = 'intent://settings#Intent;scheme=android-app;package=com.android.settings;end'
        return
      }
      if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
        window.location.href = 'app-settings:'
        return
      }
      window.open('about:preferences#privacy', '_blank')
    } catch {
      // best effort only
    } finally {
      window.setTimeout(() => {
        toast.message('If settings did not open, follow the steps shown below.')
      }, 600)
    }
  }

  // Platform-specific permission recovery instructions shown in the dialog.
  const getCameraPermissionSteps = () => {
    if (isNativeCapacitorApp()) {
      return [
        'Open this app in system settings.',
        'Allow Camera permission for the app.',
        'Return to AnnDrive and tap Retry Camera.',
      ]
    }
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android')) {
      return [
        'In browser, tap the lock icon near the address bar.',
        'Open Site settings/Permissions for this site.',
        'Set Camera to Allow.',
        'Return to this page and tap Retry Camera.',
      ]
    }
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
      return [
        'Open iPhone Settings.',
        'Find Safari (or your browser app).',
        'Enable Camera access for that browser.',
        'Return to this page and tap Retry Camera.',
      ]
    }
    if (ua.includes('edg/')) {
      return [
        'Open edge://settings/content/camera',
        'Allow camera globally and for this site.',
        'Reload this page and tap Retry Camera.',
      ]
    }
    if (ua.includes('chrome')) {
      return [
        'Open chrome://settings/content/camera',
        'Allow camera globally and for this site.',
        'Reload this page and tap Retry Camera.',
      ]
    }
    return [
      'Open browser/site settings for this page.',
      'Allow Camera permission for this site.',
      'Reload this page if needed.',
      'Tap Retry Camera.',
    ]
  }

  // Central permission-denied handler to show actionable hints.
  const handleCameraPermissionDenied = (message?: string) => {
    closeCameraCapture()
    setCameraError(message || 'Camera access is required for POD. Please allow camera permission.')
    setCameraPermissionHint(message || '')
    setIsCameraPermissionDialogOpen(true)
    toast.error('Camera permission is required to complete delivery')
  }

  // Captures a still frame from video stream for POD or spare damage evidence.
  const captureFromCamera = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error('Camera is not ready yet')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      toast.error('Failed to capture photo')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedCameraPhoto(dataUrl)
  }

  const continueCapturedPhoto = async () => {
    if (!capturedCameraPhoto) return
    try {
      const response = await fetch(capturedCameraPhoto)
      const blob = await response.blob()
      const file = new File([blob], `pod-camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      if (cameraCaptureTarget === 'spare') {
        appendSpareDamagePhotos([file])
      } else {
        handlePodFileChange(file)
      }
      closeCameraCapture()
    } catch {
      toast.error('Failed to use captured photo')
    }
  }

  // Camera and state cleanup effects.
  useEffect(() => {
    return () => {
      if (podImagePreview) {
        URL.revokeObjectURL(podImagePreview)
      }
      spareDamagePhotoPreviews.forEach((url) => URL.revokeObjectURL(url))
      stopCameraStream()
    }
  }, [podImagePreview, spareDamagePhotoPreviews])

  useEffect(() => {
    if (!isCameraOpen) return

    let mounted = true
    const startCamera = async () => {
      setIsCameraLoading(true)
      setCameraError(null)
      try {
        if (!window.isSecureContext) {
          handleCameraPermissionDenied('Camera requires a secure connection (HTTPS). Open this app over HTTPS to allow camera on mobile.')
          return
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          handleCameraPermissionDenied('This browser/device does not expose camera APIs for this page.')
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        cameraStreamRef.current = stream
        await attachCameraStreamToVideo()
      } catch (error: any) {
        const errName = String(error?.name || '')
        const denied =
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          errName === 'SecurityError'
        if (denied || errName === 'NotFoundError' || errName === 'NotReadableError' || errName === 'AbortError' || errName === 'TypeError') {
          const specificMessage =
            denied
              ? 'Camera permission denied. Please enable camera access in browser/app settings.'
              : errName === 'NotFoundError'
                ? 'No camera device was found on this phone.'
                : errName === 'NotReadableError'
                  ? 'Camera is busy in another app. Close other camera apps and retry.'
                  : errName === 'TypeError'
                    ? 'Camera is unavailable for this page. On mobile this usually means non-HTTPS access.'
                    : 'Unable to start camera. Please check permission and try again.'
          handleCameraPermissionDenied(specificMessage)
          return
        }
        handleCameraPermissionDenied('Unable to access camera on this device/browser.')
      } finally {
        if (mounted) {
          setIsCameraLoading(false)
        }
      }
    }

    void startCamera()

    return () => {
      mounted = false
      stopCameraStream()
    }
  }, [isCameraOpen])

  useEffect(() => {
    if (!isCameraOpen || capturedCameraPhoto) return
    void attachCameraStreamToVideo()
  }, [isCameraOpen, capturedCameraPhoto])

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
        heading: Number.isFinite(Number(currentLocation.heading)) ? Number(currentLocation.heading) : null,
        speed: Number.isFinite(Number(currentLocation.speed)) ? Number(currentLocation.speed) : null,
        recordedAt: Number(currentLocation.recordedAt || Date.now()),
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
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setPreviewDriverLocation({
            lat,
            lng,
            accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null,
            heading: Number.isFinite(Number(position.coords.heading)) ? Number(position.coords.heading) : null,
            speed: Number.isFinite(Number(position.coords.speed)) ? Number(position.coords.speed) : null,
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
  }, [trip.id, currentLocation?.lat, currentLocation?.lng])

  const cameraPermissionSteps = getCameraPermissionSteps()
  // Normalizes unknown inputs to valid numeric coordinates or null.
  const toCoordinate = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const mappableDropPoints = sortedDropPoints
    .map((point) => {
      const latitude = toCoordinate(point.latitude)
      const longitude = toCoordinate(point.longitude)
      return {
        ...point,
        latitude,
        longitude,
      }
    })
    .filter((point) => point.latitude !== null && point.longitude !== null)
  // Shared "done" status predicate for rendering stop progress and route segments.
  const isDropPointDone = (status: unknown) => {
    const normalized = String(status || '').toUpperCase()
    return normalized === 'COMPLETED' || normalized === 'DELIVERED'
  }
  const nextPendingIndex = mappableDropPoints.findIndex((point) => !isDropPointDone(point.status))
  const completedDropPoints =
    nextPendingIndex === -1 ? mappableDropPoints : mappableDropPoints.slice(0, Math.max(nextPendingIndex, 0))
  const pendingDropPoints =
    nextPendingIndex === -1 ? [] : mappableDropPoints.slice(Math.max(nextPendingIndex, 0))
  // Route/mapping derived values for start point, live driver marker, and waypoints.
  const warehouseRouteStart = (() => {
    const warehouseLat =
      toCoordinate(trip.warehouseLatitude) ??
      toCoordinate(trip.warehouse?.latitude) ??
      toCoordinate(trip.startLatitude)
    const warehouseLng =
      toCoordinate(trip.warehouseLongitude) ??
      toCoordinate(trip.warehouse?.longitude) ??
      toCoordinate(trip.startLongitude)
    if (warehouseLat === null || warehouseLng === null) return null
    return { lat: warehouseLat, lng: warehouseLng }
  })()
  const isWithinNegrosBounds = (lat: number, lng: number) =>
    lat >= NEGROS_OCCIDENTAL_BOUNDS.south &&
    lat <= NEGROS_OCCIDENTAL_BOUNDS.north &&
    lng >= NEGROS_OCCIDENTAL_BOUNDS.west &&
    lng <= NEGROS_OCCIDENTAL_BOUNDS.east
  const MAX_MAP_ACCEPTABLE_ACCURACY_METERS = 150
  const MAX_LATEST_LOCATION_AGE_MS = 15 * 60 * 1000
  const MAX_REAL_CURRENT_LOCATION_AGE_MS = 2 * 60 * 1000
  const isReasonableGps = (lat: number, lng: number, accuracy?: number | null) =>
    isWithinNegrosBounds(lat, lng) && (!Number.isFinite(Number(accuracy)) || Number(accuracy) <= MAX_MAP_ACCEPTABLE_ACCURACY_METERS)
  const isFreshRecordedAt = (value: unknown, maxAgeMs: number) => {
    const ts = Number(value)
    if (!Number.isFinite(ts) || ts <= 0) return false
    return Date.now() - ts <= maxAgeMs
  }
  const normalizedTripStatus = String(trip.status || '').toUpperCase()
  const hasNearbyDropPointForWarehouseStart = warehouseRouteStart
    ? mappableDropPoints.some((point) =>
        haversineKm(
          { lat: warehouseRouteStart.lat, lng: warehouseRouteStart.lng },
          { lat: Number(point.latitude), lng: Number(point.longitude) }
        ) <= 60
      )
    : false
  const nextDropPoint = mappableDropPoints.find((point) => String(point.status || '').toUpperCase() !== 'COMPLETED' && String(point.status || '').toUpperCase() !== 'DELIVERED') || mappableDropPoints[0] || null
  const latestLocationAgeMs = (() => {
    const rawRecordedAt = String((trip.latestLocation as any)?.recordedAt || '').trim()
    if (!rawRecordedAt) return Number.POSITIVE_INFINITY
    const parsed = new Date(rawRecordedAt).getTime()
    if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY
    return Date.now() - parsed
  })()
  const effectiveDriverLocation = (currentLocation && Number.isFinite(Number(currentLocation.lat)) && Number.isFinite(Number(currentLocation.lng))
      && isFreshRecordedAt(currentLocation.recordedAt, MAX_REAL_CURRENT_LOCATION_AGE_MS)
      && isReasonableGps(Number(currentLocation.lat), Number(currentLocation.lng), Number(currentLocation.accuracy))
      ? currentLocation
      : null) ||
    (previewDriverLocation && Number.isFinite(Number(previewDriverLocation.lat)) && Number.isFinite(Number(previewDriverLocation.lng))
      && isFreshRecordedAt(previewDriverLocation.recordedAt, MAX_REAL_CURRENT_LOCATION_AGE_MS)
      && isReasonableGps(Number(previewDriverLocation.lat), Number(previewDriverLocation.lng), Number(previewDriverLocation.accuracy))
      ? previewDriverLocation
      : null) ||
    (trip.latestLocation && Number.isFinite(Number(trip.latestLocation.latitude)) && Number.isFinite(Number(trip.latestLocation.longitude))
      && latestLocationAgeMs <= MAX_LATEST_LOCATION_AGE_MS
      && isReasonableGps(
        Number(trip.latestLocation.latitude),
        Number(trip.latestLocation.longitude),
        Number(trip.latestLocation.accuracy)
      )
      ? {
          lat: Number(trip.latestLocation.latitude),
          lng: Number(trip.latestLocation.longitude),
          accuracy: toCoordinate(trip.latestLocation.accuracy),
          heading: toCoordinate(trip.latestLocation.heading),
          speed: toCoordinate(trip.latestLocation.speed),
        }
      : null)
  const driverMarkerHeading =
    nextDropPoint &&
    Number.isFinite(Number(nextDropPoint?.latitude)) &&
    Number.isFinite(Number(nextDropPoint?.longitude)) &&
    Number.isFinite(Number(effectiveDriverLocation?.lat)) &&
    Number.isFinite(Number(effectiveDriverLocation?.lng))
      ? (() => {
          const fromLat = Number(effectiveDriverLocation?.lat)
          const fromLng = Number(effectiveDriverLocation?.lng)
          const toLat = Number(nextDropPoint.latitude)
          const toLng = Number(nextDropPoint.longitude)
          const toRad = (value: number) => (value * Math.PI) / 180
          const toDeg = (value: number) => (value * 180) / Math.PI
          const phi1 = toRad(fromLat)
          const phi2 = toRad(toLat)
          const deltaLng = toRad(toLng - fromLng)
          const y = Math.sin(deltaLng) * Math.cos(phi2)
          const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng)
          return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360
        })()
      : null

  const driverLocationMarker = (() => {
    if (!effectiveDriverLocation) return null
    const lat = toCoordinate(effectiveDriverLocation?.lat)
    const lng = toCoordinate(effectiveDriverLocation?.lng)
    if (lat === null || lng === null) return null
    return {
      id: `driver-${trip.id}`,
      driverName: 'You (Driver)',
      vehiclePlate: trip.vehicle?.licensePlate || 'Vehicle',
      lat,
      lng,
      status: isTracking ? 'IN_PROGRESS' : (trip.status || 'PLANNED'),
      markerLabel: Number.isFinite(Number(effectiveDriverLocation.accuracy))
        ? `Current location +- ${Math.round(Number(effectiveDriverLocation.accuracy))} m`
        : 'Current location',
      markerType: 'truck' as const,
      markerHeading: driverMarkerHeading ?? undefined,
      markerColor: '#1d4ed8',
      accuracyMeters: Number.isFinite(Number(effectiveDriverLocation.accuracy))
        ? Number(effectiveDriverLocation.accuracy)
        : undefined,
    }
  })()

  const etaStartPoint =
    driverLocationMarker
      ? { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }
      : warehouseRouteStart
  let etaAnchor = etaStartPoint
  let cumulativeEtaKm = 0
  let pendingPhaseIndex = 0
  const dropPointMapLocations = mappableDropPoints.map((point) => {
    const isCompleted = isDropPointDone(point.status)
    let markerEta: string | undefined
    let markerEtaPhase: 'completed' | 'next' | 'upcoming' | undefined

    if (isCompleted) {
      markerEta = 'Arrived'
      markerEtaPhase = 'completed'
    } else if (etaAnchor) {
      const target = { lat: point.latitude as number, lng: point.longitude as number }
      cumulativeEtaKm += haversineKm(etaAnchor, target)
      etaAnchor = target
      const estimatedMinutes = Math.max(1, Math.round((cumulativeEtaKm / ETA_SPEED_KMH) * 60))
      markerEta = `${estimatedMinutes} min`
      markerEtaPhase = pendingPhaseIndex === 0 ? 'next' : 'upcoming'
      pendingPhaseIndex += 1
    }

    return {
      id: point.id,
      driverName: point.locationName || `Stop ${point.sequence}`,
      vehiclePlate: trip.vehicle?.licensePlate || 'Vehicle',
      lat: point.latitude as number,
      lng: point.longitude as number,
      status: point.status || 'PENDING',
      markerLabel: `${point.sequence}. ${stripPhilippinesFromAddress(point.address) || point.city || 'Drop Point'}`,
      markerType: 'pin' as const,
      markerColor: '#2563eb',
      markerNumber: point.sequence,
      markerEta,
      markerEtaPhase,
    }
  })

  const mapLocations = driverLocationMarker ? [driverLocationMarker, ...dropPointMapLocations] : dropPointMapLocations
  const fullRouteWaypoints = (() => {
    const start = warehouseRouteStart ? [warehouseRouteStart] : []
    const completedCoords = completedDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    const pendingCoords = pendingDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    if (driverLocationMarker) {
      return [...start, ...completedCoords, { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }, ...pendingCoords]
    }
    return [...start, ...completedCoords, ...pendingCoords]
  })()
  const upcomingRouteWaypoints = (() => {
    const pendingCoords = pendingDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    if (driverLocationMarker) return [{ lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }, ...pendingCoords]
    return pendingCoords
  })()
  const completedRouteWaypoints = (() => {
    const completedCoords = completedDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    if (driverLocationMarker && completedCoords.length > 0) {
      return [...completedCoords, { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }]
    }
    return completedCoords
  })()
  const routeWaypoints = fullRouteWaypoints
  const routeWaypointsKey = routeWaypoints
    .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
    .join('|')
  // Finds nearest polyline index for splitting route into completed/upcoming sections.
  const findNearestPolylineIndex = (
    target: { lat: number; lng: number },
    points: [number, number][]
  ) => {
    if (!Array.isArray(points) || points.length === 0) return 0
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const latDiff = point[0] - target.lat
      const lngDiff = point[1] - target.lng
      const distance2 = latDiff * latDiff + lngDiff * lngDiff
      if (distance2 < bestDistance) {
        bestDistance = distance2
        bestIndex = index
      }
    }
    return bestIndex
  }

  // Computes road route polyline based on map locations and updates split sections.
  useEffect(() => {
    const uniqueWaypoints = routeWaypoints.filter((point, index, list) => {
      if (index === 0) return true
      const prev = list[index - 1]
      return !(Math.abs(point.lat - prev.lat) < 0.000001 && Math.abs(point.lng - prev.lng) < 0.000001)
    })

    if (uniqueWaypoints.length < 2) {
      setRoadRoutePoints([])
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)

    const run = async () => {
      try {
        const coordinates = uniqueWaypoints
          .map((point) => `${encodeURIComponent(String(point.lng))},${encodeURIComponent(String(point.lat))}`)
          .join(';')

        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
          { signal: controller.signal }
        )
        const payload = await response.json().catch(() => ({}))
        const coords = payload?.routes?.[0]?.geometry?.coordinates
        if (!response.ok || !Array.isArray(coords) || coords.length < 2) {
          setRoadRoutePoints([])
          return
        }
        const points = coords
          .map((pair: any) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
          .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
        setRoadRoutePoints(points.length > 1 ? points : [])
      } catch {
        setRoadRoutePoints([])
      }
    }

    void run()

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [trip.id, routeWaypointsKey])

  const fallbackRoutePoints = routeWaypoints.map((point) => [point.lat, point.lng] as [number, number])
  const upcomingFallbackPoints = upcomingRouteWaypoints.map((point) => [point.lat, point.lng] as [number, number])
  const completedFallbackPoints = completedRouteWaypoints.map((point) => [point.lat, point.lng] as [number, number])
  // Derived split index used to color completed vs pending route legs.
  const roadSplitIndex = (() => {
    if (roadRoutePoints.length < 2) return null
    if (driverLocationMarker) {
      return findNearestPolylineIndex(
        { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng },
        roadRoutePoints
      )
    }
    const lastCompleted = completedDropPoints[completedDropPoints.length - 1]
    if (lastCompleted) {
      return findNearestPolylineIndex(
        { lat: Number(lastCompleted.latitude), lng: Number(lastCompleted.longitude) },
        roadRoutePoints
      )
    }
    return 0
  })()
  const completedRoutePoints =
    roadRoutePoints.length > 1 && roadSplitIndex !== null
      ? roadSplitIndex > 0
        ? roadRoutePoints.slice(0, roadSplitIndex + 1)
        : []
      : completedFallbackPoints
  const upcomingRoutePoints =
    roadRoutePoints.length > 1 && roadSplitIndex !== null
      ? roadRoutePoints.slice(Math.max(0, roadSplitIndex))
      : upcomingFallbackPoints.length > 1
        ? upcomingFallbackPoints
        : fallbackRoutePoints
  const mapRouteLines = [
    ...(completedRoutePoints.length > 1
      ? [
          {
            id: `trip-${trip.id}-route-completed`,
            points: completedRoutePoints,
            color: '#6b7280',
            label: `${trip.tripNumber} completed path`,
            opacity: 0.95,
            weight: 9,
          },
        ]
      : []),
    ...(upcomingRoutePoints.length > 1
      ? [
          {
            id: `trip-${trip.id}-route-upcoming`,
            points: upcomingRoutePoints,
            color: '#2563eb',
            label: `${trip.tripNumber} upcoming path`,
            opacity: 1,
            weight: 8,
          },
        ]
      : []),
  ]
  // Chooses a stable map center candidate based on best available location signal.
  const mapCenterCandidate = (driverLocationMarker
    ? [driverLocationMarker.lat, driverLocationMarker.lng]
    : mapLocations[0]
    ? [mapLocations[0].lat, mapLocations[0].lng]
    : NEGROS_OCCIDENTAL_CENTER) as [number, number]
  const mapCenter =
    mapCenterCandidate[0] >= NEGROS_OCCIDENTAL_BOUNDS.south &&
    mapCenterCandidate[0] <= NEGROS_OCCIDENTAL_BOUNDS.north &&
    mapCenterCandidate[1] >= NEGROS_OCCIDENTAL_BOUNDS.west &&
    mapCenterCandidate[1] <= NEGROS_OCCIDENTAL_BOUNDS.east
      ? mapCenterCandidate
      : NEGROS_OCCIDENTAL_CENTER
  const mobileMapCenter = mobileMapRecenterCenter || mapCenter

  // Best-effort live location refresh for recenter button.
  const getFreshDriverLocation = () =>
    new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null)
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = Number(position.coords.latitude)
          const lng = Number(position.coords.longitude)
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            resolve({ lat, lng })
            return
          }
          resolve(null)
        },
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 4000, timeout: 7000 }
      )
    })

  // Recenter behavior for mobile map view.
  const handleMobileMapRecenter = async () => {
    const liveLat = toCoordinate(currentLocation?.lat)
    const liveLng = toCoordinate(currentLocation?.lng)
    const previewLat = toCoordinate(previewDriverLocation?.lat)
    const previewLng = toCoordinate(previewDriverLocation?.lng)

    let targetLat = liveLat ?? previewLat ?? driverLocationMarker?.lat ?? null
    let targetLng = liveLng ?? previewLng ?? driverLocationMarker?.lng ?? null

    if (!Number.isFinite(Number(targetLat)) || !Number.isFinite(Number(targetLng))) {
      const freshLocation = await getFreshDriverLocation()
      if (freshLocation) {
        setPreviewDriverLocation(freshLocation)
        targetLat = freshLocation.lat
        targetLng = freshLocation.lng
      }
    }

    if (!Number.isFinite(Number(targetLat)) || !Number.isFinite(Number(targetLng))) {
      toast.error('Current location unavailable. Enable location to recenter map.')
      return
    }

    const nextCenter: [number, number] = [Number(targetLat), Number(targetLng)]
    setMobileMapRecenterCenter(nextCenter)
    setMobileMapRecenterSignal((prev) => prev + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-[#dff0ea] to-transparent" />
        <div className="space-y-4 p-4">
          {/* Header */}
          <div className="hidden rounded-2xl border border-emerald-300/40 bg-blue-700 px-3 pb-3 pt-2.5 text-white shadow-[0_12px_26px_rgba(2,132,199,0.22)] md:mt-0 md:block md:px-4 md:pb-4 md:pt-3">
            <Button variant="ghost" size="sm" className="mb-1 h-6 p-0 text-[11px] text-white hover:bg-white/10 md:mb-2 md:h-7 md:text-xs" onClick={onBack}>
              &lt; Back to Trips
            </Button>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold leading-tight md:text-xl">{trip.tripNumber}</h2>
                <p className="text-slate-300 text-xs md:text-sm">{trip.vehicle?.licensePlate}</p>
                <p className="text-slate-300 text-xs md:text-sm">Schedule: {formatTripSchedule(trip.tripSchedule)}</p>
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

          {/* Start Trip Button */}
          {trip.status === 'PLANNED' && (
            <div>
              {notLoadedTripOrders.length > 0 ? (
                <p className="mb-2 text-sm text-red-600">
                  All products in this trip must be marked as loaded first: {notLoadedTripOrders.slice(0, 3).join(', ')}
                </p>
              ) : null}
              <Button
                className="h-12 w-full gap-2 bg-slate-900 text-lg text-white hover:bg-slate-800"
                onClick={() => setIsStartTripConfirmOpen(true)}
                disabled={isUpdating || notLoadedTripOrders.length > 0}
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

          <Dialog open={isStartTripConfirmOpen} onOpenChange={setIsStartTripConfirmOpen}>
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-[#123a67]">Start Trip?</DialogTitle>
                <DialogDescription className="text-slate-600">
                  This will mark the trip as <span className="font-semibold">IN PROGRESS</span>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 px-5 pb-5 pt-2 text-sm text-slate-700">
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                  <p className="font-medium text-slate-900">{trip.tripNumber || 'Selected Trip'}</p>
                  <p>Make sure all assigned orders are loaded before continuing.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsStartTripConfirmOpen(false)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={async () => {
                      setIsStartTripConfirmOpen(false)
                      await handleStartTrip()
                    }}
                    disabled={isUpdating}
                  >
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Start Trip
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isArriveWarningOpen} onOpenChange={setIsArriveWarningOpen}>
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#fff8f0] via-white to-[#f7fbff] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-amber-700">Warning Before Marking Arrived</DialogTitle>
                <DialogDescription className="text-slate-600">
                  This will update the stop status to <span className="font-semibold">ARRIVED</span>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 px-5 pb-5 pt-2 text-sm text-slate-700">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <p>Confirm that you are physically at the drop point before continuing.</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="font-medium text-slate-900">{arriveTargetDropPointName || 'Drop Point'}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsArriveWarningOpen(false)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-amber-600 text-white hover:bg-amber-700"
                    onClick={async () => {
                      const targetId = String(arriveTargetDropPointId || '').trim()
                      setIsArriveWarningOpen(false)
                      if (!targetId) return
                      await handleUpdateDropPoint(targetId, 'ARRIVED')
                    }}
                    disabled={isUpdating || !arriveTargetDropPointId}
                  >
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Navigation className="mr-2 h-4 w-4" />}
                    Mark Arrived
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isReplacementWarningOpen} onOpenChange={setIsReplacementWarningOpen}>
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#fff8f0] via-white to-[#f7fbff] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-amber-700">Confirm Report Replacement</DialogTitle>
                <DialogDescription className="text-slate-600">
                  Please confirm you want to report a replacement for this stop.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 px-5 pb-5 pt-2 text-sm text-slate-700">
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsReplacementWarningOpen(false)}
                    disabled={isUpdating || isSpareReplacing}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-amber-600 text-white hover:bg-amber-700"
                    onClick={() => {
                      const targetId = String(replacementTargetDropPointId || '').trim()
                      setIsReplacementWarningOpen(false)
                      if (!targetId) return
                      const targetDropPoint = sortedDropPoints.find((point) => String(point.id) === targetId)
                      if (!targetDropPoint) return
                      openSpareReplacement(targetDropPoint)
                    }}
                    disabled={isUpdating || isSpareReplacing || !replacementTargetDropPointId}
                  >
                    <AlertCircle className="mr-2 h-4 w-4" />
                    Continue
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isDeliveredWarningOpen} onOpenChange={setIsDeliveredWarningOpen}>
            <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#fff8f0] via-white to-[#f7fbff] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
              <DialogHeader className="px-5 pt-5">
                <DialogTitle className="text-amber-700">Warning Before Marking Delivered</DialogTitle>
                <DialogDescription className="text-slate-600">
                  This will finalize delivery for this stop and update the order status.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 px-5 pb-5 pt-2 text-sm text-slate-700">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <p>Confirm POD photo and delivery details are correct before continuing.</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="font-medium text-slate-900">{deliveredTargetDropPointName || 'Drop Point'}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDeliveredWarningOpen(false)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={async () => {
                      const targetId = String(deliveredTargetDropPointId || '').trim()
                      setIsDeliveredWarningOpen(false)
                      if (!targetId) return
                      const targetDropPoint = sortedDropPoints.find((point) => String(point.id) === targetId)
                      if (!targetDropPoint) return
                      await submitDeliveredForDropPoint(targetDropPoint)
                    }}
                    disabled={isUpdating || !deliveredTargetDropPointId}
                  >
                    {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Delivered
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Route Map */}
          {!isMobileViewport ? (
            <div className="hidden rounded-2xl border border-sky-200/60 bg-white/90 p-4 pt-0 shadow-[0_14px_30px_rgba(15,23,42,0.12)] backdrop-blur md:block md:rounded-2xl md:border md:border-sky-200/60 md:bg-white/90 md:shadow-[0_14px_30px_rgba(15,23,42,0.12)] md:backdrop-blur">
              <h3 className="font-semibold text-slate-900">Route Map</h3>
              {mapLocations.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">
                  No map data for this trip yet. Add delivery coordinates to order shipping addresses.
                </div>
              ) : (
                <LiveTrackingMap
                  locations={mapLocations}
                  routeLines={mapRouteLines}
                  center={mapCenter}
                  zoom={13}
                  navigationPerspective
                  restrictToNegrosOccidental
                  showDriverSelfBadge
                  showZoomControls={false}
                  className="h-[240px] w-full overflow-hidden rounded-xl border shadow-sm md:h-[400px]"
                />
              )}
            </div>
          ) : null}

          {isMobileViewport ? (
          <div className="relative -mx-4 overflow-hidden md:hidden">
            <div className="relative h-[calc(100dvh-12rem)] min-h-[540px] w-full overflow-hidden bg-[#dff0ea]">
              {mapLocations.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-600">
                  No map data for this trip yet. Add delivery coordinates to order shipping addresses.
                </div>
              ) : (
                <LiveTrackingMap
                  locations={mapLocations}
                  routeLines={mapRouteLines}
                  center={mobileMapCenter}
                  zoom={13}
                  navigationPerspective
                  restrictToNegrosOccidental
                  showDriverSelfBadge
                  recenterSignal={mobileMapRecenterSignal}
                  showZoomControls={false}
                  className="h-full w-full overflow-hidden rounded-none border-0 shadow-none"
                />
              )}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-[#f8fbfe]/95 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-t from-[#dff0ea] to-transparent" />
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to trips"
                className="absolute left-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/92 text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.12)] backdrop-blur"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="absolute left-[3.6rem] top-4 z-20 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.12)] backdrop-blur">
                Route Map
              </div>
              <button
                type="button"
                onClick={handleMobileMapRecenter}
                aria-label="Recenter map to driver location"
                className="absolute bottom-[calc(env(safe-area-inset-bottom)+10.8rem)] right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-teal-200 bg-[#d8f4f7]/95 text-teal-900 shadow-[0_8px_18px_rgba(13,76,95,0.22)] backdrop-blur"
              >
                <LocateFixed className="h-5 w-5" />
              </button>

              <Drawer
                open={isMobileSheetOpen && !hasBlockingDialogOpen}
                onOpenChange={handleMobileSheetOpenChange}
                direction="bottom"
                dismissible
                handleOnly={false}
                modal={false}
                fixed
                snapPoints={mobileSheetSnapPoints}
                activeSnapPoint={mobileSheetSnapPoint}
                setActiveSnapPoint={handleMobileSheetSnapPointChange}
              >
                <DrawerContent
                  hideOverlay
                  className="!bottom-[calc(env(safe-area-inset-bottom)+5.2rem)] !z-[1200] !mt-0 min-h-[7rem] max-h-[calc(100dvh-5.2rem)] rounded-t-[1.9rem] border border-white/80 bg-white/96 shadow-[0_-18px_50px_rgba(15,23,42,0.18)]"
                >
                  <div className="max-h-[calc(100dvh-12.5rem)] overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
                    <DrawerTitle className="sr-only">Trip drop points</DrawerTitle>
                    <DrawerHandle className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-300" />
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
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                                dropPoint.status === 'COMPLETED' ? 'bg-green-500 text-white' :
                                dropPoint.status === 'FAILED' ? 'bg-red-500 text-white' :
                                'bg-gray-200 text-gray-600'
                              }`}>
                                {dropPoint.status === 'COMPLETED' ? <CheckCircle className="h-4 w-4" /> : dropPoint.sequence}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="font-medium text-slate-900">{dropPoint.locationName}</p>
                                    <p className="text-sm text-slate-500">{stripPhilippinesFromAddress(dropPoint.address)}</p>
                                    {dropPoint.order ? (
                                      <>
                                        <p className="mt-1 text-xs text-sky-700">{dropPoint.order.orderNumber}</p>
                                        <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
                                          <p className="text-[11px] font-semibold text-amber-800">
                                            Total Price: {formatCurrency(Number(dropPoint.order.totalAmount || 0))}
                                          </p>
                                        </div>
                                        {(() => {
                                          const replacementProgress = getReplacementProgress(dropPoint)
                                          if (!replacementProgress.openReplacement) return null
                                          return (
                                            <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                              <p className="text-[11px] font-semibold text-emerald-800">
                                                Replacement in progress: {replacementProgress.replacedQuantity} replaced, {replacementProgress.remainingQuantity} still need to be replaced.
                                              </p>
                                            </div>
                                          )
                                        })()}
                                      </>
                                    ) : null}
                                  </div>
                                  <Badge className={dropPointStatusColors[dropPoint.status] || 'bg-gray-100'}>
                                    {dropPoint.status}
                                  </Badge>
                                </div>
                                {dropPoint.contactPhone ? (
                                  <a href={`tel:${dropPoint.contactPhone}`} className="mt-2 inline-flex items-center gap-1 text-sm text-sky-700">
                                    <Phone className="h-4 w-4" />
                                    Call Contact
                                  </a>
                                ) : null}
                              </div>
                            </div>

                            {activeDropPoint?.id === dropPoint.id && trip.status === 'IN_PROGRESS' && (
                              <div className="mt-4 space-y-3 border-t pt-4">
                                {['PENDING', 'IN_TRANSIT'].includes(String(dropPoint.status || '').toUpperCase()) && (
                                  <Button
                                    className="w-full"
                                    onClick={(e) => { e.stopPropagation(); openArriveWarning(dropPoint); }}
                                    disabled={isUpdating}
                                  >
                                    <Navigation className="mr-2 h-4 w-4" />
                                    Mark Arrived
                                  </Button>
                                )}
                                {dropPoint.status === 'ARRIVED' && (
                                  <div className="space-y-3">
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
                                          openCameraCapture('pod')
                                        }}
                                      >
                                        <Camera className="mr-2 h-4 w-4" />
                                        {podImagePreview ? 'Retake POD Photo' : 'Capture POD Photo'}
                                      </Button>
                                      {dropPoint.order ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className={`w-full ${getDropPointOpenReplacement(dropPoint) ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-50' : 'border-sky-200 text-[#0f3d72] hover:bg-sky-50'}`}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (getDropPointOpenReplacement(dropPoint)) {
                                              openSpareReplacement(dropPoint)
                                            } else {
                                              openReplacementWarning(dropPoint)
                                            }
                                          }}
                                          disabled={isUpdating || isSpareReplacing}
                                        >
                                          {getDropPointOpenReplacement(dropPoint) ? 'Resolve Replacement' : 'Report Replacement'}
                                        </Button>
                                      ) : null}
                                      <p className="text-xs text-slate-500">Camera access is required before marking as delivered.</p>
                                      {getDropPointOpenReplacement(dropPoint) ? (
                                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                          Delivery is blocked until the open replacement is resolved with photo evidence.
                                        </div>
                                      ) : null}
                                      {podImagePreview ? (
                                        <img
                                          src={podImagePreview}
                                          alt="POD preview"
                                          className="h-36 w-full rounded-md border border-slate-200 object-cover"
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
                                        disabled={isUpdating || Boolean(getDropPointOpenReplacement(dropPoint))}
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
                  </div>
                </DrawerContent>
              </Drawer>
            </div>

            <AnimatePresence mode="wait">
              {!hasBlockingDialogOpen && !isMobileSheetOpen && showMobileSheetPeek ? (
                <motion.button
                  key="mobile-sheet-peek"
                  type="button"
                  initial={{ opacity: 0, y: 20, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.985 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.2rem)] z-[1250] rounded-2xl border border-white/85 bg-white/96 px-4 pb-3 pt-2 text-left shadow-[0_-10px_26px_rgba(15,23,42,0.2)]"
                  onClick={openMobileSheet}
                  onTouchStart={handleMobileSheetPeekTouchStart}
                  onTouchMove={handleMobileSheetPeekTouchMove}
                  onTouchEnd={handleMobileSheetPeekTouchEnd}
                >
                  <span className="mx-auto mb-2 block h-1.5 w-14 rounded-full bg-slate-300" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Drop Points</p>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-black tracking-[-0.02em] text-slate-900">{trip.tripNumber}</p>
                      <p className="text-[11px] text-slate-500">Schedule: {formatTripSchedule(trip.tripSchedule)}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {effectiveCompletedDropPoints}/{trip.totalDropPoints} Completed
                    </span>
                  </div>
                </motion.button>
              ) : null}
            </AnimatePresence>
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
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        dropPoint.status === 'COMPLETED' ? 'bg-green-500 text-white' :
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
                                <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
                                  <p className="text-[11px] font-semibold text-amber-800">
                                    Total Price: {formatCurrency(Number(dropPoint.order.totalAmount || 0))}
                                  </p>
                                </div>
                                {(() => {
                                  const replacementProgress = getReplacementProgress(dropPoint)
                                  if (!replacementProgress.openReplacement) return null
                                  return (
                                    <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                                      <p className="text-[11px] font-semibold text-emerald-800">
                                        Replacement in progress: {replacementProgress.replacedQuantity} replaced, {replacementProgress.remainingQuantity} still need to be replaced.
                                      </p>
                                    </div>
                                  )
                                })()}
                                {(dropPoint.order.items || []).length > 0 ? (
                                  <div className="mt-1 rounded-md bg-slate-50 px-2 py-1.5 md:mt-2 md:px-3 md:py-2.5">
                                    <p className="text-[11px] font-semibold text-slate-600 md:text-sm">Order Details</p>
                                    <div className="mt-1 space-y-0.5 md:mt-2 md:space-y-1">
                                      {(dropPoint.order.items || []).map((item, index) => (
                                        <div key={`${dropPoint.id}-item-${index}`} className="text-[11px] text-slate-600 md:text-sm">
                                          <p>{item.product?.name || 'Item'} x{Number(item.quantity || 0)}</p>
                                          {Number(item.spareProducts?.recommendedQuantity || 0) > 0 ? (
                                            <div className="mt-1 rounded border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] text-blue-700 md:px-2.5 md:py-1.5 md:text-xs">
                                              <p>Spare products: {Number(item.spareProducts?.recommendedQuantity || 0)}</p>
                                              <p>Total load {Number(item.spareProducts?.totalLoadQuantity || item.quantity || 0)}</p>
                                            </div>
                                          ) : null}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {(dropPoint.deliveryPhoto || (activeDropPoint?.id === dropPoint.id && podImagePreview)) ? (
                                  <div className="mt-2 rounded-md bg-slate-50 px-2 py-2">
                                    <p className="text-[11px] font-semibold text-slate-600">POD Photo</p>
                                    <img
                                      src={dropPoint.deliveryPhoto || podImagePreview || ''}
                                      alt="POD"
                                      className="mt-1 h-24 w-full rounded border border-slate-200 object-cover"
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
                        {dropPoint.contactPhone && (
                          <a href={`tel:${dropPoint.contactPhone}`} className="mt-2 inline-flex items-center gap-1 text-sm text-sky-700">
                            <Phone className="h-4 w-4" />
                            Call Contact
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Drop Point Actions */}
                    {activeDropPoint?.id === dropPoint.id && trip.status === 'IN_PROGRESS' && (
                      <div className="mt-4 space-y-3 border-t pt-4">
                        {['PENDING', 'IN_TRANSIT'].includes(String(dropPoint.status || '').toUpperCase()) && (
                          <Button
                            className="w-full"
                            onClick={(e) => { e.stopPropagation(); openArriveWarning(dropPoint); }}
                            disabled={isUpdating}
                          >
                            <Navigation className="h-4 w-4 mr-2" />
                            Mark Arrived
                          </Button>
                        )}
                        {dropPoint.status === 'ARRIVED' && (
                          <div className="space-y-3">
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
                                  openCameraCapture('pod')
                                }}
                              >
                                <Camera className="h-4 w-4 mr-2" />
                                {podImagePreview ? 'Retake POD Photo' : 'Capture POD Photo'}
                              </Button>
                              {dropPoint.order ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={`w-full ${getDropPointOpenReplacement(dropPoint) ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-50' : 'border-sky-200 text-[#0f3d72] hover:bg-sky-50'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (getDropPointOpenReplacement(dropPoint)) {
                                      openSpareReplacement(dropPoint)
                                    } else {
                                      openReplacementWarning(dropPoint)
                                    }
                                  }}
                                  disabled={isUpdating || isSpareReplacing}
                                >
                                  {getDropPointOpenReplacement(dropPoint) ? 'Resolve Replacement' : 'Report Replacement'}
                                </Button>
                              ) : null}
                              <p className="text-xs text-slate-500">Camera access is required before marking as delivered.</p>
                              {getDropPointOpenReplacement(dropPoint) ? (
                                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                  Delivery is blocked until the open replacement is resolved with photo evidence.
                                </div>
                              ) : null}
                              {podImagePreview ? (
                                <img
                                  src={podImagePreview}
                                  alt="POD preview"
                                  className="h-36 w-full rounded-md border border-slate-200 object-cover"
                                />
                              ) : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                className="bg-emerald-600 hover:bg-emerald-700"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  openDeliveredWarning(dropPoint)
                                }}
                                disabled={isUpdating || Boolean(getDropPointOpenReplacement(dropPoint))}
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Delivered
                              </Button>
                              <Button
                                variant="destructive"
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

          {/* Complete Trip Button */}
          {trip.status === 'IN_PROGRESS' && effectiveCompletedDropPoints >= trip.totalDropPoints && (
            <div>
              <Button className="h-12 w-full bg-green-600 hover:bg-green-700">
                <Flag className="h-5 w-5 mr-2" />
                Complete Trip
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isCameraOpen} onOpenChange={(open) => { if (!open) closeCameraCapture() }}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">
                {cameraCaptureTarget === 'spare' ? 'Capture Damage Photo' : 'Capture POD Photo'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                {cameraCaptureTarget === 'spare'
                  ? 'Take a clear photo of the damaged item evidence.'
                  : 'Take a clear photo of the delivered package or recipient.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            {capturedCameraPhoto ? (
              <>
                <img
                  src={capturedCameraPhoto}
                  alt="Captured POD"
                  className="h-64 w-full rounded-xl border border-sky-100 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50" onClick={() => setCapturedCameraPhoto(null)}>
                    Try Again
                  </Button>
                  <Button className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]" onClick={() => void continueCapturedPhoto()}>
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-sky-100 bg-black shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                  <video ref={videoRef} autoPlay playsInline muted className="h-64 w-full object-cover" />
                </div>
                {isCameraLoading ? <p className="text-sm text-[#4d6785]">Opening camera...</p> : null}
                {cameraError ? <p className="text-sm text-red-600">{cameraError}</p> : null}
                <Button className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]" onClick={captureFromCamera} disabled={isCameraLoading || Boolean(cameraError)}>
                  Capture Photo
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCameraPermissionDialogOpen} onOpenChange={setIsCameraPermissionDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Camera Permission Required</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Driver delivery proof requires live camera access. Enable camera permission in browser/app settings, then retry.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <p className="text-sm text-red-600">{cameraError || 'Camera permission is currently blocked.'}</p>
            {cameraPermissionHint ? <p className="text-xs text-[#4d6785]">{cameraPermissionHint}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => {
                  openCameraSettings()
                }}
              >
                Try Open Settings
              </Button>
              <Button
                className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={() => {
                  setIsCameraPermissionDialogOpen(false)
                  window.setTimeout(() => {
                    openCameraCapture(cameraCaptureTarget)
                  }, 120)
                }}
              >
                Retry Camera
              </Button>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white/70 p-3">
              <p className="mb-2 text-xs font-semibold text-[#17365d]">Manual steps</p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-[#4d6785]">
                {cameraPermissionSteps.map((step, index) => (
                  <li key={`camera-step-${index}`}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSpareReplaceOpen} onOpenChange={(open) => { if (!open) closeSpareReplacement() }}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-lg">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">
                {spareFollowUpReturnId ? 'Resolve Replacement' : 'Replacement Form'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                {spareFollowUpReturnId
                  ? 'Capture follow-up photo evidence and submit the remaining replacement quantity to close the case.'
                  : 'Capture damage evidence'}
              </DialogDescription>
            </div>
          </DialogHeader>
          {(() => {
            const targetDropPoint = (trip.dropPoints || []).find((point) => point.id === spareTargetDropPointId) || null
            const targetItems = getDropPointReplacementItems(targetDropPoint)
            const targetOpenReplacement = getDropPointOpenReplacement(targetDropPoint)
            const targetReplacementProgress = getReplacementProgress(targetDropPoint)
            const targetSelectedItem = targetItems.find((item) => item.id === spareOrderItemId) || targetItems[0] || null
            const targetFollowUpQuantities = targetOpenReplacement
              ? getOpenReplacementQuantities(targetOpenReplacement, Number(targetSelectedItem?.quantity || 0))
              : null
            const followUpMode = Boolean(targetOpenReplacement)
            const missingRequirements: string[] = []
            if (!followUpMode && spareReplacementLines.length === 0) missingRequirements.push('Select at least one damaged product')
            if (followUpMode && !spareOrderItemId) missingRequirements.push('Damaged item')
            if (!spareDamageReason) missingRequirements.push('Damage details')
            if (spareDamageReason === 'Others' && !String(spareOtherDamageReason || '').trim()) missingRequirements.push('Other damage reason')
            if (spareDamagePhotoFiles.length === 0) missingRequirements.push('Damage photo')
            const canSubmitSpareReplacement = !isSpareReplacing && missingRequirements.length === 0

            return (
              <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
                {targetOpenReplacement ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Follow-up replacement in progress: {targetReplacementProgress.replacedQuantity} replaced, {targetReplacementProgress.remainingQuantity} still need to be replaced.
                  </div>
                ) : null}
                {followUpMode ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="spare-order-item">Damaged Item</Label>
                      <Select value={spareOrderItemId} onValueChange={setSpareOrderItemId} disabled>
                        <SelectTrigger className="h-9 w-full rounded-md border-sky-200 bg-white text-sm text-slate-900 shadow-sm focus:ring-emerald-500/30 focus:ring-offset-0">
                          <SelectValue placeholder={targetItems.length === 0 ? 'No item details available' : 'Select damaged item'} />
                        </SelectTrigger>
                        <SelectContent className="border-sky-200 bg-white text-slate-900">
                          {targetItems.map((item) => (
                            <SelectItem key={item.id} value={item.id} className="data-[highlighted]:bg-sky-50 data-[highlighted]:text-[#0f3d72]">
                              {(item.product?.name || 'Item')} ({item.product?.sku || 'N/A'}) - Qty {followUpMode && targetFollowUpQuantities ? targetFollowUpQuantities.targetQty : Number(item.quantity || 0)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="spare-qty">Quantity to Replace</Label>
                      <Input id="spare-qty" type="text" inputMode="numeric" pattern="[0-9]*" value={spareQuantity} disabled />
                      <p className="text-xs text-emerald-700">Follow-up cases use the remaining quantity only, tied to the original damaged item.</p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label>Damaged Products</Label>
                    <div className="space-y-2 rounded-md border bg-white p-2">
                      {targetItems.length === 0 ? (
                        <p className="px-2 py-3 text-sm text-slate-500">No item details available</p>
                      ) : targetItems.map((item) => {
                        const line = spareReplacementLines.find((entry) => entry.orderItemId === item.id) || null
                        const checked = Boolean(line)
                        const maxQty = Math.max(Number(item.quantity || 0), 0)
                        const setLine = (patch: Partial<SpareReplacementLine>) => {
                          setSpareReplacementLines((previous) =>
                            previous.map((entry) => entry.orderItemId === item.id ? { ...entry, ...patch } : entry)
                          )
                        }
                        return (
                          <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-slate-300"
                                checked={checked}
                                onChange={(event) => {
                                  if (event.target.checked) {
                                    const initialQty = String(Math.min(Math.max(1, 0), maxQty))
                                    setSpareReplacementLines((previous) => [
                                      ...previous.filter((entry) => entry.orderItemId !== item.id),
                                      {
                                        orderItemId: item.id,
                                        quantityToReplace: initialQty,
                                        quantityReplaced: spareOutcome === 'RESOLVED' ? initialQty : '0',
                                      },
                                    ])
                                  } else {
                                    setSpareReplacementLines((previous) => previous.filter((entry) => entry.orderItemId !== item.id))
                                  }
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-900">{item.product?.name || 'Item'}</span>
                                <span className="block text-xs text-slate-500">
                                  Spare Products {Number(item.spareProducts?.recommendedQuantity || 0)} | Ordered Qty {maxQty}
                                </span>
                              </span>
                            </label>
                            {checked ? (
                              <div className={`mt-2 grid gap-2 ${spareOutcome === 'PARTIALLY_REPLACED' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                <div className="space-y-1">
                                  <Label className="text-xs">Quantity to Replace</Label>
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={line?.quantityToReplace || ''}
                                    onChange={(event) => {
                                      const raw = event.target.value.replace(/[^\d]/g, '')
                                      const parsed = Number(raw || 0)
                                      const nextValue = String(Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), maxQty))
                                      setLine({ quantityToReplace: nextValue, quantityReplaced: spareOutcome === 'RESOLVED' ? nextValue : line?.quantityReplaced || '0' })
                                    }}
                                    onBlur={() => {
                                      const parsed = Number(line?.quantityToReplace || 0)
                                      const clamped = String(Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), maxQty))
                                      setLine({ quantityToReplace: clamped, quantityReplaced: spareOutcome === 'RESOLVED' ? clamped : line?.quantityReplaced || '0' })
                                    }}
                                  />
                                </div>
                                {spareOutcome === 'PARTIALLY_REPLACED' ? (
                                  <div className="space-y-1">
                                    <Label className="text-xs">Quantity Replaced</Label>
                                    <Input
                                      type="text"
                                      inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={line?.quantityReplaced || ''}
                                    onChange={(event) => {
                                      const maxReplace = Number(line?.quantityToReplace || 0)
                                      const raw = event.target.value.replace(/[^\d]/g, '')
                                      const parsed = Number(raw || 0)
                                      const clamped = String(Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), maxReplace))
                                      setLine({ quantityReplaced: clamped })
                                    }}
                                      onBlur={() => {
                                        const maxReplace = Number(line?.quantityToReplace || 0)
                                        const parsed = Number(line?.quantityReplaced || 0)
                                        setLine({ quantityReplaced: String(Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), maxReplace)) })
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Resolution</Label>
                  {followUpMode ? (
                    <>
                      <Button type="button" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled>
                        Resolved
                      </Button>
                      <p className="text-xs text-emerald-700">
                        Follow-up cases can only be submitted as resolved with photo evidence.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={spareOutcome === 'RESOLVED' ? 'default' : 'outline'}
                          onClick={() => setSpareOutcome('RESOLVED')}
                          disabled={isSpareReplacing}
                        >
                          Resolved
                        </Button>
                        <Button
                          type="button"
                          variant={spareOutcome === 'PARTIALLY_REPLACED' ? 'default' : 'outline'}
                          onClick={() => {
                            setSpareOutcome('PARTIALLY_REPLACED')
                            if (followUpMode) {
                              setSparePartiallyReplacedQuantity(Math.max(Number(spareQuantity || 0), 0))
                            }
                          }}
                          disabled={isSpareReplacing}
                        >
                          Partially Replaced
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">
                        Resolved = replacement completed. Partially Replaced = needs warehouse follow-up.
                      </p>
                    </>
                  )}
                </div>
                <AnimatePresence mode="wait">
                  {spareOutcome === 'PARTIALLY_REPLACED' && followUpMode ? (
                    <motion.div
                      key="partial-qty-field"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      className="space-y-2 overflow-hidden"
                    >
                      <Label htmlFor="spare-partial-qty">How Many Were Replaced?</Label>
                      <Input
                        id="spare-partial-qty"
                        type="number"
                        min="1"
                        max={Number(spareQuantity || 0)}
                        value={sparePartiallyReplacedQuantity}
                        onChange={(e) => setSparePartiallyReplacedQuantity(Number(e.target.value || 0))}
                        disabled={isSpareReplacing}
                        placeholder="Enter quantity replaced"
                      />
                      <p className="text-xs text-slate-500">
                        Total damaged: {spareQuantity} | You are replacing: {sparePartiallyReplacedQuantity}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <div className="space-y-2">
                  <Label htmlFor="spare-reason">Damage Details</Label>
                  <Select value={spareDamageReason} onValueChange={setSpareDamageReason} disabled={isSpareReplacing}>
                    <SelectTrigger id="spare-reason" className="h-10 rounded-md border-sky-200 bg-white text-sm text-slate-900 shadow-sm focus:ring-emerald-500/30 focus:ring-offset-0">
                      <SelectValue placeholder="Select damage reason" />
                    </SelectTrigger>
                    <SelectContent className="border-sky-200 bg-white text-slate-900">
                      {SPARE_DAMAGE_REASON_OPTIONS.map((reason) => (
                        <SelectItem key={reason} value={reason} className="data-[highlighted]:bg-sky-50 data-[highlighted]:text-[#0f3d72]">
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {spareDamageReason === 'Others' ? (
                    <Textarea
                      id="spare-other-reason"
                      value={spareOtherDamageReason}
                      onChange={(event) => setSpareOtherDamageReason(event.target.value)}
                      placeholder="Type specific damage reason..."
                      disabled={isSpareReplacing}
                    />
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="spare-photo">Damage Photo</Label>
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-sky-200 text-[#0f3d72] hover:bg-sky-50 hover:text-[#0f3d72]"
                        onClick={openSpareCameraCapture}
                        disabled={isSpareReplacing || spareDamagePhotoFiles.length >= MAX_SPARE_DAMAGE_PHOTOS}
                      >
                        <Camera className="mr-2 h-4 w-4" />
                        Take Photo
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">
                      Camera evidence is required. Up to {MAX_SPARE_DAMAGE_PHOTOS} photos only.
                    </p>
                    {spareDamagePhotoFiles.length ? (
                      <div className="space-y-2">
                        <p className="text-xs text-emerald-700">Selected: {spareDamagePhotoFiles.length}/{MAX_SPARE_DAMAGE_PHOTOS}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {spareDamagePhotoPreviews.map((previewUrl, index) => (
                            <div key={`damage-preview-${index}`} className="space-y-1">
                              <img
                                src={previewUrl}
                                alt={`Damage photo preview ${index + 1}`}
                                className="h-24 w-full rounded border border-slate-200 object-cover"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => clearSpareDamagePhoto(index)}
                                disabled={isSpareReplacing}
                              >
                                Remove
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-sky-200 text-[#0f3d72] hover:bg-sky-50 hover:text-[#0f3d72]"
                            onClick={openSpareCameraCapture}
                            disabled={isSpareReplacing || spareDamagePhotoFiles.length >= MAX_SPARE_DAMAGE_PHOTOS}
                          >
                            Add Camera Photo
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-sky-200 text-[#0f3d72] hover:bg-sky-50 hover:text-[#0f3d72]"
                            onClick={() => clearSpareDamagePhoto()}
                            disabled={isSpareReplacing}
                          >
                            Clear All
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {missingRequirements.length > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Missing: {missingRequirements.join(', ')}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-sky-200 text-[#0f3d72] hover:bg-sky-50 hover:text-[#0f3d72]"
                    onClick={closeSpareReplacement}
                    disabled={isSpareReplacing}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => void submitSpareReplacement()}
                    disabled={!canSubmitSpareReplacement}
                  >
                    {isSpareReplacing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {followUpMode ? 'Submit Follow-up' : 'Submit Report'}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={isFailedDeliveryChoiceOpen} onOpenChange={(open) => { if (!open) closeFailedDeliveryChoice() }}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Failed Delivery</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Choose whether to reschedule this delivery or cancel it.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                className="h-11 rounded-xl bg-amber-600 font-semibold text-white shadow-[0_12px_24px_rgba(217,119,6,0.24)] hover:bg-amber-700"
                onClick={() => {
                  if (!failedDeliveryDropPointId) return
                  openFailedDeliveryActionWarning('reschedule')
                }}
                disabled={isUpdating}
              >
                Reschedule
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-11 rounded-xl font-semibold shadow-[0_12px_24px_rgba(220,38,38,0.22)]"
                onClick={async () => {
                  if (!failedDeliveryDropPointId) return
                  openFailedDeliveryActionWarning('cancel')
                }}
                disabled={isUpdating}
              >
                Cancel Delivery
              </Button>
            </div>
            <Button type="button" variant="outline" className="h-11 w-full rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50" onClick={closeFailedDeliveryChoice} disabled={isUpdating}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFailedDeliveryActionWarningOpen} onOpenChange={setIsFailedDeliveryActionWarningOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#fff8f0] via-white to-[#f7fbff] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.35rem] font-black tracking-[-0.02em] text-amber-700">Confirm Action</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                {failedDeliveryPendingAction === 'reschedule'
                  ? 'You are about to reschedule this failed delivery.'
                  : 'You are about to cancel this failed delivery.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {failedDeliveryPendingAction === 'reschedule'
                ? 'Proceed only if customer requested another delivery attempt.'
                : 'Proceed only if delivery must be cancelled and should not be attempted again.'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => {
                  setIsFailedDeliveryActionWarningOpen(false)
                  setFailedDeliveryPendingAction(null)
                }}
                disabled={isUpdating}
              >
                Back
              </Button>
              <Button
                type="button"
                className={`h-11 rounded-xl font-semibold text-white ${failedDeliveryPendingAction === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                onClick={async () => {
                  if (!failedDeliveryDropPointId || !failedDeliveryPendingAction) return
                  const action = failedDeliveryPendingAction
                  setIsFailedDeliveryActionWarningOpen(false)
                  setFailedDeliveryPendingAction(null)
                  closeFailedDeliveryChoice()
                  if (action === 'reschedule') {
                    openFailedDeliveryReschedule(failedDeliveryDropPointId)
                    return
                  }
                  await handleUpdateDropPoint(failedDeliveryDropPointId, 'CANCELLED', deliveryNote || 'Delivery canceled by driver')
                }}
                disabled={isUpdating || !failedDeliveryPendingAction}
              >
                {failedDeliveryPendingAction === 'cancel' ? 'Confirm Cancel' : 'Confirm Reschedule'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFailedDeliveryRescheduleOpen} onOpenChange={(open) => { if (!open) closeFailedDeliveryReschedule() }}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">When should the order be received again?</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Choose the next attempt window for this rescheduled delivery.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                variant={failedDeliveryReceiveAgain === 'today' ? 'default' : 'outline'}
                className={failedDeliveryReceiveAgain === 'today' ? 'h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]' : 'h-11 rounded-xl border border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50'}
                onClick={() => setFailedDeliveryReceiveAgain('today')}
                disabled={isUpdating}
              >
                Later today
              </Button>
              <Button
                type="button"
                variant={failedDeliveryReceiveAgain === 'tomorrow' ? 'default' : 'outline'}
                className={failedDeliveryReceiveAgain === 'tomorrow' ? 'h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]' : 'h-11 rounded-xl border border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50'}
                onClick={() => setFailedDeliveryReceiveAgain('tomorrow')}
                disabled={isUpdating}
              >
                Tomorrow
              </Button>
              <Button
                type="button"
                variant={failedDeliveryReceiveAgain === 'other_date' ? 'default' : 'outline'}
                className={failedDeliveryReceiveAgain === 'other_date' ? 'h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]' : 'h-11 rounded-xl border border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50'}
                onClick={() => setFailedDeliveryReceiveAgain('other_date')}
                disabled={isUpdating}
              >
                Other date
              </Button>
            </div>
            {failedDeliveryReceiveAgain === 'other_date' ? (
              <div className="rounded-xl border border-sky-200/80 bg-white/80 px-3 py-3">
                <Label htmlFor="failed-delivery-other-date" className="text-xs font-semibold text-[#17365d]">
                  Select delivery date
                </Label>
                <Input
                  id="failed-delivery-other-date"
                  type="date"
                  className="mt-2"
                  value={failedDeliveryOtherDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setFailedDeliveryOtherDate(event.target.value)}
                  disabled={isUpdating}
                />
                <p className="mt-2 text-xs text-sky-800">
                  This order will be removed from this trip and returned to route planning.
                </p>
              </div>
            ) : null}
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Inventory will stay reserved for this rescheduled delivery.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#0f3d72] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50 hover:text-[#0f3d72]"
                onClick={closeFailedDeliveryReschedule}
                disabled={isUpdating}
              >
                Back
              </Button>
              <Button
                type="button"
                className="h-11 rounded-xl bg-amber-600 font-semibold text-white shadow-[0_12px_24px_rgba(217,119,6,0.24)] hover:bg-amber-700"
                onClick={async () => {
                  if (!failedDeliveryRescheduleDropPointId) return
                  if (failedDeliveryReceiveAgain === 'other_date' && !failedDeliveryOtherDate) {
                    toast.error('Select a date for reschedule')
                    return
                  }
                  const selectedOtherDateIso = failedDeliveryReceiveAgain === 'other_date'
                    ? new Date(`${failedDeliveryOtherDate}T09:00:00`).toISOString()
                    : undefined
                  const label =
                    failedDeliveryReceiveAgain === 'tomorrow'
                      ? 'tomorrow'
                      : failedDeliveryReceiveAgain === 'other_date'
                        ? `other date (${failedDeliveryOtherDate})`
                        : 'later today'
                  closeFailedDeliveryReschedule()
                  await handleUpdateDropPoint(
                    failedDeliveryRescheduleDropPointId,
                    'FAILED',
                    `${deliveryNote || 'Delivery failed'} - reschedule requested (${label})`,
                    undefined,
                    {
                      releaseInventory: false,
                      rescheduleRequested: true,
                      rescheduleWindow: failedDeliveryReceiveAgain,
                      rescheduleDate:
                        failedDeliveryReceiveAgain === 'other_date'
                          ? selectedOtherDateIso
                          : (() => {
                              const scheduled = new Date()
                              if (failedDeliveryReceiveAgain === 'tomorrow') {
                                scheduled.setDate(scheduled.getDate() + 1)
                              }
                              return scheduled.toISOString()
                            })(),
                    }
                  )
                }}
                disabled={isUpdating}
              >
                Confirm Reschedule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// History View

// Profile View
