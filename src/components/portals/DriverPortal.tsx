'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Poppins } from 'next/font/google'
import { useAuth } from '@/app/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
  ChevronRight,
  Play,
  Pause,
  Flag,
  MessageSquare,
  Loader2,
  Route,
  CalendarClock,
  Trophy,
  RotateCcw
} from 'lucide-react'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

interface Trip {
  id: string
  tripNumber: string
  status: string
  plannedStartAt: string | null
  actualStartAt?: string | null
  actualEndAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  totalDropPoints: number
  completedDropPoints: number
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
  } | null
}

type NativeCameraCheckResult = {
  granted: boolean
  reason?: string
}

const isNativeAndroidApp = () => {
  if (typeof window === 'undefined') return false
  const cap = (window as any).Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
    const platform = typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : ''
    return platform === 'android' || platform === ''
  }
  return String(cap?.getPlatform?.() || '').toLowerCase() === 'android'
}

const checkNativeAndroidCameraPermission = async (): Promise<NativeCameraCheckResult> => {
  if (typeof window === 'undefined' || !isNativeAndroidApp()) {
    return { granted: true }
  }

  const cap = (window as any).Capacitor
  const cameraPlugin = cap?.Plugins?.Camera

  if (!cameraPlugin?.checkPermissions || !cameraPlugin?.requestPermissions) {
    return {
      granted: false,
      reason: 'Native camera plugin is unavailable. Rebuild Android app with Capacitor Camera plugin.',
    }
  }

  try {
    let result = await cameraPlugin.checkPermissions()
    const current = String(result?.camera || '')
    if (current !== 'granted') {
      result = await cameraPlugin.requestPermissions({ permissions: ['camera'] })
    }
    const finalState = String(result?.camera || '')
    if (finalState === 'granted') {
      return { granted: true }
    }
    return { granted: false, reason: 'Camera permission is blocked. Enable it in Android app settings.' }
  } catch {
    return { granted: false, reason: 'Unable to verify camera permission. Please allow it in Android settings.' }
  }
}

const openNativeAndroidAppSettings = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !isNativeAndroidApp()) {
    return false
  }
  try {
    const cap = (window as any).Capacitor
    const appPlugin = cap?.Plugins?.App
    if (appPlugin?.openSettings) {
      await appPlugin.openSettings()
      return true
    }
    return false
  } catch {
    return false
  }
}

