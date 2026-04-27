'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Poppins } from 'next/font/google'
import { useAuth } from '@/app/page'
import { toast } from 'sonner'
import { HistoryView } from './sections/history/history-view'
import { HomeView } from './sections/home/home-view'
import { DriverBottomNav } from './sections/layout/bottom-nav'
import { DriverNativeCameraGateDialog } from './sections/layout/native-camera-gate-dialog'
import { DriverPortalHeader } from './sections/layout/portal-header'
import { useDriverPortalState } from './sections/layout/portal-state'
import { ProfileView } from './sections/profile/profile-view'
import { TripDetailView } from './sections/trips/trip-detail-view'
import { TripsListView } from './sections/trips/trips-list-view'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

// Driver portal shell: delegates business logic to hook and section components.
export function DriverPortal() {
  const { user, logout } = useAuth()
  const {
    activeView,
    setActiveView,
    trips,
    selectedTripId,
    setSelectedTripId,
    isLoading,
    locationPermission,
    currentLocation,
    isTracking,
    isNativeCameraGateOpen,
    nativeCameraGateMessage,
    isCheckingNativeCameraPermission,
    loadingOrderId,
    fetchTrips,
    applyTripUpdate,
    markOrderLoaded,
    enforceNativeCameraPermission,
    startLocationTracking,
    openNativeCameraAppSettings,
  } = useDriverPortalState()

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
  }

  return (
    // Full-viewport container with shared portal background treatment.
    <div className={`${poppins.className} min-h-[100dvh] bg-[#dff0ea] md:bg-[#dceff0]`}>
      <div className="relative w-full h-[100dvh] flex flex-col overflow-hidden bg-transparent">
        {/* Decorative background glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-20 h-56 w-56 rounded-full bg-sky-200/45 blur-3xl" />
          <div className="absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-emerald-200/45 blur-3xl" />
        </div>

        {/* Header handles top-level navigation shortcuts and logout */}
        <DriverPortalHeader
          isTracking={isTracking}
          onOpenHome={() => {
            setActiveView('home')
            setSelectedTripId(null)
          }}
          onOpenTrips={() => {
            setActiveView('trips')
            setSelectedTripId(null)
          }}
          onOpenProfile={() => setActiveView('profile')}
          onLogout={handleLogout}
        />

        <div
          className={`flex min-h-0 flex-1 flex-col overflow-x-hidden ${activeView === 'trips' && selectedTripId ? 'overflow-y-hidden' : 'overflow-y-auto'}`}
        >
          {/* Route-like animated transitions between views */}
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
                // Home summary/dashboard card stack.
                <HomeView
                  user={user}
                  trips={trips}
                  isLoading={isLoading}
                  isTracking={isTracking}
                  locationPermission={locationPermission}
                  currentLocation={currentLocation}
                  onOpenTrips={() => {
                    setActiveView('trips')
                    setSelectedTripId(null)
                  }}
                  onOpenActiveTrip={(trip) => {
                    setActiveView('trips')
                    setSelectedTripId(trip.id)
                  }}
                  onStartTracking={startLocationTracking}
                  loadingOrderId={loadingOrderId}
                  onMarkOrderLoaded={markOrderLoaded}
                />
              )}

              {activeView === 'trips' && !selectedTripId && (
                // Trips list when no specific trip is selected.
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
                  // Detailed operational workflow for one selected trip.
                  <TripDetailView
                    trip={selectedTrip}
                    onBack={() => setSelectedTripId(null)}
                    locationPermission={locationPermission}
                    onStartTracking={startLocationTracking}
                    onRefreshTrips={() => fetchTrips(true)}
                    onApplyTripUpdate={(updater) => applyTripUpdate(selectedTrip.id, updater)}
                    isTracking={isTracking}
                    currentLocation={currentLocation}
                  />
                )
              })()}

              {activeView === 'history' && (
                // Completed trip history.
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

        {/* Persistent bottom nav for primary driver sections */}
        <DriverBottomNav
          activeView={activeView}
          onOpenHome={() => {
            setActiveView('home')
            setSelectedTripId(null)
          }}
          onOpenTrips={() => {
            setActiveView('trips')
            setSelectedTripId(null)
          }}
          onOpenHistory={() => setActiveView('history')}
          onOpenProfile={() => setActiveView('profile')}
        />

        {/* Blocking dialog used when native camera permission is required */}
        <DriverNativeCameraGateDialog
          open={isNativeCameraGateOpen}
          message={nativeCameraGateMessage}
          isChecking={isCheckingNativeCameraPermission}
          onOpenAppSettings={() => {
            void openNativeCameraAppSettings()
          }}
          onRetry={() => {
            void enforceNativeCameraPermission()
          }}
        />
      </div>
    </div>
  )
}
