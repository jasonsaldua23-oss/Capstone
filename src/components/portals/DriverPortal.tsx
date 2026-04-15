'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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
import { toast } from 'sonner'
import { 
  Truck, 
  Package, 
  Home,
  MapPin, 
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
  Loader2
} from 'lucide-react'

interface Trip {
  id: string
  tripNumber: string
  status: string
  plannedStartAt: string | null
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
  const [nativeCameraGateMessage, setNativeCameraGateMessage] = useState('Camera permission is required to use Driver Portal.')
  const [isCheckingNativeCameraPermission, setIsCheckingNativeCameraPermission] = useState(false)
  const watchIdRef = useRef<number | null>(null)

  const fetchTrips = useCallback(async (silent = false) => {
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
    }, 2000)

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
    setNativeCameraGateMessage(permission.reason || 'Camera permission is required to use Driver Portal.')
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-cyan-50/40 to-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-cyan-200/60 bg-gradient-to-r from-teal-700 via-cyan-700 to-sky-700 text-white shadow-lg shadow-cyan-900/10">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6" />
            <div>
              <h1 className="font-bold">LogiTrack Driver</h1>
              <p className="text-xs text-cyan-100">Delivery App</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isTracking && (
              <div className="flex items-center gap-1 rounded-full bg-emerald-400/90 px-2 py-1 text-xs text-emerald-950">
                <div className="h-2 w-2 bg-white rounded-full animate-pulse"></div>
                Tracking
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white hover:bg-cyan-600/60">
                  <User className="h-5 w-5" />
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
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20">
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

        {activeView === 'history' && <HistoryView />}

        {activeView === 'profile' && <ProfileView user={user} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-cyan-100 bg-white/95 backdrop-blur shadow-lg">
        <div className="flex justify-around py-2">
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 ${activeView === 'home' ? 'text-teal-700' : 'text-slate-600'}`}
            onClick={() => { setActiveView('home'); setSelectedTrip(null) }}
          >
            <Home className="h-5 w-5" />
            <span className="text-xs">Home</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 ${activeView === 'trips' ? 'text-teal-700' : 'text-slate-600'}`}
            onClick={() => { setActiveView('trips'); setSelectedTrip(null); }}
          >
            <Truck className="h-5 w-5" />
            <span className="text-xs">Trips</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 ${activeView === 'history' ? 'text-teal-700' : 'text-slate-600'}`}
            onClick={() => setActiveView('history')}
          >
            <Clock className="h-5 w-5" />
            <span className="text-xs">History</span>
          </Button>
          <Button
            variant="ghost"
            className={`flex-col gap-1 h-auto py-2 ${activeView === 'profile' ? 'text-teal-700' : 'text-slate-600'}`}
            onClick={() => setActiveView('profile')}
          >
            <User className="h-5 w-5" />
            <span className="text-xs">Profile</span>
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
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Welcome, {user?.name || 'Driver'}</h2>
        <p className="text-sm text-slate-600">Here is your delivery overview for today.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="rounded-2xl border-cyan-100 shadow-sm shadow-cyan-100/50">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Total Trips</p>
            <p className="text-2xl font-bold text-slate-900">{trips.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-sky-100 bg-sky-50/50 shadow-sm shadow-sky-100/50">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Planned</p>
            <p className="text-2xl font-bold text-sky-700">{plannedTrips}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-emerald-100 bg-emerald-50/60 shadow-sm shadow-emerald-100/50">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="text-2xl font-bold text-emerald-700">{completedTrips}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-amber-100 bg-amber-50/70 shadow-sm shadow-amber-100/50">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Pending Stops</p>
            <p className="text-2xl font-bold text-amber-700">{pendingStops}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-cyan-100 shadow-sm shadow-cyan-100/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tracking Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">GPS Permission</p>
            <Badge className="bg-cyan-100 text-cyan-800 border-cyan-200">{locationPermission.toUpperCase()}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">Live Tracking</p>
            <Badge className={isTracking ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
              {isTracking ? 'ACTIVE' : 'OFF'}
            </Badge>
          </div>
          {currentLocation ? (
            <p className="text-xs text-slate-500">
              Lat: {currentLocation.lat.toFixed(5)} | Lng: {currentLocation.lng.toFixed(5)}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Current location is not available yet.</p>
          )}
          {!isTracking && (
            <Button variant="outline" className="w-full border-cyan-300 text-cyan-800 hover:bg-cyan-50" onClick={() => { void onStartTracking() }}>
              Start Tracking
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-cyan-100 shadow-sm shadow-cyan-100/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Current Assignment</CardTitle>
        </CardHeader>
        <CardContent>
          {activeTrip ? (
            <div className="space-y-2">
              <p className="font-semibold">{activeTrip.tripNumber}</p>
              <p className="text-sm text-slate-600">
                {activeTrip.completedDropPoints}/{activeTrip.totalDropPoints} stops completed
              </p>
              <Button className="w-full bg-teal-700 hover:bg-teal-800 text-white" onClick={() => onOpenActiveTrip(activeTrip)}>
                Open Active Trip
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">No active trip right now.</p>
              <Button variant="outline" className="w-full border-cyan-300 text-cyan-800 hover:bg-cyan-50" onClick={onOpenTrips}>
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
    PLANNED: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
    IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    COMPLETED: 'bg-slate-100 text-slate-700 border border-slate-200',
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
      <h2 className="mb-4 text-xl font-semibold text-slate-900">My Deliveries</h2>

      {trips.length === 0 ? (
        <Card className="rounded-2xl border-cyan-100 shadow-sm shadow-cyan-100/50">
          <CardContent className="py-12 text-center">
            <Truck className="h-12 w-12 text-cyan-200 mx-auto mb-4" />
            <p className="text-slate-600">No assigned trips</p>
            <p className="text-sm text-slate-400 mt-1">New deliveries will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => (
            <Card key={trip.id} className="cursor-pointer rounded-2xl border-cyan-100 shadow-sm shadow-cyan-100/50 transition-all hover:shadow-md hover:-translate-y-0.5" onClick={() => onSelectTrip(trip)}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-base">{trip.tripNumber}</p>
                      <Badge className={`${statusColors[trip.status] || 'bg-gray-100'} text-xs px-2 py-0.5`}>
                        {trip.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-[13px] text-slate-700">Vehicle: {trip.vehicle?.licensePlate} • Driver: {trip.driver?.user?.name || trip.driver?.name || 'Assigned Driver'}</p>
                    <p className="text-[13px] text-slate-600">Route: Warehouse {'->'} {trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-8 px-3 text-xs"
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
  const [spareDamagePhotoFile, setSpareDamagePhotoFile] = useState<File | null>(null)
  const [isSpareReplacing, setIsSpareReplacing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)

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
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.success !== false) {
        toast.success('Trip started')
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

  const uploadPodImage = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/pod-image', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload POD image')
    }
    return String(payload.imageUrl)
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

  const openCameraCapture = () => {
    setCapturedCameraPhoto(null)
    setCameraError(null)
    setCameraPermissionHint('')
    setIsCameraOpen(true)
  }

  const openSpareReplacement = (dropPoint: DropPoint) => {
    const items = dropPoint.order?.items || []
    if (!items.length) {
      toast.error('No order items available for replacement')
      return
    }
    setSpareTargetDropPointId(dropPoint.id)
    setSpareOrderItemId(items[0].id)
    setSpareQuantity(1)
    setSpareReason('')
    setSpareDamagePhotoFile(null)
    setIsSpareReplaceOpen(true)
  }

  const handleSpareDamagePhotoChange = (file: File | null) => {
    setSpareDamagePhotoFile(file)
  }

  const closeSpareReplacement = () => {
    setIsSpareReplaceOpen(false)
    setSpareTargetDropPointId(null)
    setSpareOrderItemId('')
    setSpareQuantity(1)
    setSpareReason('')
    setSpareDamagePhotoFile(null)
    setIsSpareReplacing(false)
  }

  const submitSpareReplacement = async () => {
    const targetDropPoint = (trip.dropPoints || []).find((point) => point.id === spareTargetDropPointId) || null
    if (!targetDropPoint) {
      toast.error('Invalid drop point for replacement')
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
    if (!spareDamagePhotoFile) {
      toast.error('Damage photo is required')
      return
    }

    setIsSpareReplacing(true)
    try {
      const damagePhoto = await uploadPodImage(spareDamagePhotoFile)
      const response = await fetch('/api/driver/replacements/from-spare-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: trip.id,
          dropPointId: targetDropPoint.id,
          orderItemId: selectedItem.id,
          quantity: spareQuantity,
          reason: spareReason.trim(),
          damagePhoto,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to process spare stock replacement')
      }
      toast.success(
        `Spare stock replacement completed. Remaining stock: ${Number(payload?.remainingSpareStock ?? 0)}`
      )
      closeSpareReplacement()
      await onRefreshTrips()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to process spare stock replacement')
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
      handlePodFileChange(file)
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
      stopCameraStream()
    }
  }, [podImagePreview])

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
      <div className="bg-gradient-to-r from-teal-700 via-cyan-700 to-sky-700 p-4 text-white">
        <Button variant="ghost" size="sm" className="mb-2 p-0 text-white hover:bg-cyan-700/40" onClick={onBack}>
          &lt; Back to Trips
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{trip.tripNumber}</h2>
            <p className="text-cyan-100 text-sm">{trip.vehicle?.licensePlate}</p>
          </div>
          <Badge className="bg-white text-cyan-800">
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
            className="h-12 w-full gap-2 bg-teal-700 text-lg text-white hover:bg-teal-800" 
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

      {/* Map Placeholder */}
      <div className="mx-4 mt-4">
        <div className="relative flex h-48 items-center justify-center rounded-2xl border border-cyan-200/70 bg-gradient-to-br from-cyan-100 to-sky-100">
          <div className="text-center">
            <MapPin className="h-10 w-10 text-cyan-500 mx-auto mb-2" />
            <p className="text-cyan-700 text-sm">Route Map</p>
          </div>
          {isTracking && currentLocation && (
            <div className="absolute bottom-2 left-2 bg-white px-2 py-1 rounded text-xs text-slate-700">
              <Navigation className="inline h-3 w-3 mr-1 text-emerald-500" />
              Tracking active
            </div>
          )}
        </div>
      </div>

      {/* Drop Points List */}
      <div className="p-4">
        <h3 className="mb-3 font-semibold text-slate-900">Drop Points</h3>
        <p className="mb-2 text-xs text-slate-500">Tap a stop card to show its action buttons.</p>
        <div className="space-y-3">
          {trip.dropPoints?.sort((a, b) => a.sequence - b.sequence).map((dropPoint) => (
            <Card 
              key={dropPoint.id} 
              className={`cursor-pointer rounded-2xl border-cyan-100 shadow-sm shadow-cyan-100/50 transition-all ${activeDropPoint?.id === dropPoint.id ? 'ring-2 ring-cyan-500' : ''}`}
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
                            <p className="mt-1 text-xs text-cyan-700">{dropPoint.order.orderNumber}</p>
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
                      <a href={`tel:${dropPoint.contactPhone}`} className="mt-2 inline-flex items-center gap-1 text-sm text-cyan-700">
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
                              openCameraCapture()
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
                              Replace from Spare Stock
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
                                openCameraCapture()
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
            <DialogTitle>Capture POD Photo</DialogTitle>
            <DialogDescription>Take a clear photo of the delivered package/recipient.</DialogDescription>
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
                  openCameraCapture()
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
            <DialogTitle>Replace from Spare Stock</DialogTitle>
            <DialogDescription>
              Immediate same-stop replacement using driver spare stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="spare-order-item">Order Item</Label>
              <select
                id="spare-order-item"
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
              <Label htmlFor="spare-qty">Replacement Quantity</Label>
              <Input
                id="spare-qty"
                type="number"
                min={1}
                value={spareQuantity}
                onChange={(e) => setSpareQuantity(Number(e.target.value || 1))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spare-reason">Damage Reason</Label>
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
                <Input
                  id="spare-photo-camera"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleSpareDamagePhotoChange(e.target.files?.[0] || null)}
                />
                <Input
                  id="spare-photo"
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleSpareDamagePhotoChange(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-slate-500">
                  Use camera to take damage photo, or upload from gallery.
                </p>
                {spareDamagePhotoFile ? (
                  <p className="text-xs text-emerald-700">Selected: {spareDamagePhotoFile.name}</p>
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
                Confirm Replacement
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// History View
function HistoryView() {
  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">Delivery History</h2>

      <Card>
        <CardContent className="py-12 text-center">
          <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No delivery history yet</p>
          <p className="text-sm text-gray-400 mt-1">Completed deliveries will appear here</p>
        </CardContent>
      </Card>
    </div>
  )
}

// Profile View
function ProfileView({ user }: { user: any }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    licenseNumber: '',
    licenseType: '',
  })
  const [draft, setDraft] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
  })

  useEffect(() => {
    async function fetchProfile() {
      try {
        const response = await fetch('/api/driver/profile')
        if (!response.ok) throw new Error('Failed to load profile')
        const payload = await response.json()
        const profile = payload?.profile
        setForm({
          name: profile?.user?.name || user?.name || '',
          email: profile?.user?.email || user?.email || '',
          phone: profile?.phone || profile?.user?.phone || '',
          address: profile?.address || '',
          city: profile?.city || '',
          state: profile?.state || '',
          zipCode: profile?.zipCode || '',
          licenseNumber: profile?.licenseNumber || '',
          licenseType: profile?.licenseType || '',
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

  const openEdit = () => {
    setDraft({
      name: form.name,
      phone: form.phone,
      address: form.address,
      city: form.city,
      state: form.state,
      zipCode: form.zipCode,
    })
    setEditOpen(true)
  }

  const onSave = async () => {
    if (!draft.name.trim()) {
      toast.error('Name is required')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/driver/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          phone: draft.phone,
          address: draft.address,
          city: draft.city,
          state: draft.state,
          zipCode: draft.zipCode,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }
      setForm((prev) => ({
        ...prev,
        name: draft.name,
        phone: draft.phone,
        address: draft.address,
        city: draft.city,
        state: draft.state,
        zipCode: draft.zipCode,
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
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Address</p>
                  <p className="text-sm font-medium text-gray-900 text-right">{form.address || 'N/A'}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">City / State / Zip</p>
                  <p className="text-sm font-medium text-gray-900 text-right">
                    {[form.city, form.state, form.zipCode].filter(Boolean).join(', ') || 'N/A'}
                  </p>
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
            <DialogDescription>Update your personal and contact details.</DialogDescription>
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

            <div className="space-y-2">
              <Label htmlFor="driver-address">Address</Label>
              <Input id="driver-address" value={draft.address} onChange={(e) => onChange('address', e.target.value)} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label htmlFor="driver-city">City</Label>
                <Input id="driver-city" value={draft.city} onChange={(e) => onChange('city', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver-state">State</Label>
                <Input id="driver-state" value={draft.state} onChange={(e) => onChange('state', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver-zip">Zip</Label>
                <Input id="driver-zip" value={draft.zipCode} onChange={(e) => onChange('zipCode', e.target.value)} />
              </div>
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
    </div>
  )
}
