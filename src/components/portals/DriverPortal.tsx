'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Poppins } from 'next/font/google'
import dynamic from 'next/dynamic'
import { useAuth } from '@/app/page'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHandle, DrawerTitle } from '@/components/ui/drawer'
import { prepareImageForUpload } from '@/lib/client-image'
import { toast } from 'sonner'
import { 
  Truck, 
  Package, 
  Home,
  User, 
  LogOut, 
  Menu,
  Phone,
  Navigation,
  CheckCircle,
  Clock,
  AlertCircle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Flag,
  MessageSquare,
  Loader2,
  Route,
  CalendarClock,
  LocateFixed,
  Trophy,
  RotateCcw
} from 'lucide-react'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const NEGROS_OCCIDENTAL_CENTER: [number, number] = [10.6765, 122.9511]
const NEGROS_OCCIDENTAL_BOUNDS = {
  south: 9.18,
  west: 122.22,
  north: 11.05,
  east: 123.35,
}

const isSecureWebContext = typeof window !== 'undefined' ? window.isSecureContext : true

interface Trip {
  id: string
  tripNumber: string
  status: string
  warehouseId?: string | null
  warehouseLatitude?: number | null
  warehouseLongitude?: number | null
  startLatitude?: number | null
  startLongitude?: number | null
  warehouse?: {
    id?: string
    name?: string
    latitude?: number | null
    longitude?: number | null
  } | null
  plannedStartAt: string | null
  actualStartAt?: string | null
  actualEndAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  totalDropPoints: number
  completedDropPoints: number
  latestLocation?: {
    latitude?: number | null
    longitude?: number | null
    recordedAt?: string | null
  } | null
  driver?: {
    name?: string
    user?: {
      name?: string
    }
  }
  vehicle: {
    licensePlate: string
    type: string
  }
  dropPoints: DropPoint[]
}

interface DropPoint {
  id: string
  sequence: number
  status: string
  locationName: string
  address: string
  city: string
  latitude?: number | null
  longitude?: number | null
  contactName: string | null
  contactPhone: string | null
  deliveryPhoto?: string | null
  order: {
    id?: string
    orderNumber: string
    totalAmount?: number | null
    items?: Array<{
      id: string
      productId: string
      quantity: number
      product?: {
        sku?: string | null
        name?: string | null
      } | null
    }>
    returns?: Array<{
      id: string
      status: string
      replacementQuantity?: number | null
      remainingQuantity?: number | null
      originalOrderItemId?: string | null
      dropPointId?: string | null
      replacementMode?: string | null
      damagePhotoUrl?: string | null
      notes?: string | null
      processedAt?: string | null
      isClosed?: boolean
    }>
  } | null
}

type NativeCameraCheckResult = {
  granted: boolean
  reason?: string
}

type LocationPermissionState = 'granted' | 'denied' | 'prompt'

const isNativeCapacitorApp = () => {
  if (typeof window === 'undefined') return false
  const cap = (window as any).Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform())
  }
  return String(cap?.getPlatform?.() || '').toLowerCase() !== 'web'
}

const checkNativeCameraPermission = async (): Promise<NativeCameraCheckResult> => {
  if (typeof window === 'undefined' || !isNativeCapacitorApp()) {
    return { granted: true }
  }

  try {
    const cameraModule = await import('@capacitor/camera')
    let result = await cameraModule.Camera.checkPermissions()
    const current = String((result as any)?.camera || (result as any)?.photos || '')
    if (current !== 'granted') {
      result = await cameraModule.Camera.requestPermissions({ permissions: ['camera'] })
    }
    const finalState = String((result as any)?.camera || (result as any)?.photos || '')
    if (finalState === 'granted') {
      return { granted: true }
    }
    return { granted: false, reason: 'Camera permission is blocked. Enable it in app settings.' }
  } catch {
    return { granted: false, reason: 'Unable to verify camera permission. Please allow it in app settings.' }
  }
}

const openNativeAppSettings = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !isNativeCapacitorApp()) {
    return false
  }

    try {
      const appModule = await import('@capacitor/app')
      const appAny = appModule.App as any
      if (typeof appAny?.openAppSettings === 'function') {
        await appAny.openAppSettings()
        return true
      }
    } catch {
      // Fall back to platform-specific best effort below.
    }

  try {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android')) {
      window.location.href = 'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;end'
      return true
    }

    window.location.href = 'app-settings:'
    return true
  } catch {
    return false
  }
}

