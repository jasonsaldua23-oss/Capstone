'use client'

import { useState, useEffect, createContext, useContext, Component, ErrorInfo, ReactNode, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { AdminPortal, CustomerPortal, DriverPortal, WarehousePortal } from '@/components/portals'
import { clearTabAuthToken, hasPersistentTabAuthToken, installTabAuthFetchInterceptor } from '@/lib/client-auth'
import { getAllowedPortals, getDefaultPortalForVariant, resolveAppVariant } from '@/lib/app-variant'
import type { AuthUser, PortalType } from '@/types'
import { AlertTriangle } from 'lucide-react'
import { PushNotificationManager } from '@/components/shared/push-notification-manager'

// Auth Context
interface AuthContextType {
  user: AuthUser | null
  setUser: Dispatch<SetStateAction<AuthUser | null>>
  logout: () => Promise<void>
  isLoading: boolean
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

// Portal Context
interface PortalContextType {
  portal: PortalType
  setPortal: (portal: PortalType) => void
}

export const PortalContext = createContext<PortalContextType | null>(null)

export function usePortal() {
  const context = useContext(PortalContext)
  if (!context) {
    throw new Error('usePortal must be used within PortalProvider')
  }
  return context
}

// Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
})

const DEFAULT_BRAND_TITLE = "Ann Ann's Beverages Trading"
const DEFAULT_BRAND_ICON = '/ann-anns-logo.png'

function applyBrowserBranding(title: string, iconPath: string) {
  if (typeof document === 'undefined') return
  document.title = title

  const iconSelectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ]

  iconSelectors.forEach((selector) => {
    let link = document.head.querySelector(selector) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      if (selector.includes('apple-touch-icon')) {
        link.rel = 'apple-touch-icon'
      } else if (selector.includes('shortcut icon')) {
        link.rel = 'shortcut icon'
      } else {
        link.rel = 'icon'
      }
      document.head.appendChild(link)
    }
    link.href = iconPath
  })
}

interface PortalErrorBoundaryProps {
  children: ReactNode
  onRecover: () => void
}

interface PortalErrorBoundaryState {
  hasError: boolean
}

class PortalErrorBoundary extends Component<PortalErrorBoundaryProps, PortalErrorBoundaryState> {
  constructor(props: PortalErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Portal render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center px-4">
          <div className="max-w-md w-full bg-white rounded-xl p-6 shadow-xl text-center">
            <h2 className="text-xl font-semibold mb-2">Portal failed to load</h2>
            <p className="text-sm text-gray-600 mb-5">
              We hit a runtime error while rendering your portal. Return to the login page and continue.
            </p>
            <button
              onClick={this.props.onRecover}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              type="button"
            >
              Return to Login
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function resolvePortalForUser(user: AuthUser): PortalType {
  if (user.type === 'staff' && user.role === 'DRIVER') {
    return 'driver'
  }

  if (user.type === 'staff' && ['WAREHOUSE', 'WAREHOUSE_STAFF', 'INVENTORY_MANAGER'].includes(user.role)) {
    return 'warehouse'
  }

  if (user.type === 'customer') {
    return 'customer'
  }

  return 'admin'
}

export default function Home() {
  const router = useRouter()
  const appVariant = useMemo(() => resolveAppVariant(), [])
  const allowedPortals = useMemo(() => getAllowedPortals(appVariant), [appVariant])
  const defaultPortal = useMemo(() => getDefaultPortalForVariant(appVariant), [appVariant])
  const [user, setUser] = useState<AuthUser | null>(null)
  const [portal, setPortal] = useState<PortalType>(defaultPortal)
  const [isLoading, setIsLoading] = useState(true)
  const [isMounted, setIsMounted] = useState(false)
  const [sessionExpiredPortal, setSessionExpiredPortal] = useState<PortalType | null>(null)
  const sessionTimerRef = useRef<number | null>(null)
  const DRIVER_ACTIVITY_EVENT = 'aab:driver-activity'
  const getPortalLoginPath = (targetPortal: PortalType) => `/login/${targetPortal}`

  // Check for existing session on mount
  useEffect(() => {
    setIsMounted(true)
    const uninstallFetchInterceptor = installTabAuthFetchInterceptor()

    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          if (data.user) {
            const userPortal = resolvePortalForUser(data.user)
            if (!allowedPortals.includes(userPortal)) {
              await fetch('/api/auth/logout', { method: 'POST' })
              clearTabAuthToken()
              setUser(null)
              setPortal(defaultPortal)
              return
            }
            setUser(data.user)
            setPortal(userPortal)
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error)
      } finally {
        setIsLoading(false)
      }
    }
    checkAuth()
    
    return () => {
      uninstallFetchInterceptor()
    }
  }, [allowedPortals, defaultPortal])

  useEffect(() => {
    if (!isLoading && isMounted && !user) {
      // A shared deployment must not silently treat Admin as the default user.
      router.replace(appVariant === 'all' ? '/login' : getPortalLoginPath(portal))
    }
  }, [appVariant, isLoading, isMounted, portal, router, user])

