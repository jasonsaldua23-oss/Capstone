'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useAuth } from '@/app/page'
import { toast } from 'sonner'
import { HistoryView } from './sections/history/history-view'
import { HomeView } from './sections/home/home-view'
import { DriverBottomNav } from './sections/layout/bottom-nav'
import { DriverNativeCameraGateDialog } from './sections/layout/native-camera-gate-dialog'
import { portalFont } from '../portal-font'
import { DriverPortalHeader } from './sections/layout/portal-header'
import { useDriverPortalState } from './sections/layout/portal-state'
import { ProfileView } from './sections/profile/profile-view'
import { TripDetailView } from './sections/trips/trip-detail-view'
import { TripsListView } from './sections/trips/trips-list-view'
import { useIsMobile } from '@/hooks/use-mobile'
import { PullToRefresh } from '../shared/pull-to-refresh'

// Driver portal shell: delegates business logic to hook and section components.
export function DriverPortal() {
  const { user, logout } = useAuth()
  const isMobileViewport = useIsMobile()
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
    fetchTrips,
    applyTripUpdate,
    enforceNativeCameraPermission,
    startLocationTracking,
    openNativeCameraAppSettings,
  } = useDriverPortalState()
  const [headerUnreadCount, setHeaderUnreadCount] = useState(0)
  // Fix: the bell must refresh even before the notification/profile page mounts.
  useEffect(() => {
    let disposed = false
    const refreshUnread = async () => {
      try {
        const response = await fetch('/api/notifications', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json()
        if (!disposed) setHeaderUnreadCount(Number(payload.unreadCount) || 0)
      } catch { /* Preserve the last known count during a temporary outage. */ }
    }
    void refreshUnread()
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshUnread() }, 15000)
    window.addEventListener('focus', refreshUnread)
    return () => { disposed = true; window.clearInterval(interval); window.removeEventListener('focus', refreshUnread) }
  }, [user?.id])
  // Fix: notification navigation affects rendering, so keep it in state.
  const [notificationInitialView, setNotificationInitialView] = useState<'real-notifications' | 'menu'>('menu')
  const [profileViewKey, setProfileViewKey] = useState(0)
  const isTripDetailOpen = activeView === 'trips' && Boolean(selectedTripId)
  const hidePortalHeader = isMobileViewport && isTripDetailOpen

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
  }

  useEffect(() => {
    const previousTitle = document.title
    const faviconSelectors = ['link[rel="icon"]', 'link[rel="shortcut icon"]', 'link[rel="apple-touch-icon"]']
    const previousIcons = faviconSelectors.map((selector) => {
      const node = document.head.querySelector(selector) as HTMLLinkElement | null
      return node ? { selector, href: node.href } : { selector, href: '' }
    })

    document.title = 'AAB TRADING DRIVER'
    faviconSelectors.forEach((selector) => {
      const node = document.head.querySelector(selector) as HTMLLinkElement | null
      if (node) node.href = '/aab-trading-driver.png'
    })

    return () => {
      document.title = previousTitle
      previousIcons.forEach(({ selector, href }) => {
        const node = document.head.querySelector(selector) as HTMLLinkElement | null
        if (node && href) node.href = href
      })
    }
  }, [])

  return (
    // Full-viewport container with shared portal background treatment.
    <div className={`${portalFont.className} min-h-[100dvh] bg-[#eef2f7]`}>
      <div className="relative w-full h-[100dvh] flex flex-col overflow-hidden bg-transparent">
        {/* Header handles top-level navigation shortcuts and logout */}
        {!hidePortalHeader ? (
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
            onOpenNotifications={() => {
              setNotificationInitialView('real-notifications')
              setProfileViewKey((k) => k + 1)
              setActiveView('profile')
            }}
            unreadCount={headerUnreadCount}
          />
        ) : null}

        <div className="flex min-h-0 flex-1">
          {!(activeView === 'trips' && selectedTripId) ? (
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
          ) : null}
          <PullToRefresh
            onRefresh={() => window.location.reload()}
            disabled={activeView === 'trips' && Boolean(selectedTripId)}
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
              className={`min-h-0 w-full ${
                activeView === 'trips' && selectedTripId ? 'px-0 md:px-6' : 'px-4 md:px-6'
              } ${
                activeView === 'trips' && selectedTripId ? 'pb-0 md:pb-4' : 'pb-24 md:pb-8'
              } ${activeView === 'trips' ? 'pt-0 md:pt-0' : 'pt-4 md:pt-6'} ${
                activeView === 'trips' && selectedTripId ? 'flex flex-1 flex-col overflow-hidden' : 'flex-1'
              }`}
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
                    // Fix: the dashboard action must navigate to the driver's trip list.
                    setActiveView('trips')
                    setSelectedTripId(null)
                  }}
                  onOpenActiveTrip={(trip) => {
                    setActiveView('trips')
                    setSelectedTripId(trip.id)
                  }}
                  onStartTracking={startLocationTracking}
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
                    driverUser={user}
                    onBack={() => setSelectedTripId(null)}
                    onTripCompleted={() => {
                      // A closed trip leaves the driver on the dashboard, not on a
                      // trip screen that no longer has anything to act on.
                      setSelectedTripId(null)
                      setActiveView('home')
                    }}
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

              {activeView === 'profile' && (
                <ProfileView
                  key={profileViewKey}
                  user={user}
                  onLogout={handleLogout}
                  initialSubView={notificationInitialView}
                  onUnreadCountChange={(count) => setHeaderUnreadCount(count)}
                  onDidMount={() => { setNotificationInitialView('menu') }}
                  onNavigateNotification={(n) => {
                    const refType = String(n?.referenceType || n?.reference_type || '').toLowerCase()
                    const refId = String(n?.referenceId || n?.reference_id || '').trim()
                    const notifType = String(n?.type || '').toUpperCase()
                    const title = String(n?.title || '').toLowerCase()
                    const message = String(n?.message || '').toLowerCase()

                    if (title.includes('completed') || title.includes('history') || message.includes('completed')) {
                      setActiveView('history')
                      return
                    }

                    if (refType === 'trip' || notifType === 'TRIP' || title.includes('trip') || message.includes('trip') || title.includes('assigned')) {
                      const matched = trips.find((t) => t.id === refId || t.tripNumber === refId)
                      if (matched) {
                        setSelectedTripId(matched.id)
                      } else if (refId) {
                        setSelectedTripId(refId)
                      }
                      setActiveView('trips')
                      return
                    }

                    setActiveView('trips')
                  }}
                />
              )}
            </motion.main>
          </AnimatePresence>
          </PullToRefresh>
        </div>

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
