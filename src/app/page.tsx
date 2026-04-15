'use client'

import { useState, useEffect, createContext, useContext, Component, ErrorInfo, ReactNode, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { AdminPortal } from '@/components/portals/AdminPortal'
import { DriverPortal } from '@/components/portals/DriverPortal'
import { CustomerPortal } from '@/components/portals/CustomerPortal'
import { WarehousePortal } from '@/components/portals/WarehousePortal'
import { clearTabAuthToken, installTabAuthFetchInterceptor } from '@/lib/client-auth'
import { getAllowedPortals, getDefaultPortalForVariant, resolveAppVariant } from '@/lib/app-variant'
import type { AuthUser, PortalType } from '@/types'

// Auth Context
interface AuthContextType {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
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
  const getPortalLoginPath = (targetPortal: PortalType) => `/login/${targetPortal}`

  // Check for existing session on mount
  useEffect(() => {
    setIsMounted(true)
    const uninstallFetchInterceptor = installTabAuthFetchInterceptor()

    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/me')
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
    
    // Timeout to force loading to end after 5 seconds
    const timeout = setTimeout(() => {
      console.warn('Auth check timeout - forcing load completion')
      setIsLoading(false)
    }, 5000)
    
    return () => {
      clearTimeout(timeout)
      uninstallFetchInterceptor()
    }
  }, [allowedPortals, defaultPortal])

  useEffect(() => {
    if (!isLoading && isMounted && !user) {
      router.replace(getPortalLoginPath(portal))
    }
  }, [isLoading, isMounted, portal, router, user])

  const logout = async () => {
    const targetPortal = portal
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      clearTabAuthToken()
      // Always clear local auth state so the UI returns to the login screen.
      setUser(null)
      setPortal(allowedPortals.includes(targetPortal) ? targetPortal : defaultPortal)
      setIsLoading(false)
      const nextPortal = allowedPortals.includes(targetPortal) ? targetPortal : defaultPortal
      router.replace(getPortalLoginPath(nextPortal))
    }
  }

  const recoverToLogin = async () => {
    const targetPortal = portal
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      console.error('Recover logout failed:', error)
    } finally {
      clearTabAuthToken()
      setUser(null)
      setPortal(allowedPortals.includes(targetPortal) ? targetPortal : defaultPortal)
      setIsLoading(false)
      const nextPortal = allowedPortals.includes(targetPortal) ? targetPortal : defaultPortal
      router.replace(getPortalLoginPath(nextPortal))
    }
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    )
  }

  // Authenticated - show appropriate portal
  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, setUser, logout, isLoading }}>
        <PortalContext.Provider value={{ portal, setPortal }}>
          <Toaster position="top-right" />
          <PortalErrorBoundary onRecover={recoverToLogin}>
            {portal === 'admin' && <AdminPortal />}
            {portal === 'driver' && <DriverPortal />}
            {portal === 'customer' && <CustomerPortal />}
            {portal === 'warehouse' && <WarehousePortal />}
          </PortalErrorBoundary>
        </PortalContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}