  useEffect(() => {
    if (!isMounted) return

    if (!user) {
      applyBrowserBranding(DEFAULT_BRAND_TITLE, DEFAULT_BRAND_ICON)
      return
    }

    if (portal === 'customer') {
      applyBrowserBranding('AAB TRADING SHOP', '/aab-trading-shop.png')
      return
    }

    if (portal === 'driver') {
      applyBrowserBranding('AAB TRADING DRIVER', '/aab-trading-driver.png')
      return
    }

    applyBrowserBranding(DEFAULT_BRAND_TITLE, DEFAULT_BRAND_ICON)
  }, [isMounted, portal, user])

  useEffect(() => {
    if (!isMounted || !user) {
      if (sessionTimerRef.current) {
        window.clearTimeout(sessionTimerRef.current)
        sessionTimerRef.current = null
      }
      return
    }

    // Keep-me-logged-in sessions are governed by the JWT's exact 30-day expiry.
    // Do not shorten them with the normal staff inactivity timeout.
    if (user.rememberMe === true || hasPersistentTabAuthToken()) {
      if (sessionTimerRef.current) {
        window.clearTimeout(sessionTimerRef.current)
        sessionTimerRef.current = null
      }
      return
    }

    const configuredMinutes = Number(user.sessionTimeoutMinutes ?? 30)
    const timeoutMinutes = Number.isFinite(configuredMinutes) ? Math.max(5, Math.floor(configuredMinutes)) : 30
    const timeoutMs = timeoutMinutes * 60 * 1000

    const restartSessionTimer = () => {
      if (sessionExpiredPortal) return
      if (sessionTimerRef.current) window.clearTimeout(sessionTimerRef.current)
      sessionTimerRef.current = window.setTimeout(() => {
        const targetPortal = portal
        setSessionExpiredPortal(targetPortal)
        clearTabAuthToken()
        queryClient.clear()
        void fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch((error) => {
          console.error('Logout background request failed:', error)
        })
      }, timeoutMs)
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ]

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, restartSessionTimer, { passive: true })
    })
    window.addEventListener('focus', restartSessionTimer)
    const onDriverTrackingActivity = () => {
      if (portal === 'driver' && user) {
        restartSessionTimer()
      }
    }
    window.addEventListener(DRIVER_ACTIVITY_EVENT, onDriverTrackingActivity)
    restartSessionTimer()

    return () => {
      if (sessionTimerRef.current) {
        window.clearTimeout(sessionTimerRef.current)
        sessionTimerRef.current = null
      }
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, restartSessionTimer)
      })
      window.removeEventListener('focus', restartSessionTimer)
      window.removeEventListener(DRIVER_ACTIVITY_EVENT, onDriverTrackingActivity)
    }
  }, [isMounted, user, portal, sessionExpiredPortal])

  const logoutToPortal = (targetPortal: PortalType) => {
    const nextPortal = allowedPortals.includes(targetPortal) ? targetPortal : defaultPortal
    setSessionExpiredPortal(null)
    clearTabAuthToken()
    queryClient.clear()
    setUser(null)
    setPortal(nextPortal)
    setIsLoading(false)
    router.replace(getPortalLoginPath(nextPortal))

    // Best-effort cookie cleanup; do not block UI logout flow.
    void fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch((error) => {
      console.error('Logout background request failed:', error)
    })
  }

  const logout = async () => {
    logoutToPortal(portal)
  }

  const recoverToLogin = async () => {
    logoutToPortal(portal)
  }

  // Loading state
  if (isLoading && isMounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated - redirect to dedicated portal login
  if (!user) {
    return null
  }

  // Authenticated - show appropriate portal
  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, setUser, logout, isLoading }}>
        <PortalContext.Provider value={{ portal, setPortal }}>
          <Toaster position="top-right" />
          {/* Added once here so every authenticated portal can register its device. */}
          <PushNotificationManager user={user} />
          <PortalErrorBoundary onRecover={recoverToLogin}>
            {portal === 'admin' && <AdminPortal />}
            {portal === 'driver' && <DriverPortal />}
            {portal === 'customer' && <CustomerPortal />}
            {portal === 'warehouse' && <WarehousePortal />}
            {sessionExpiredPortal ? (
              <div className="fixed inset-0 z-[120] grid place-items-center bg-black/55 px-4 backdrop-blur-[2px]">
                <div className="w-full max-w-[32rem] rounded-2xl border border-blue-200 bg-gradient-to-b from-[#f2f8ff] via-white to-[#edf5ff] px-5 py-5 shadow-[0_20px_56px_rgba(0,0,0,0.35)]">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-blue-700" />
                        <p className="text-[1.1rem] font-semibold leading-tight text-slate-900">Your session has expired</p>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">Please log in again to continue using the system.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => logoutToPortal(sessionExpiredPortal)}
                      className="shrink-0 rounded-xl bg-blue-600 px-5 py-2.5 text-base font-semibold text-white hover:bg-blue-500"
                    >
                      Log in
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </PortalErrorBoundary>
        </PortalContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}