export function DriverPortal() {
  const { user, logout } = useAuth()
  const [activeView, setActiveView] = useState('home')
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt')
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [isNativeCameraGateOpen, setIsNativeCameraGateOpen] = useState(false)
  const [nativeCameraGateMessage, setNativeCameraGateMessage] = useState('Camera permission is required to use AnnDrive.')
  const [isCheckingNativeCameraPermission, setIsCheckingNativeCameraPermission] = useState(false)
  const watchIdRef = useRef<number | null>(null)
  const isFetchingTripsRef = useRef(false)

  const fetchTrips = useCallback(async (silent = false) => {
    if (isFetchingTripsRef.current) return
    isFetchingTripsRef.current = true
    try {
      const response = await fetch('/api/driver/trips', { cache: 'no-store', credentials: 'include' })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to fetch trips')
      }

      setTrips(data.trips || [])
    } catch (error: any) {
      if (!silent) {
        toast.error(error?.message || 'Failed to load assigned trips')
      }
      console.error('Failed to fetch trips:', error)
    } finally {
      isFetchingTripsRef.current = false
      setIsLoading(false)
    }
  }, [])

  // Fetch trips
  useEffect(() => {
    void fetchTrips()

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
    }, 15000)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [fetchTrips])

  useEffect(() => {
    if (!selectedTrip) return
    const latestTrip = trips.find((trip) => trip.id === selectedTrip.id)
    if (latestTrip) {
      setSelectedTrip(latestTrip)
    }
  }, [trips, selectedTrip])

  const enforceNativeCameraPermission = useCallback(async () => {
    if (!isNativeAndroidApp()) {
      setIsNativeCameraGateOpen(false)
      return true
    }
    setIsCheckingNativeCameraPermission(true)
    const permission = await checkNativeAndroidCameraPermission()
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
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setLocationPermission(result.state as 'granted' | 'denied' | 'prompt')
      })
    }
  }, [])

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
    if (selectedTrip?.status === 'IN_PROGRESS') return selectedTrip.id
    const inProgress = trips.find((trip) => trip.status === 'IN_PROGRESS')
    return inProgress?.id || null
  }

  const openLocationSettings = () => {
    try {
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
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      return false
    }

    if (watchIdRef.current !== null) {
      setIsTracking(true)
      return true
    }

    const canAccessLocation = await new Promise<boolean>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          setCurrentLocation({ lat, lng })
          setLocationPermission('granted')
          setIsTracking(true)
          void sendLocationUpdate(lat, lng, getActiveTripId())
          resolve(true)
        },
        () => {
          setLocationPermission('denied')
          setIsTracking(false)
          toast.error('Location is required to start trip. Please enable location access in settings.')
          openLocationSettings()
          resolve(false)
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      )
    })

    if (!canAccessLocation) {
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
      <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-transparent md:min-h-screen md:max-w-none md:rounded-none md:border-0 md:shadow-none">
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
                <DropdownMenuItem onClick={() => { setActiveView('trips'); setSelectedTrip(null) }}>
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

      {/* Main Content */}
      <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={`${activeView}-${selectedTrip?.id || 'none'}`}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="flex-1 min-h-0 w-full px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6"
      >
        {activeView === 'home' && (
          <HomeView
            user={user}
            trips={trips}
            isLoading={isLoading}
            isTracking={isTracking}
            locationPermission={locationPermission}
            currentLocation={currentLocation}
            onOpenTrips={() => { setActiveView('trips'); setSelectedTrip(null) }}
            onOpenActiveTrip={(trip) => { setActiveView('trips'); setSelectedTrip(trip) }}
            onStartTracking={startLocationTracking}
          />
        )}

        {activeView === 'trips' && !selectedTrip && (
          <TripsListView
            trips={trips}
            isLoading={isLoading}
            onSelectTrip={setSelectedTrip}
          />
        )}

        {activeView === 'trips' && selectedTrip && (
          <TripDetailView
            trip={selectedTrip}
            onBack={() => setSelectedTrip(null)}
            locationPermission={locationPermission}
            onStartTracking={startLocationTracking}
            onRefreshTrips={() => fetchTrips(true)}
            isTracking={isTracking}
            currentLocation={currentLocation}
          />
        )}

        {activeView === 'history' && (
          <HistoryView
            trips={trips}
            isLoading={isLoading}
            onOpenTrip={(trip) => {
              setActiveView('trips')
              setSelectedTrip(trip)
            }}
          />
        )}

        {activeView === 'profile' && <ProfileView user={user} />}
      </motion.main>
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-2 left-2 right-2 rounded-3xl border border-white/80 bg-[#eff7fb]/85 backdrop-blur-xl shadow-[0_14px_30px_rgba(15,23,42,0.14)] md:relative md:bottom-auto md:left-auto md:right-auto md:w-full md:rounded-none md:border md:border-t md:border-sky-200/60 md:shadow-[0_-2px_8px_rgba(15,23,42,0.06)]">
        <div className="flex justify-around py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:pb-2">
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'home' ? 'bg-emerald-100/90 text-emerald-700 shadow-sm shadow-emerald-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={() => { setActiveView('home'); setSelectedTrip(null) }}
          >
            <Home className="h-5 w-5" />
            <span className="text-xs font-medium">Home</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'trips' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={() => { setActiveView('trips'); setSelectedTrip(null); }}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Camera Access Required</DialogTitle>
            <DialogDescription>
              This Android app is configured to force camera permission before driver operations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-red-600">{nativeCameraGateMessage}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const opened = await openNativeAndroidAppSettings()
                  if (!opened) {
                    toast.error('Could not open Android settings automatically. Open app settings manually and allow Camera.')
                  }
                }}
              >
                Open App Settings
              </Button>
              <Button
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
  const activeTrip = trips.find((trip) => trip.status === 'IN_PROGRESS') || null
  const plannedTrips = trips.filter((trip) => trip.status === 'PLANNED').length
  const completedTrips = trips.filter((trip) => trip.status === 'COMPLETED').length
  const pendingStops = activeTrip
    ? (activeTrip.dropPoints || []).filter((point) => point.status !== 'COMPLETED').length
    : 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-[1.6rem] border border-white/70 bg-[#cde4f3]/85 p-4 shadow-[0_16px_30px_rgba(14,116,144,0.16)] backdrop-blur-xl md:p-5">
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
  onSelectTrip 
}: { 
  trips: Trip[]; 
  isLoading: boolean; 
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
      <h2 className="mb-4 mt-1 text-xl font-black tracking-[-0.01em] text-slate-900">My Deliveries</h2>

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
  onRefreshTrips: () => Promise<void>
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
  const [spareReason, setSpareReason] = useState('')
  const [spareDamagePhotoFiles, setSpareDamagePhotoFiles] = useState<File[]>([])
  const [spareDamagePhotoPreviews, setSpareDamagePhotoPreviews] = useState<string[]>([])
  const [isSpareReplacing, setIsSpareReplacing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const spareGalleryInputRef = useRef<HTMLInputElement | null>(null)
  const [cameraCaptureTarget, setCameraCaptureTarget] = useState<'pod' | 'spare'>('pod')
  const MAX_SPARE_DAMAGE_PHOTOS = 2

  const dropPointStatusColors: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border border-amber-200',
    IN_TRANSIT: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
    ARRIVED: 'bg-sky-100 text-sky-800 border border-sky-200',
    COMPLETED: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    FAILED: 'bg-rose-100 text-rose-800 border border-rose-200',
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2,
    }).format(amount)

  const handleStartTrip = async () => {
    const currentStatus = String(trip.status || '').toUpperCase()
    if (currentStatus !== 'PLANNED') {
      toast.error(`Trip cannot be started because status is ${currentStatus.replace(/_/g, ' ')}`)
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
    pod?: { recipientName?: string; deliveryPhoto?: string }
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
        }),
      })
      if (response.ok) {
        toast.success(`Drop point marked as ${status.toLowerCase()}`)
        await onRefreshTrips()
      } else {
        const payload = await response.json().catch(() => ({}))
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
    setCameraCaptureTarget(target)
    setCapturedCameraPhoto(null)
    setCameraError(null)
    setCameraPermissionHint('')
    setIsCameraOpen(true)
  }

  const openSpareReplacement = (dropPoint: DropPoint) => {
    const items = dropPoint.order?.items || []
    if (!items.length) {
      toast.error('No order items available for damage reporting')
      return
    }
    setSpareTargetDropPointId(dropPoint.id)
    setSpareOrderItemId(items[0].id)
    setSpareQuantity(1)
    setSpareReason('')
    setSpareDamagePhotoFiles([])
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return []
    })
    setIsSpareReplaceOpen(true)
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
    if (spareGalleryInputRef.current) spareGalleryInputRef.current.value = ''
  }

  const closeSpareReplacement = () => {
    setIsSpareReplaceOpen(false)
    setSpareTargetDropPointId(null)
    setSpareOrderItemId('')
    setSpareQuantity(1)
    setSpareReason('')
    setSpareDamagePhotoFiles([])
    setSpareDamagePhotoPreviews((previous) => {
      previous.forEach((url) => URL.revokeObjectURL(url))
      return []
    })
    if (spareGalleryInputRef.current) spareGalleryInputRef.current.value = ''
    setIsSpareReplacing(false)
  }

  const openSpareCameraCapture = () => {
    openCameraCapture('spare')
  }

  const openSpareGalleryPicker = () => {
    if (!spareGalleryInputRef.current) return
    spareGalleryInputRef.current.value = ''
    spareGalleryInputRef.current.click()
  }

  const submitSpareReplacement = async () => {
    const targetDropPoint = (trip.dropPoints || []).find((point) => point.id === spareTargetDropPointId) || null
    if (!targetDropPoint) {
      toast.error('Invalid drop point for on-delivery replacement')
      return
    }
    const selectedItem = (targetDropPoint.order?.items || []).find((item) => item.id === spareOrderItemId) || null
    if (!selectedItem) {
      toast.error('Select an item to replace')
      return
    }
    if (!Number.isFinite(spareQuantity) || spareQuantity <= 0 || !Number.isInteger(spareQuantity)) {
      toast.error('Quantity must be a whole number')
      return
    }
    if (spareQuantity > Number(selectedItem.quantity || 0)) {
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
          tripId: trip.id,
          dropPointId: targetDropPoint.id,
          orderItemId: selectedItem.id,
          quantity: spareQuantity,
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
        `Damage recorded and replaced. Remaining spare stock: ${Number(payload?.remainingSpareStock ?? 0)}`
      )
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

  const openCameraSettings = () => {
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

  const cameraPermissionSteps = getCameraPermissionSteps()

  return (
    <div>
      {/* Header */}
      <div className="rounded-2xl border border-emerald-300/40 bg-blue-700 p-4 text-white shadow-[0_12px_26px_rgba(2,132,199,0.22)]">
        <Button variant="ghost" size="sm" className="mb-2 p-0 text-white hover:bg-white/10" onClick={onBack}>
          &lt; Back to Trips
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{trip.tripNumber}</h2>
            <p className="text-slate-300 text-sm">{trip.vehicle?.licensePlate}</p>
          </div>
          <Badge className="border border-slate-300/20 bg-white text-slate-900">
            {trip.completedDropPoints}/{trip.totalDropPoints} Completed
          </Badge>
        </div>
      </div>

      {/* Location Permission Warning */}
      {locationPermission === 'denied' && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-4 rounded">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-800">Location Access Required</p>
              <p className="text-sm text-red-600 mt-1">
                Please enable location access in your browser settings to enable live tracking.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Start Trip Button */}
      {trip.status === 'PLANNED' && (
        <div className="p-4">
          <Button 
            className="h-12 w-full gap-2 bg-slate-900 text-lg text-white hover:bg-slate-800" 
            onClick={handleStartTrip}
            disabled={isUpdating}
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

      {/* Drop Points List */}
      <div className="p-4">
        <h3 className="mb-3 font-semibold text-slate-900">Drop Points</h3>
        <p className="mb-2 text-xs text-slate-500">Tap a stop card to show its action buttons.</p>
        <div className="space-y-3">
          {trip.dropPoints?.sort((a, b) => a.sequence - b.sequence).map((dropPoint) => (
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
                  <div className="mt-4 pt-4 border-t space-y-3">
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
                          {(dropPoint.order?.items || []).length > 0 ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full border-amber-300 text-amber-800 hover:bg-amber-50"
                              onClick={(e) => {
                                e.stopPropagation()
                                openSpareReplacement(dropPoint)
                              }}
                              disabled={isUpdating || isSpareReplacing}
                            >
                              Report Damage & Replace Now
                            </Button>
                          ) : null}
                          <p className="text-xs text-slate-500">Camera access is required before marking as delivered.</p>
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
                            disabled={isUpdating}
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Delivered
                          </Button>
                          <Button 
                            variant="destructive"
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              handleUpdateDropPoint(dropPoint.id, 'FAILED', deliveryNote); 
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
      {trip.status === 'IN_PROGRESS' && trip.completedDropPoints === trip.totalDropPoints && (
        <div className="p-4">
          <Button className="w-full h-12 bg-green-600 hover:bg-green-700">
            <Flag className="h-5 w-5 mr-2" />
            Complete Trip
          </Button>
        </div>
      )}

      <Dialog open={isCameraOpen} onOpenChange={(open) => { if (!open) closeCameraCapture() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cameraCaptureTarget === 'spare' ? 'Capture Damage Photo' : 'Capture POD Photo'}</DialogTitle>
            <DialogDescription>
              {cameraCaptureTarget === 'spare'
                ? 'Take a clear photo of the damaged item evidence.'
                : 'Take a clear photo of the delivered package/recipient.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {capturedCameraPhoto ? (
              <>
                <img
                  src={capturedCameraPhoto}
                  alt="Captured POD"
                  className="h-64 w-full rounded-md border border-slate-200 object-cover"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setCapturedCameraPhoto(null)}>
                    Try Again
                  </Button>
                  <Button onClick={() => void continueCapturedPhoto()}>
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="overflow-hidden rounded-md border border-slate-200 bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="h-64 w-full object-cover" />
                </div>
                {isCameraLoading ? <p className="text-sm text-slate-500">Opening camera...</p> : null}
                {cameraError ? <p className="text-sm text-red-600">{cameraError}</p> : null}
                <Button onClick={captureFromCamera} disabled={isCameraLoading || Boolean(cameraError)}>
                  Capture Photo
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCameraPermissionDialogOpen} onOpenChange={setIsCameraPermissionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Camera Permission Required</DialogTitle>
            <DialogDescription>
              Driver delivery proof requires live camera access. Enable camera permission in browser/app settings, then retry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-red-600">{cameraError || 'Camera permission is currently blocked.'}</p>
            {cameraPermissionHint ? <p className="text-xs text-slate-600">{cameraPermissionHint}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  openCameraSettings()
                }}
              >
                Try Open Settings
              </Button>
              <Button
                onClick={() => {
                  setIsCameraPermissionDialogOpen(false)
                  openCameraCapture(cameraCaptureTarget)
                }}
              >
                Retry Camera
              </Button>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-700">Manual steps</p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-600">
                {cameraPermissionSteps.map((step, index) => (
                  <li key={`camera-step-${index}`}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSpareReplaceOpen} onOpenChange={(open) => { if (!open) closeSpareReplacement() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>On-Delivery Damage Replacement</DialogTitle>
            <DialogDescription>
              Record damage evidence and replace immediately from driver spare stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="spare-order-item">Damaged Item</Label>
              <select
                id="spare-order-item"
                title="Damaged item"
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={spareOrderItemId}
                onChange={(e) => setSpareOrderItemId(e.target.value)}
              >
                {((trip.dropPoints || []).find((point) => point.id === spareTargetDropPointId)?.order?.items || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.product?.name || 'Item')} ({item.product?.sku || 'N/A'}) - Qty {Number(item.quantity || 0)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="spare-qty">Quantity to Replace</Label>
              <Input
                id="spare-qty"
                type="number"
                min={1}
                value={spareQuantity}
                onChange={(e) => setSpareQuantity(Number(e.target.value || 1))}
              />
            </div>
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
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openSpareCameraCapture}
                    disabled={isSpareReplacing || spareDamagePhotoFiles.length >= MAX_SPARE_DAMAGE_PHOTOS}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Take Photo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openSpareGalleryPicker}
                    disabled={isSpareReplacing || spareDamagePhotoFiles.length >= MAX_SPARE_DAMAGE_PHOTOS}
                  >
                    Upload from Gallery
                  </Button>
                </div>
                <input
                  ref={spareGalleryInputRef}
                  id="spare-photo"
                  className="hidden"
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label="Upload damage photo from gallery"
                  title="Upload damage photo from gallery"
                  onChange={(e) => appendSpareDamagePhotos(Array.from(e.target.files || []))}
                />
                <p className="text-xs text-slate-500">
                  Use camera or gallery. Up to {MAX_SPARE_DAMAGE_PHOTOS} photos only.
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
                        onClick={openSpareGalleryPicker}
                        disabled={isSpareReplacing || spareDamagePhotoFiles.length >= MAX_SPARE_DAMAGE_PHOTOS}
                      >
                        Add from Gallery
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
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
                onClick={closeSpareReplacement}
                disabled={isSpareReplacing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-amber-600 hover:bg-amber-700"
                onClick={() => void submitSpareReplacement()}
                disabled={isSpareReplacing}
              >
                {isSpareReplacing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Record & Replace
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
  const completedTrips = [...(trips || [])]
    .filter((trip) => trip.status === 'COMPLETED')
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
                    <p className="text-xs text-slate-500">
                      Completed: {formatDate(trip.actualEndAt || trip.updatedAt)}
                    </p>
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
    <div className="p-4">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update your personal details and license info.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="driver-name">Full Name</Label>
              <Input id="driver-name" value={draft.name} onChange={(e) => onChange('name', e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-phone">Phone</Label>
              <Input id="driver-phone" value={draft.phone} onChange={(e) => onChange('phone', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="driver-license-number">License #</Label>
                <Input
                  id="driver-license-number"
                  value={draft.licenseNumber}
                  onChange={(e) => onChange('licenseNumber', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver-license-type">License Type</Label>
                <Input
                  id="driver-license-type"
                  value={draft.licenseType}
                  onChange={(e) => onChange('licenseType', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-license-expiry">License Expiration</Label>
              <Input
                id="driver-license-expiry"
                type="date"
                value={draft.licenseExpiry}
                onChange={(e) => onChange('licenseExpiry', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>License Photo</Label>
              {draft.licensePhoto ? (
                <img
                  src={draft.licensePhoto}
                  alt="Driver license preview"
                  className="h-40 w-full rounded-md border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-500">
                  No image selected
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isUploadingLicensePhoto || isSaving}
                >
                  Upload from Gallery
                </Button>
                <Button
                  type="button"
                  variant="outline"
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
                <p className="text-xs text-slate-500">Uploading license image...</p>
              ) : null}
              {isReadingLicenseOcr ? (
                <p className="text-xs text-slate-500">Reading ID text and auto-filling fields...</p>
              ) : null}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={onSave} disabled={isSaving}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take License Photo</DialogTitle>
            <DialogDescription>Use your camera to capture the license ID.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-black">
              <video ref={licenseCameraVideoRef} autoPlay playsInline muted className="h-64 w-full object-cover" />
            </div>
            {isLicenseCameraLoading ? <p className="text-sm text-slate-500">Opening camera...</p> : null}
            {licenseCameraError ? <p className="text-sm text-red-600">{licenseCameraError}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={closeLicenseCamera}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void captureLicenseFromCamera()} disabled={Boolean(licenseCameraError)}>
                Capture
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