export function DriverPortal() {
  const { user, logout } = useAuth()
  const [activeView, setActiveView] = useState('home')
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState>('prompt')
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [isNativeCameraGateOpen, setIsNativeCameraGateOpen] = useState(false)
  const [nativeCameraGateMessage, setNativeCameraGateMessage] = useState('Camera permission is required to use AnnDrive.')
  const [isCheckingNativeCameraPermission, setIsCheckingNativeCameraPermission] = useState(false)
  const watchIdRef = useRef<number | null>(null)
  const isFetchingTripsRef = useRef(false)

  const fetchTrips = useCallback(async (silent = false): Promise<Trip[]> => {
    if (isFetchingTripsRef.current) return trips
    isFetchingTripsRef.current = true
    try {
      const response = await fetch('/api/driver/trips', { cache: 'no-store', credentials: 'include' })
      const raw = await response.text()
      let data: any = {}
      if (raw) {
        try {
          data = JSON.parse(raw)
        } catch {
          data = {}
        }
      }

      if (!response.ok || data?.success === false) {
        const rawMessage = typeof data?.error === 'string' ? data.error : ''
        const fallbackMessage =
          response.status >= 500
            ? `Server error (${response.status}).`
            : `Request failed (${response.status}).`
        const detail = !rawMessage && raw ? ` ${raw.slice(0, 180)}` : ''
        throw new Error((rawMessage || fallbackMessage) + detail)
      }

      const nextTrips = Array.isArray(data.trips) ? data.trips : []
      setTrips(nextTrips)
      return nextTrips
    } catch (error: any) {
      if (!silent) {
        toast.error(error?.message || 'Failed to load assigned trips')
      }
      console.warn('Failed to fetch trips:', error)
      return trips
    } finally {
      isFetchingTripsRef.current = false
      setIsLoading(false)
    }
  }, [trips])

  // Fetch trips
  useEffect(() => {
    void fetchTrips()

    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.includes('orders') || message.scopes.includes('trips') || message.scopes.includes('returns')) {
        void fetchTrips(true)
      }
    })

    const onFocus = () => {
      void fetchTrips(true)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchTrips(true)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchTrips(true)
      }
    }, 5000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [fetchTrips])


  const enforceNativeCameraPermission = useCallback(async () => {
    if (!isNativeCapacitorApp()) {
      setIsNativeCameraGateOpen(false)
      return true
    }
    setIsCheckingNativeCameraPermission(true)
    const permission = await checkNativeCameraPermission()
    if (permission.granted) {
      setIsNativeCameraGateOpen(false)
      setIsCheckingNativeCameraPermission(false)
      return true
    }
    setNativeCameraGateMessage(permission.reason || 'Camera permission is required to use AnnDrive.')
    setIsNativeCameraGateOpen(true)
    setIsCheckingNativeCameraPermission(false)
    return false
  }, [])

  useEffect(() => {
    void enforceNativeCameraPermission()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void enforceNativeCameraPermission()
      }
    }
    const onFocus = () => {
      void enforceNativeCameraPermission()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [enforceNativeCameraPermission])

  // Check location permission
  useEffect(() => {
    if (!('permissions' in navigator) || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        setLocationPermission(result.state as LocationPermissionState)
      })
      .catch(() => {
        setLocationPermission('prompt')
      })
  }, [])

  const readCurrentPosition = (options?: PositionOptions) =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options)
    })

  const sendLocationUpdate = async (lat: number, lng: number, tripId?: string | null) => {
    try {
      await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          tripId: tripId || null,
        }),
      })
    } catch {
      // ignore location sync failures to avoid disrupting driving flow
    }
  }

  const getActiveTripId = () => {
    if (selectedTripId) {
      const t = trips.find((trip) => trip.id === selectedTripId)
      if (t?.status === 'IN_PROGRESS') return t.id
    }
    const inProgress = trips.find((trip) => trip.status === 'IN_PROGRESS')
    return inProgress?.id || null
  }

  const openLocationSettings = async () => {
    try {
      if (await openNativeAppSettings()) {
        return
      }
      const ua = navigator.userAgent.toLowerCase()
      if (ua.includes('android')) {
        window.location.href = 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end'
        return
      }
      if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
        window.location.href = 'app-settings:'
        return
      }
      window.open('about:preferences#privacy', '_blank')
    } catch {
      // best effort only
    }
  }

  // Start location tracking
  const startLocationTracking = async (): Promise<boolean> => {
    if (!isSecureWebContext && !isNativeCapacitorApp()) {
      toast.error('Location requires HTTPS on browser. Open this app over HTTPS or use the native app.')
      return false
    }

    if (!navigator.geolocation) {
      toast.error('Location is not supported on this device/browser')
      return false
    }

    if (watchIdRef.current !== null) {
      setIsTracking(true)
      return true
    }

    try {
      const position = await readCurrentPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 })
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      setCurrentLocation({ lat, lng })
      setLocationPermission('granted')
      setIsTracking(true)
      void sendLocationUpdate(lat, lng, getActiveTripId())
    } catch {
      setLocationPermission('denied')
      setIsTracking(false)
      toast.error('Location is required to start trip. Please enable location access in settings.')
      void openLocationSettings()
      return false
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setCurrentLocation({ lat, lng })
        setLocationPermission('granted')
        setIsTracking(true)
        sendLocationUpdate(lat, lng, getActiveTripId())
      },
      () => {
        setLocationPermission('denied')
        setIsTracking(false)
        toast.error('Location permission denied. Please enable location access.')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    )

    watchIdRef.current = watchId
    toast.success('Location tracking started')
    return true
  }

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
  }

  const statusColors: Record<string, string> = {
    PLANNED: 'bg-sky-100 text-sky-800 border-sky-200',
    IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    COMPLETED: 'bg-teal-100 text-teal-800 border-teal-200',
    CANCELLED: 'bg-rose-100 text-rose-800 border-rose-200',
    PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
    ARRIVED: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  }

  return (
    <div className={`${poppins.className} min-h-[100dvh] bg-[#dff0ea] md:bg-[#dceff0]`}>
      <div className="relative w-full h-[100dvh] flex flex-col overflow-hidden bg-transparent">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-20 h-56 w-56 rounded-full bg-sky-200/45 blur-3xl" />
        <div className="absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-emerald-200/45 blur-3xl" />
      </div>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-20 h-56 w-56 rounded-full bg-sky-200/45 blur-3xl" />
        <div className="absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-emerald-200/45 blur-3xl" />
      </div>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-sky-200/70 bg-[#edf5fb]/95 text-[#0f3d72] shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-md">
        <div className="px-4 pb-3 pt-[max(env(safe-area-inset-top),0.65rem)] md:py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl border border-white/90 bg-white shadow-[0_6px_14px_rgba(15,23,42,0.14)]">
                <img src="/anndrive.png" alt="AnnDrive" className="h-full w-full object-cover" />
              </div>
              <div className="leading-tight">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-700">Ann Ann's Beveraes Trading</p>
                <h1 className="text-[18px] font-black tracking-[-0.01em] text-[#0f3d72]">Ann<span className="text-[#2f9a34]">Drive</span></h1>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full border border-blue-200/70 bg-[#0e5aa8] text-white shadow-sm shadow-blue-900/30 hover:bg-[#0d4f92]">
                  <User className="h-4.5 w-4.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setActiveView('home')}>
                  <Home className="mr-2 h-4 w-4" />
                  Home
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setActiveView('trips'); setSelectedTripId(null) }}>
                  <Truck className="mr-2 h-4 w-4" />
                  Trips
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveView('profile')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[1.1rem] font-semibold tracking-tight text-[#0a1b36]">DELIVERY APP</p>
            {isTracking ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-100 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                LIVE TRACKING
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Scrollable Content Area */}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-x-hidden ${activeView === 'trips' && selectedTripId ? 'overflow-y-hidden' : 'overflow-y-auto'}`}
      >
      {/* Main Content */}
      <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={`${activeView}-${selectedTripId || 'none'}`}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className={`min-h-0 w-full px-4 md:px-6 ${(activeView === 'home' || activeView === 'profile') ? 'pb-[calc(env(safe-area-inset-bottom)+8.5rem)] md:pb-8' : 'pb-24 md:pb-8'} ${activeView === 'trips' ? 'pt-0 md:pt-0' : 'pt-4 md:pt-6'} ${activeView === 'trips' && selectedTripId ? 'flex flex-1 flex-col overflow-hidden' : 'flex-1'}`}
      >
        {activeView === 'home' && (
          <HomeView
            user={user}
            trips={trips}
            isLoading={isLoading}
            isTracking={isTracking}
            locationPermission={locationPermission}
            currentLocation={currentLocation}
            onOpenTrips={() => { setActiveView('trips'); setSelectedTripId(null) }}
            onOpenActiveTrip={(trip) => { setActiveView('trips'); setSelectedTripId(trip.id) }}
            onStartTracking={startLocationTracking}
          />
        )}

        {activeView === 'trips' && !selectedTripId && (
          <TripsListView
            trips={trips}
            isLoading={isLoading}
            onSelectTrip={(trip) => setSelectedTripId(trip.id)}
          />
        )}

        {activeView === 'trips' && selectedTripId && (() => {
          const selectedTrip = trips.find((t) => t.id === selectedTripId) ?? null
          if (!selectedTrip) return null
          return (
            <TripDetailView
              trip={selectedTrip}
              onBack={() => setSelectedTripId(null)}
              locationPermission={locationPermission}
              onStartTracking={startLocationTracking}
              onRefreshTrips={() => fetchTrips(true)}
              isTracking={isTracking}
              currentLocation={currentLocation}
            />
          )
        })()}

        {activeView === 'history' && (
          <HistoryView
            trips={trips}
            isLoading={isLoading}
            onOpenTrip={(trip) => {
              setActiveView('trips')
              setSelectedTripId(trip.id)
            }}
          />
        )}

        {activeView === 'profile' && <ProfileView user={user} />}
      </motion.main>
      </AnimatePresence>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-2 left-2 right-2 rounded-3xl border border-white/80 bg-[#eff7fb]/85 backdrop-blur-xl shadow-[0_14px_30px_rgba(15,23,42,0.14)] md:relative md:bottom-auto md:left-auto md:right-auto md:w-full md:rounded-none md:border md:border-t md:border-sky-200/60 md:shadow-[0_-2px_8px_rgba(15,23,42,0.06)]">
        <div className="flex justify-around py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:pb-2">
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'home' ? 'bg-emerald-100/90 text-emerald-700 shadow-sm shadow-emerald-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={() => { setActiveView('home'); setSelectedTripId(null) }}
          >
            <Home className="h-5 w-5" />
            <span className="text-xs font-medium">Home</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'trips' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={() => { setActiveView('trips'); setSelectedTripId(null); }}
          >
            <Truck className="h-5 w-5" />
            <span className="text-xs font-medium">Trips</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'history' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={() => setActiveView('history')}
          >
            <Clock className="h-5 w-5" />
            <span className="text-xs font-medium">History</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'profile' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={() => setActiveView('profile')}
          >
            <User className="h-5 w-5" />
            <span className="text-xs font-medium">Profile</span>
          </Button>
        </div>
      </nav>

      <Dialog open={isNativeCameraGateOpen} onOpenChange={() => {}}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Camera Access Required</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                This app requires camera permission before driver operations.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <p className="text-sm text-red-600">{nativeCameraGateMessage}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={async () => {
                  const opened = await openNativeAppSettings()
                  if (!opened) {
                    toast.error('Could not open app settings automatically. Open app settings manually and allow Camera.')
                  }
                }}
              >
                Open App Settings
              </Button>
              <Button
                className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={() => {
                  void enforceNativeCameraPermission()
                }}
                disabled={isCheckingNativeCameraPermission}
              >
                {isCheckingNativeCameraPermission ? 'Checking...' : 'I Enabled It'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}

function HomeView({
  user,
  trips,
  isLoading,
  isTracking,
  locationPermission,
  currentLocation,
  onOpenTrips,
  onOpenActiveTrip,
  onStartTracking,
}: {
  user: any
  trips: Trip[]
  isLoading: boolean
  isTracking: boolean
  locationPermission: 'granted' | 'denied' | 'prompt'
  currentLocation: { lat: number; lng: number } | null
  onOpenTrips: () => void
  onOpenActiveTrip: (trip: Trip) => void
  onStartTracking: () => Promise<boolean>
}) {
  const isCompletedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'COMPLETED'
  const isInProgressTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'IN_PROGRESS'
  const isPlannedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'PLANNED'

  const activeTrip = trips.find((trip) => isInProgressTrip(trip.status)) || null
  const plannedTrips = trips.filter((trip) => isPlannedTrip(trip.status)).length
  const completedTrips = trips.filter((trip) => isCompletedTrip(trip.status)).length
  const terminalStopStatuses = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])
  const pendingStops = activeTrip
    ? (activeTrip.dropPoints || []).filter((point) => !terminalStopStatuses.has(String(point.status || '').toUpperCase())).length
    : 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-[1.6rem] border border-white/70 bg-[#cde4f3]/85 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] shadow-[0_16px_30px_rgba(14,116,144,0.16)] backdrop-blur-xl md:p-5 md:pb-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f3558]">DRIVER DASHBOARD</p>
        <h2 className="mt-1 text-[2rem] font-black leading-tight tracking-[-0.02em] text-[#0a1435]">Welcome, Demo Driver</h2>
        <p className="text-[1.12rem] leading-relaxed text-[#223c5d]">Here is your delivery overview for today.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#1f4d79]">Total Trips</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{trips.length}</p>
              </div>
              <Route className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#1f4d79]">Planned</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{plannedTrips}</p>
              </div>
              <CalendarClock className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#1f4d79]">Completed</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{completedTrips}</p>
              </div>
              <Trophy className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium leading-tight text-[#1f4d79]">Pending Stops</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{pendingStops}</p>
              </div>
              <RotateCcw className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[1.7rem] font-semibold tracking-[-0.01em] leading-tight">
            <span className="text-[#0f4f8f]">Current</span>{' '}
            <span className="text-[#2f9a34]">Assignment</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeTrip ? (
            <div className="space-y-2">
              <p className="font-semibold tracking-tight text-[#0e2442]">{activeTrip.tripNumber}</p>
              <p className="text-sm leading-relaxed text-[#1f3558]">
                {activeTrip.completedDropPoints}/{activeTrip.totalDropPoints} stops completed
              </p>
              <Button className="h-10 w-full rounded-xl bg-[#0d61ad] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(2,132,199,0.22)] hover:bg-[#0b579c]" onClick={() => onOpenActiveTrip(activeTrip)}>
                Open Active Trip
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[1.05rem] text-[#1f3558]">No active trip right now.</p>
              <Button className="h-10 w-full rounded-xl bg-[#0d61ad] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(2,132,199,0.22)] hover:bg-[#0b579c]" onClick={onOpenTrips}>
                View My Trips
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Trips List View
function TripsListView({
  trips,
  isLoading,
  onSelectTrip,
}: {
  trips: Trip[]
  isLoading: boolean
  onSelectTrip: (trip: Trip) => void
}) {
  const statusColors: Record<string, string> = {
    PLANNED: 'bg-sky-100 text-sky-800 border border-sky-200',
    IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    COMPLETED: 'bg-teal-100 text-teal-800 border border-teal-200',
    CANCELLED: 'bg-rose-100 text-rose-800 border border-rose-200',
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Assigned Routes</p>
      <h2 className="mb-4 mt-0 text-xl font-black tracking-[-0.01em] text-slate-900">My Deliveries</h2>

      {trips.length === 0 ? (
        <Card className="rounded-2xl border border-sky-100 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
          <CardContent className="py-12 text-center">
            <Truck className="mx-auto mb-4 h-12 w-12 text-sky-300" />
            <p className="font-semibold text-slate-700">No assigned trips</p>
            <p className="mt-1 text-sm text-slate-500">New deliveries will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => (
            <Card key={trip.id} className="cursor-pointer rounded-2xl border border-sky-100 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(2,132,199,0.14)]" onClick={() => onSelectTrip(trip)}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-bold tracking-tight text-slate-900">{trip.tripNumber}</p>
                      <Badge className={`${statusColors[trip.status] || 'bg-gray-100'} text-xs px-2 py-0.5`}>
                        {trip.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-[13px] leading-relaxed text-slate-700">Vehicle: {trip.vehicle?.licensePlate} • Driver: {trip.driver?.user?.name || trip.driver?.name || 'Assigned Driver'}</p>
                    <p className="text-[13px] leading-relaxed text-slate-600">Route: Warehouse {'->'} {trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-8 px-3 text-xs font-medium border-sky-200 text-sky-700 hover:bg-sky-50"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectTrip(trip)
                    }}
                  >
                    View Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// Trip Detail View
function TripDetailView({
  trip,
  onBack,
  locationPermission,
  onStartTracking,
  onRefreshTrips,
  isTracking,
  currentLocation,
}: {
  trip: Trip
  onBack: () => void
  locationPermission: 'granted' | 'denied' | 'prompt'
  onStartTracking: () => Promise<boolean>
  onRefreshTrips: () => Promise<Trip[]>
  isTracking: boolean
  currentLocation: { lat: number; lng: number } | null
}) {
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
  const [isSpareReplaceOpen, setIsSpareReplaceOpen] = useState(false)
  const [spareTargetDropPointId, setSpareTargetDropPointId] = useState<string | null>(null)
  const [spareOrderItemId, setSpareOrderItemId] = useState('')
  const [spareQuantity, setSpareQuantity] = useState(1)
  const [spareOutcome, setSpareOutcome] = useState<'RESOLVED' | 'PARTIALLY_REPLACED'>('RESOLVED')
  const [sparePartiallyReplacedQuantity, setSparePartiallyReplacedQuantity] = useState(0)
  const [spareFollowUpReturnId, setSpareFollowUpReturnId] = useState<string | null>(null)
  const [spareReason, setSpareReason] = useState('')
  const [spareDamagePhotoFiles, setSpareDamagePhotoFiles] = useState<File[]>([])
  const [spareDamagePhotoPreviews, setSpareDamagePhotoPreviews] = useState<string[]>([])
  const [isSpareReplacing, setIsSpareReplacing] = useState(false)
  const [isFailedDeliveryChoiceOpen, setIsFailedDeliveryChoiceOpen] = useState(false)
  const [failedDeliveryDropPointId, setFailedDeliveryDropPointId] = useState<string | null>(null)
  const [isFailedDeliveryRescheduleOpen, setIsFailedDeliveryRescheduleOpen] = useState(false)
  const [failedDeliveryRescheduleDropPointId, setFailedDeliveryRescheduleDropPointId] = useState<string | null>(null)
  const [failedDeliveryReceiveAgain, setFailedDeliveryReceiveAgain] = useState<'today' | 'tomorrow' | 'other_date'>('today')
  const [failedDeliveryOtherDate, setFailedDeliveryOtherDate] = useState('')
  const [mobileSheetSnapPoint, setMobileSheetSnapPoint] = useState<number | string | null>(0.52)
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  const [showMobileSheetPeek, setShowMobileSheetPeek] = useState(true)
  const [mobileMapRecenterSignal, setMobileMapRecenterSignal] = useState(0)
  const [mobileMapRecenterCenter, setMobileMapRecenterCenter] = useState<[number, number] | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [roadRoutePoints, setRoadRoutePoints] = useState<[number, number][]>([])
  const [previewDriverLocation, setPreviewDriverLocation] = useState<{ lat: number; lng: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const mobileSheetTouchStartYRef = useRef<number | null>(null)
  const mobileSheetPeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cameraCaptureTarget, setCameraCaptureTarget] = useState<'pod' | 'spare'>('pod')
  const MAX_SPARE_DAMAGE_PHOTOS = 2
  const sortedDropPoints = [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence)
  const terminalDropPointStatuses = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])
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

  useEffect(() => {
    return () => {
      if (mobileSheetPeekTimeoutRef.current) {
        clearTimeout(mobileSheetPeekTimeoutRef.current)
      }
    }
  }, [])

  const openMobileSheet = () => {
    if (mobileSheetPeekTimeoutRef.current) {
      clearTimeout(mobileSheetPeekTimeoutRef.current)
      mobileSheetPeekTimeoutRef.current = null
    }
    setShowMobileSheetPeek(false)
    setIsMobileSheetOpen(true)
  }

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
  }

  const getDropPointReplacementItems = (dropPoint: DropPoint | null) => {
    if (!dropPoint?.order) return []
    return dropPoint.order.items || []
  }

  const getDropPointOpenReplacement = (dropPoint: DropPoint | null) => {
    const returns = dropPoint?.order?.returns || []
    return returns.find((entry) => !entry.isClosed) || null
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
    const replacedQuantity = Number(openReplacement.replacementQuantity || 0)
    return {
      openReplacement,
      replacedQuantity,
      remainingQuantity: Math.max(orderedQuantity - replacedQuantity, 0),
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2,
    }).format(amount)
  const ETA_SPEED_KMH = 28
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

  const handleStartTrip = async () => {
    const refreshedTrips = await onRefreshTrips()
    const latestTrip = refreshedTrips.find((entry) => entry.id === trip.id) || trip
    const currentStatus = String(latestTrip.status || '').toUpperCase()
    if (currentStatus !== 'PLANNED') {
      toast.error(`Trip cannot be started because status is ${currentStatus.replace(/_/g, ' ')}`)
      await onRefreshTrips()
      return
    }

    const notLoadedOrders = (latestTrip.dropPoints || [])
      .filter((point) => point.order)
      .filter((point) => !['LOADED', 'DISPATCHED'].includes(String((point.order as any)?.warehouseStage || '').toUpperCase()))
      .map((point) => String(point.order?.orderNumber || point.order?.id || 'Unknown order'))

    if (notLoadedOrders.length > 0) {
      toast.error(`Trip cannot start. Orders not loaded: ${notLoadedOrders.slice(0, 3).join(', ')}`)
      await onRefreshTrips()
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
        toast.success(payload?.message || 'Trip started')
        await onRefreshTrips()
      } else {
        toast.error(payload?.error || 'Failed to start trip')
        await onRefreshTrips()
      }
    } catch (error) {
      toast.error('An error occurred')
    } finally {
      setIsUpdating(false)
    }
  }

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
        if (deferredLaterToday) {
          toast.success('Order moved to the end of this route for later today')
        } else {
          toast.success(`Drop point marked as ${actualStatus.toLowerCase()}`)
        }
        emitDataSync(['orders', 'trips'])
        await onRefreshTrips()
      } else {
        toast.error(payload?.error || 'Failed to update drop point')
        await onRefreshTrips()
      }
    } catch (error) {
      toast.error('An error occurred')
      await onRefreshTrips()
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
      toast('Storage is not configured on this deployment. Damage photo will be saved inline for this report.')
      return toDataUrl(preparedFile)
    }
    throw new Error(errorMessage)
  }

  const handlePodFileChange = (file: File | null) => {
    setPodImageFile(file)
    setPodImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return file ? URL.createObjectURL(file) : null
    })
  }

  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

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
          handleCameraPermissionDenied(error?.message || 'Unable to access camera on this device.')
        }
      })()
      return
    }

    setCameraCaptureTarget(target)
    setCapturedCameraPhoto(null)
    setCameraError(null)
    setCameraPermissionHint('')
    setIsCameraOpen(true)
  }

  const openSpareReplacement = (dropPoint: DropPoint) => {
    const items = getDropPointReplacementItems(dropPoint)
    const openReplacement = getDropPointOpenReplacement(dropPoint)
    const selectedItemId = openReplacement?.originalOrderItemId || items[0]?.id || ''
    const selectedItem = items.find((item) => item.id === selectedItemId) || null
    const remainingQuantity = openReplacement
      ? Math.max(Number(selectedItem?.quantity || 0) - Number(openReplacement.replacementQuantity || 0), 0)
      : items.length
        ? 1
        : 0
    setSpareTargetDropPointId(dropPoint.id)
    setSpareOrderItemId(selectedItemId)
    setSpareQuantity(openReplacement ? remainingQuantity : items.length ? 1 : 0)
    setSpareOutcome('RESOLVED')
    setSpareFollowUpReturnId(openReplacement?.id || null)
    setSpareReason('')
    setSpareDamagePhotoFiles([])
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return []
    })
    setIsSpareReplaceOpen(true)
  }

  const openFailedDeliveryChoice = (dropPointId: string) => {
    setFailedDeliveryDropPointId(dropPointId)
    setIsFailedDeliveryChoiceOpen(true)
  }

  const closeFailedDeliveryChoice = () => {
    setIsFailedDeliveryChoiceOpen(false)
    setFailedDeliveryDropPointId(null)
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

  const closeSpareReplacement = () => {
    setIsSpareReplaceOpen(false)
    setSpareTargetDropPointId(null)
    setSpareOrderItemId('')
    setSpareQuantity(1)
    setSpareOutcome('RESOLVED')
    setSparePartiallyReplacedQuantity(0)
    setSpareFollowUpReturnId(null)
    setSpareReason('')
    setSpareDamagePhotoFiles([])
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return []
    })
    setIsSpareReplacing(false)
  }

  const openSpareCameraCapture = () => {
    openCameraCapture('spare')
  }

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
    if (spareOutcome === 'RESOLVED' && !selectedItem) {
      toast.error('Select an item to replace')
      return
    }
    if (!Number.isFinite(spareQuantity) || spareQuantity < 0 || !Number.isInteger(spareQuantity)) {
      toast.error('Quantity must be a whole number (0 or higher)')
      return
    }
    if (spareOutcome === 'RESOLVED' && spareQuantity <= 0) {
      toast.error('Resolved outcome requires replacement quantity greater than zero')
      return
    }
    if (spareOutcome === 'PARTIALLY_REPLACED' && sparePartiallyReplacedQuantity <= 0) {
      toast.error('Partially Replaced requires specifying how many items were replaced')
      return
    }
    if (spareOutcome === 'PARTIALLY_REPLACED' && sparePartiallyReplacedQuantity > spareQuantity) {
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
    if (spareFollowUpReturnId && selectedItem) {
      const remainingQty = Number(openReplacement?.remainingQuantity ?? Math.max(Number(selectedItem.quantity || 0) - Number(openReplacement?.replacementQuantity || 0), 0))
      if (spareQuantity !== remainingQty) {
        toast.error(`Follow-up replacement must use the remaining quantity of ${remainingQty}`)
        return
      }
    }
    if (selectedItem && spareQuantity > Number(selectedItem.quantity || 0)) {
      toast.error('Replacement quantity exceeds ordered quantity')
      return
    }
    if (!spareReason.trim()) {
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
      const damagePhotos = await Promise.all(spareDamagePhotoFiles.map((photo) => uploadPodImage(photo)))
      const response = await fetch('/api/driver/replacements/from-spare-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          productId: selectedItem?.productId,
          tripId: trip.id,
          dropPointId: targetDropPoint.id,
          orderItemId: selectedItem?.id || '',
          followUpReturnId: spareFollowUpReturnId || undefined,
          quantity: spareQuantity,
          outcome: spareOutcome,
          partiallyReplacedQuantity: spareOutcome === 'PARTIALLY_REPLACED' ? sparePartiallyReplacedQuantity : undefined,
          reason: spareReason.trim(),
          damagePhoto: damagePhotos[0],
          damagePhotos,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to process on-delivery replacement')
      }
      toast.success(
        spareOutcome === 'RESOLVED'
          ? `Damage reported and resolved on delivery. Remaining spare stock: ${Number(payload?.remainingSpareStock ?? 0)}`
          : `Damage reported as partially replaced. Follow-up required. Remaining spare stock: ${Number(payload?.remainingSpareStock ?? 0)}`
      )
      setSparePartiallyReplacedQuantity(0)
      closeSpareReplacement()
      await onRefreshTrips()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to process on-delivery replacement')
    } finally {
      setIsSpareReplacing(false)
    }
  }

  const closeCameraCapture = () => {
    stopCameraStream()
    setIsCameraOpen(false)
    setIsCameraLoading(false)
  }

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

  const handleCameraPermissionDenied = (message?: string) => {
    closeCameraCapture()
    setCameraError(message || 'Camera access is required for POD. Please allow camera permission.')
    setCameraPermissionHint(message || '')
    setIsCameraPermissionDialogOpen(true)
    toast.error('Camera permission is required to complete delivery')
  }

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
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
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
    const sorted = [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence)
    const nextActionable =
      sorted.find((point) => ['PENDING', 'IN_TRANSIT', 'ARRIVED'].includes(String(point.status || '').toUpperCase())) ||
      sorted[0] ||
      null
    setActiveDropPoint(nextActionable)
  }, [trip.id, trip.dropPoints])

  useEffect(() => {
    if (currentLocation?.lat && currentLocation?.lng) {
      setPreviewDriverLocation({ lat: currentLocation.lat, lng: currentLocation.lng })
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
          setPreviewDriverLocation({ lat, lng })
        }
      },
      () => {
        // Best effort only for map preview marker.
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    )

    return () => {
      cancelled = true
    }
  }, [trip.id, currentLocation?.lat, currentLocation?.lng])

  const cameraPermissionSteps = getCameraPermissionSteps()
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
  const isDropPointDone = (status: unknown) => {
    const normalized = String(status || '').toUpperCase()
    return normalized === 'COMPLETED' || normalized === 'DELIVERED'
  }
  const nextPendingIndex = mappableDropPoints.findIndex((point) => !isDropPointDone(point.status))
  const completedDropPoints =
    nextPendingIndex === -1 ? mappableDropPoints : mappableDropPoints.slice(0, Math.max(nextPendingIndex, 0))
  const pendingDropPoints =
    nextPendingIndex === -1 ? [] : mappableDropPoints.slice(Math.max(nextPendingIndex, 0))
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
  const nextDropPoint = mappableDropPoints.find((point) => String(point.status || '').toUpperCase() !== 'COMPLETED' && String(point.status || '').toUpperCase() !== 'DELIVERED') || mappableDropPoints[0] || null
  const effectiveDriverLocation = (currentLocation && Number.isFinite(Number(currentLocation.lat)) && Number.isFinite(Number(currentLocation.lng))
      ? { lat: Number(currentLocation.lat), lng: Number(currentLocation.lng) }
      : null) ||
    (previewDriverLocation && Number.isFinite(Number(previewDriverLocation.lat)) && Number.isFinite(Number(previewDriverLocation.lng))
      ? { lat: Number(previewDriverLocation.lat), lng: Number(previewDriverLocation.lng) }
      : null) ||
    (trip.latestLocation && Number.isFinite(Number(trip.latestLocation.latitude)) && Number.isFinite(Number(trip.latestLocation.longitude))
      ? { lat: Number(trip.latestLocation.latitude), lng: Number(trip.latestLocation.longitude) }
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
      markerLabel: 'Current location',
      markerType: 'truck' as const,
      markerHeading: driverMarkerHeading ?? undefined,
      markerColor: '#1d4ed8',
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
      markerLabel: `${point.sequence}. ${point.address || point.city || 'Drop Point'}`,
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
              </div>
              <Badge className="border border-slate-300/20 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-900 md:px-2.5 md:py-1 md:text-xs">
                {effectiveCompletedDropPoints}/{trip.totalDropPoints} Completed
              </Badge>
            </div>
          </div>

          {/* Location Permission Warning */}
          {locationPermission === 'denied' && (
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
                onClick={handleStartTrip}
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

          {/* Route Map */}
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
                showZoomControls={false}
                className="h-[240px] w-full overflow-hidden rounded-xl border shadow-sm md:h-[350px]"
              />
            )}
          </div>

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
                          {highlightedDropPoint ? `${highlightedDropPoint.sequence}/${trip.totalDropPoints} • ${highlightedDropPoint.status}` : `${effectiveCompletedDropPoints}/${trip.totalDropPoints} Completed`}
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
                                    <p className="text-sm text-slate-500">{dropPoint.address}</p>
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
                                    onClick={(e) => { e.stopPropagation(); handleUpdateDropPoint(dropPoint.id, 'ARRIVED'); }}
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
                                            openSpareReplacement(dropPoint)
                                          }}
                                          disabled={isUpdating || isSpareReplacing}
                                        >
                                          {getDropPointOpenReplacement(dropPoint) ? 'Resolve Replacement' : 'Report Damage'}
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
                                          if (getDropPointOpenReplacement(dropPoint)) {
                                            toast.error('Resolve the remaining replacement before marking this drop point as delivered')
                                            return
                                          }
                                          if (!podImageFile) {
                                            toast.error('Capture POD photo first')
                                            openCameraCapture('pod')
                                            return
                                          }
                                          try {
                                            const imageUrl = await uploadPodImage(podImageFile)
                                            await handleUpdateDropPoint(dropPoint.id, 'COMPLETED', deliveryNote, {
                                              recipientName: 'Customer',
                                              deliveryPhoto: imageUrl,
                                            })
                                            handlePodFileChange(null)
                                            setDeliveryNote('')
                                          } catch (error: any) {
                                            toast.error(error?.message || 'Failed to upload POD image')
                                            return
                                          }
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
                    <p className="text-lg font-black tracking-[-0.02em] text-slate-900">{trip.tripNumber}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {effectiveCompletedDropPoints}/{trip.totalDropPoints} Completed
                    </span>
                  </div>
                </motion.button>
              ) : null}
            </AnimatePresence>
          </div>

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
                            <p className="text-sm text-slate-500">{dropPoint.address}</p>
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
                                  <div className="mt-1 rounded-md bg-slate-50 px-2 py-1.5">
                                    <p className="text-[11px] font-semibold text-slate-600">Order Details</p>
                                    <div className="mt-1 space-y-0.5">
                                      {(dropPoint.order.items || []).map((item, index) => (
                                        <p key={`${dropPoint.id}-item-${index}`} className="text-[11px] text-slate-600">
                                          {item.product?.name || 'Item'} x{Number(item.quantity || 0)}
                                        </p>
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
                            onClick={(e) => { e.stopPropagation(); handleUpdateDropPoint(dropPoint.id, 'ARRIVED'); }}
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
                                    e.stopPropagation()
                                    openSpareReplacement(dropPoint)
                                  }}
                                  disabled={isUpdating || isSpareReplacing}
                                >
                                  {getDropPointOpenReplacement(dropPoint) ? 'Resolve Replacement' : 'Report Damage'}
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
                                  if (getDropPointOpenReplacement(dropPoint)) {
                                    toast.error('Resolve the remaining replacement before marking this drop point as delivered')
                                    return
                                  }
                                  if (!podImageFile) {
                                    toast.error('Capture POD photo first')
                                    openCameraCapture('pod')
                                    return
                                  }
                                  try {
                                    const imageUrl = await uploadPodImage(podImageFile)
                                    await handleUpdateDropPoint(dropPoint.id, 'COMPLETED', deliveryNote, {
                                      recipientName: 'Customer',
                                      deliveryPhoto: imageUrl,
                                    })
                                    handlePodFileChange(null)
                                    setDeliveryNote('')
                                  } catch (error: any) {
                                    toast.error(error?.message || 'Failed to upload POD image')
                                    return
                                  }
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
                  : 'Take a clear photo of the delivered package/recipient.'}
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
                  openCameraCapture(cameraCaptureTarget)
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
                {spareFollowUpReturnId ? 'Resolve Replacement' : 'Damage Report'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                {spareFollowUpReturnId
                  ? 'Capture follow-up photo evidence and submit the remaining replacement quantity to close the case.'
                  : 'Capture damage evidence using camera, then mark as resolved or partially replaced.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          {(() => {
            const targetDropPoint = (trip.dropPoints || []).find((point) => point.id === spareTargetDropPointId) || null
            const targetItems = getDropPointReplacementItems(targetDropPoint)
            const targetOpenReplacement = getDropPointOpenReplacement(targetDropPoint)
            const targetReplacementProgress = getReplacementProgress(targetDropPoint)
            const followUpMode = Boolean(targetOpenReplacement)
            const selectedSpareItem = targetItems.find((item) => item.id === spareOrderItemId) || null
            const maxReplaceQuantity = followUpMode
              ? Math.max(Number(targetReplacementProgress.remainingQuantity || 0), 0)
              : Math.max(Number(selectedSpareItem?.quantity || 0), 0)

            return (
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            {targetOpenReplacement ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Follow-up replacement in progress: {targetReplacementProgress.replacedQuantity} replaced, {targetReplacementProgress.remainingQuantity} still need to be replaced.
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="spare-order-item">Damaged Item</Label>
              <Select
                value={spareOrderItemId}
                onValueChange={(value) => {
                  setSpareOrderItemId(value)
                  if (followUpMode) return
                  const nextItem = targetItems.find((item) => item.id === value) || null
                  const itemMaxQuantity = Math.max(Number(nextItem?.quantity || 0), 0)
                  setSpareQuantity((previous) => {
                    if (!Number.isFinite(previous)) return itemMaxQuantity
                    return Math.min(Math.max(previous, 0), itemMaxQuantity)
                  })
                }}
                disabled={targetItems.length === 0 || followUpMode}
              >
                <SelectTrigger className="h-9 w-full rounded-md border-sky-200 bg-white text-sm text-slate-900 shadow-sm focus:ring-emerald-500/30 focus:ring-offset-0">
                  <SelectValue placeholder={targetItems.length === 0 ? 'No item details available' : 'Select damaged item'} />
                </SelectTrigger>
                <SelectContent className="border-sky-200 bg-white text-slate-900">
                  {targetItems.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="data-[highlighted]:bg-sky-50 data-[highlighted]:text-[#0f3d72]">
                      {(item.product?.name || 'Item')} ({item.product?.sku || 'N/A'}) - Qty {Number(item.quantity || 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="spare-qty">Quantity to Replace</Label>
              <Input
                id="spare-qty"
                type="number"
                min={followUpMode ? targetReplacementProgress.remainingQuantity : 0}
                max={maxReplaceQuantity}
                value={spareQuantity}
                onChange={(e) => {
                  if (followUpMode) return
                  const parsed = Number(e.target.value || 0)
                  const clamped = Math.min(Math.max(parsed, 0), maxReplaceQuantity)
                  setSpareQuantity(clamped)
                }}
                disabled={followUpMode}
              />
              {followUpMode ? (
                <p className="text-xs text-emerald-700">Follow-up cases use the remaining quantity only, tied to the original damaged item.</p>
              ) : null}
            </div>
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
                      onClick={() => setSpareOutcome('PARTIALLY_REPLACED')}
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
              {spareOutcome === 'PARTIALLY_REPLACED' && (
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
                    max={spareQuantity}
                    value={sparePartiallyReplacedQuantity}
                    onChange={(e) => setSparePartiallyReplacedQuantity(Number(e.target.value || 0))}
                    disabled={isSpareReplacing}
                    placeholder="Enter quantity replaced"
                  />
                  <p className="text-xs text-slate-500">
                    Total damaged: {spareQuantity} | You are replacing: {sparePartiallyReplacedQuantity}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="space-y-2">
              <Label htmlFor="spare-reason">Damage Details</Label>
              <Textarea
                id="spare-reason"
                placeholder="Describe damage observed by driver..."
                value={spareReason}
                onChange={(e) => setSpareReason(e.target.value)}
              />
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
                disabled={isSpareReplacing}
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
                  closeFailedDeliveryChoice()
                  openFailedDeliveryReschedule(failedDeliveryDropPointId)
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
                  closeFailedDeliveryChoice()
                  await handleUpdateDropPoint(failedDeliveryDropPointId, 'SKIPPED', deliveryNote || 'Delivery canceled by driver')
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
function HistoryView({
  trips,
  isLoading,
  onOpenTrip,
}: {
  trips: Trip[]
  isLoading: boolean
  onOpenTrip: (trip: Trip) => void
}) {
  const isCompletedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'COMPLETED'
  const completedTrips = [...(trips || [])]
    .filter((trip) => isCompletedTrip(trip.status))
    .sort((a, b) => {
      const aDate = new Date(a.actualEndAt || a.updatedAt || a.createdAt || a.plannedStartAt || 0).getTime()
      const bDate = new Date(b.actualEndAt || b.updatedAt || b.createdAt || b.plannedStartAt || 0).getTime()
      return bDate - aDate
    })

  const formatDate = (value?: string | null) => {
    if (!value) return 'N/A'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return 'N/A'
    return d.toLocaleString()
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">Delivery History</h2>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Loading delivery history...</p>
          </CardContent>
        </Card>
      ) : completedTrips.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No delivery history yet</p>
            <p className="text-sm text-gray-400 mt-1">Completed deliveries will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {completedTrips.map((trip) => (
            <Card key={trip.id} className="rounded-xl border border-slate-200 shadow-sm">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{trip.tripNumber}</p>
                    <p className="text-xs text-slate-500">Completed: {formatDate(trip.actualEndAt || trip.updatedAt)}</p>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">COMPLETED</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="text-slate-500">Vehicle</p>
                    <p className="font-medium text-slate-900">
                      {trip.vehicle?.licensePlate || 'N/A'} ({trip.vehicle?.type || 'N/A'})
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="text-slate-500">Stops</p>
                    <p className="font-medium text-slate-900">
                      {trip.completedDropPoints}/{trip.totalDropPoints}
                    </p>
                  </div>
                </div>

                {trip.dropPoints?.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Stop Details</p>
                    <div className="space-y-1.5">
                      {trip.dropPoints.map((stop) => (
                        <div key={stop.id} className="rounded-md border border-slate-200 p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-slate-900">
                              #{stop.sequence} {stop.locationName || 'Drop Point'}
                            </p>
                            <Badge
                              className={
                                stop.status === 'COMPLETED'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }
                            >
                              {stop.status}
                            </Badge>
                          </div>
                          <p className="text-slate-500">{stop.address}, {stop.city}</p>
                          <p className="text-slate-500">Order: {stop.order?.orderNumber || 'N/A'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Button className="w-full" variant="outline" onClick={() => onOpenTrip(trip)}>
                  View Details
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// Profile View
function ProfileView({ user }: { user: any }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingLicensePhoto, setIsUploadingLicensePhoto] = useState(false)
  const [isReadingLicenseOcr, setIsReadingLicenseOcr] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const licenseCameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const licenseCameraStreamRef = useRef<MediaStream | null>(null)
  const [isLicenseCameraOpen, setIsLicenseCameraOpen] = useState(false)
  const [isLicenseCameraLoading, setIsLicenseCameraLoading] = useState(false)
  const [licenseCameraError, setLicenseCameraError] = useState('')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
    licensePhoto: '',
  })
  const [draft, setDraft] = useState({
    name: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
    licensePhoto: '',
  })

  useEffect(() => {
    async function fetchProfile() {
      try {
        const response = await fetch('/api/driver/profile', { credentials: 'include' })
        if (!response.ok) throw new Error('Failed to load profile')
        const payload = await response.json()
        const profile = payload?.driver || payload?.profile || {}
        setForm({
          name: profile?.user?.name || user?.name || '',
          email: profile?.user?.email || user?.email || '',
          phone: profile?.phone || profile?.user?.phone || '',
          licenseNumber: profile?.licenseNumber || '',
          licenseType: profile?.licenseType || '',
          licenseExpiry: profile?.licenseExpiry ? String(profile.licenseExpiry).slice(0, 10) : '',
          licensePhoto: profile?.licensePhoto || '',
        })
      } catch (error) {
        toast.error('Failed to load profile')
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  }, [user?.email, user?.name])

  const onChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const normalizeDateToInput = (value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const isoLike = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
    if (isoLike) {
      const year = isoLike[1]
      const month = isoLike[2].padStart(2, '0')
      const day = isoLike[3].padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    const mdy = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/)
    if (mdy) {
      const month = mdy[1].padStart(2, '0')
      const day = mdy[2].padStart(2, '0')
      const year = mdy[3]
      return `${year}-${month}-${day}`
    }
    return ''
  }

  const extractLicenseFieldsFromText = (text: string) => {
    const normalized = String(text || '').toUpperCase().replace(/\s+/g, ' ')
    const licenseFromKeyword =
      normalized.match(/\b(?:LICEN[CS]E\s*(?:NO|NUM(?:BER)?)?|DL(?:\s*NO)?|ID(?:\s*NO)?)\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i)?.[1] || ''
    const genericMatches = normalized.match(/\b[A-Z0-9]{10,20}\b/g) || []
    const bestGeneric = genericMatches.find((token) => /[A-Z]/.test(token) && /\d/.test(token)) || genericMatches[0] || ''
    const licenseNumber = (licenseFromKeyword || bestGeneric || '').replace(/[^A-Z0-9]/g, '')

    const typeMatch = normalized.match(/\b(?:CLASS|TYPE)\s*[:#-]?\s*([A-Z0-9]{1,3})\b/)
    const expiryMatch = normalized.match(/\b(?:EXP|EXPIRY|EXPIRATION|VALID UNTIL)\s*[:#-]?\s*([0-9/-]{8,10})\b/)
    const fallbackDate = normalized.match(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/)

    return {
      licenseNumber,
      licenseType: typeMatch?.[1] || '',
      licenseExpiry: normalizeDateToInput(expiryMatch?.[1] || fallbackDate?.[0] || ''),
    }
  }

  const runLicenseOcr = async (file: File) => {
    setIsReadingLicenseOcr(true)
    let worker: any = null
    try {
      const { createWorker } = await import('tesseract.js')
      worker = await createWorker('eng')
      const { data } = await worker.recognize(file)
      const extracted = extractLicenseFieldsFromText(data?.text || '')

      let applied = false
      setDraft((prev) => {
        const next = { ...prev }
        if (extracted.licenseNumber && extracted.licenseNumber !== prev.licenseNumber) {
          next.licenseNumber = extracted.licenseNumber
          applied = true
        }
        if (extracted.licenseType && !prev.licenseType) {
          next.licenseType = extracted.licenseType
          applied = true
        }
        if (extracted.licenseExpiry && !prev.licenseExpiry) {
          next.licenseExpiry = extracted.licenseExpiry
          applied = true
        }
        return next
      })
      if (applied) {
        toast.success('License fields auto-filled from ID image')
      }
    } catch {
      // OCR should never block upload flow
    } finally {
      if (worker) {
        try {
          await worker.terminate()
        } catch {
          // ignore worker cleanup errors
        }
      }
      setIsReadingLicenseOcr(false)
    }
  }

  const openEdit = () => {
    setDraft({
      name: form.name,
      phone: form.phone,
      licenseNumber: form.licenseNumber,
      licenseType: form.licenseType,
      licenseExpiry: form.licenseExpiry,
      licensePhoto: form.licensePhoto,
    })
    setEditOpen(true)
  }

  const uploadLicensePhoto = async (file: File) => {
    setIsUploadingLicensePhoto(true)
    try {
      const optimizedFile = await prepareImageForUpload(file, { maxDimension: 1600, maxBytes: 2 * 1024 * 1024 })
      const formData = new FormData()
      formData.append('file', optimizedFile)

      const response = await fetch('/api/uploads/driver-license', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false || !payload?.imageUrl) {
        throw new Error(payload?.error || 'Failed to upload license image')
      }
      setDraft((prev) => ({ ...prev, licensePhoto: payload.imageUrl }))
      void runLicenseOcr(optimizedFile)
      toast.success('License image uploaded')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to upload license image')
    } finally {
      setIsUploadingLicensePhoto(false)
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  const stopLicenseCameraStream = () => {
    if (licenseCameraStreamRef.current) {
      licenseCameraStreamRef.current.getTracks().forEach((track) => track.stop())
      licenseCameraStreamRef.current = null
    }
  }

  const closeLicenseCamera = () => {
    stopLicenseCameraStream()
    setIsLicenseCameraOpen(false)
    setIsLicenseCameraLoading(false)
    setLicenseCameraError('')
  }

  const openLicenseCamera = () => {
    setLicenseCameraError('')
    setIsLicenseCameraOpen(true)
  }

  const captureLicenseFromCamera = async () => {
    const video = licenseCameraVideoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error('Camera is still loading')
      return
    }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Unable to capture photo')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Failed to capture photo')
      const file = new File([blob], `license-camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      closeLicenseCamera()
      await uploadLicensePhoto(file)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to capture photo')
    }
  }

  useEffect(() => {
    if (!isLicenseCameraOpen) return

    let cancelled = false
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera is not available on this device/browser.')
        }
        setIsLicenseCameraLoading(true)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        licenseCameraStreamRef.current = stream
        if (licenseCameraVideoRef.current) {
          licenseCameraVideoRef.current.srcObject = stream
          await licenseCameraVideoRef.current.play().catch(() => {})
        }
      } catch (error: any) {
        setLicenseCameraError(error?.message || 'Unable to access camera.')
      } finally {
        if (!cancelled) setIsLicenseCameraLoading(false)
      }
    }

    void start()
    return () => {
      cancelled = true
      stopLicenseCameraStream()
    }
  }, [isLicenseCameraOpen])

  const takeLicensePhoto = async () => {
    if (isUploadingLicensePhoto || isSaving) return
    try {
      const cap = (window as any)?.Capacitor
      const isNative = Boolean(cap?.isNativePlatform?.() || (typeof cap?.getPlatform === 'function' && cap.getPlatform() !== 'web'))
      if (!isNative) {
        openLicenseCamera()
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
      const file = new File([blob], `license-camera-${Date.now()}.${ext}`, { type: mimeType })
      await uploadLicensePhoto(file)
    } catch {
      openLicenseCamera()
    }
  }

  const onSave = async () => {
    if (!draft.name.trim()) {
      toast.error('Name is required')
      return
    }

    setIsSaving(true)
    try {
      const payloadBody: Record<string, string> = {
        name: draft.name,
        phone: draft.phone,
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licensePhoto: draft.licensePhoto,
      }
      if (draft.licenseExpiry) {
        payloadBody.licenseExpiry = new Date(`${draft.licenseExpiry}T00:00:00`).toISOString()
      }

      const response = await fetch('/api/driver/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payloadBody),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }
      setForm((prev) => ({
        ...prev,
        name: draft.name,
        phone: draft.phone,
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licenseExpiry: draft.licenseExpiry,
        licensePhoto: draft.licensePhoto,
      }))
      setEditOpen(false)
      toast.success('Profile updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
      <h2 className="text-xl font-bold text-gray-900 mb-4">My Profile</h2>
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="h-36 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-20 w-20 mb-4">
                  <AvatarFallback className="bg-blue-600 text-white text-2xl">
                    {(form.name || user?.name || 'D').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold text-gray-900">{form.name || 'N/A'}</h3>
                <p className="text-sm text-gray-500">{form.email || 'N/A'}</p>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Phone</p>
                  <p className="text-sm font-medium text-gray-900">{form.phone || 'N/A'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                <div className="space-y-2">
                  <Label>License #</Label>
                  <p className="text-sm font-medium text-gray-900">{form.licenseNumber || 'N/A'}</p>
                </div>
                <div className="space-y-2">
                  <Label>License Type</Label>
                  <p className="text-sm font-medium text-gray-900">{form.licenseType || 'N/A'}</p>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>License Expiration</Label>
                  <p className="text-sm font-medium text-gray-900">{form.licenseExpiry || 'N/A'}</p>
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <Label>License Photo</Label>
                {form.licensePhoto ? (
                  <img
                    src={form.licensePhoto}
                    alt="Driver license"
                    className="h-40 w-full rounded-md border border-slate-200 object-cover"
                  />
                ) : (
                  <p className="text-sm text-gray-500">No license photo uploaded</p>
                )}
              </div>

              <Button className="w-full" onClick={openEdit}>
                Edit Profile
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">
                Edit <span className="text-[#2f9a34]">Profile</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Update your personal details and license info.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3.5 overflow-y-auto px-5 pb-5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="driver-name" className="text-[0.95rem] font-semibold text-[#17365d]">Full Name</Label>
              <Input
                id="driver-name"
                value={draft.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-phone" className="text-[0.95rem] font-semibold text-[#17365d]">Phone</Label>
              <Input
                id="driver-phone"
                value={draft.phone}
                onChange={(e) => onChange('phone', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="driver-license-number" className="text-[0.95rem] font-semibold text-[#17365d]">License #</Label>
                <Input
                  id="driver-license-number"
                  value={draft.licenseNumber}
                  onChange={(e) => onChange('licenseNumber', e.target.value)}
                  className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver-license-type" className="text-[0.95rem] font-semibold text-[#17365d]">License Type</Label>
                <Input
                  id="driver-license-type"
                  value={draft.licenseType}
                  onChange={(e) => onChange('licenseType', e.target.value)}
                  className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-license-expiry" className="text-[0.95rem] font-semibold text-[#17365d]">License Expiration</Label>
              <Input
                id="driver-license-expiry"
                type="date"
                value={draft.licenseExpiry}
                onChange={(e) => onChange('licenseExpiry', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[0.95rem] font-semibold text-[#17365d]">License Photo</Label>
              {draft.licensePhoto ? (
                <img
                  src={draft.licensePhoto}
                  alt="Driver license preview"
                  className="h-40 w-full rounded-2xl border border-sky-100 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                />
              ) : (
                <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-white/60 text-sm text-[#597393]">
                  No image selected
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-sky-200 bg-white/85 px-3 text-sm font-semibold text-[#0f4f8f] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50 hover:text-[#0d61ad]"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isUploadingLicensePhoto || isSaving}
                >
                  Upload from Gallery
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-emerald-200 bg-white/85 px-3 text-sm font-semibold text-[#1f7a38] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-emerald-50 hover:text-[#1a6a31]"
                  onClick={() => void takeLicensePhoto()}
                  disabled={isUploadingLicensePhoto || isSaving}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Take Photo
                </Button>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void uploadLicensePhoto(file)
                }}
              />
              {isUploadingLicensePhoto ? (
                <p className="text-xs text-[#4d6785]">Uploading license image...</p>
              ) : null}
              {isReadingLicenseOcr ? (
                <p className="text-xs text-[#4d6785]">Reading ID text and auto-filling fields...</p>
              ) : null}
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => setEditOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isLicenseCameraOpen}
        onOpenChange={(open) => {
          if (!open) closeLicenseCamera()
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Take License Photo</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">Use your camera to capture the license ID.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="overflow-hidden rounded-xl border border-sky-100 bg-black shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
              <video ref={licenseCameraVideoRef} autoPlay playsInline muted className="h-64 w-full object-cover" />
            </div>
            {isLicenseCameraLoading ? <p className="text-sm text-[#4d6785]">Opening camera...</p> : null}
            {licenseCameraError ? <p className="text-sm text-red-600">{licenseCameraError}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50" onClick={closeLicenseCamera}>
                Cancel
              </Button>
              <Button type="button" className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]" onClick={() => void captureLicenseFromCamera()} disabled={Boolean(licenseCameraError)}>
                Capture
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
