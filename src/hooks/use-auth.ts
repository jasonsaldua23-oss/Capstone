'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

export function useAuth() {
  const { user, isAuthenticated, isLoading, setUser, logout, setPortal, currentPortal } = useAuthStore()
  const router = useRouter()

  const login = useCallback(async (email: string, password: string, portal: 'admin' | 'driver' | 'customer') => {
    try {
      const endpoint = portal === 'customer' ? '/api/auth/customer/login' : '/api/auth/login'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, portal }),
      })

      const rawBody = await response.text()
      let data: any = null
      try {
        data = rawBody ? JSON.parse(rawBody) : null
      } catch {
        data = null
      }

      if (data.success && data.user) {
        setUser(data.user)
        setPortal(portal)
        return { success: true }
      }

      const apiError = String(data?.error || data?.message || '').trim()
      const fallbackError = response.status >= 500
        ? 'Login service is temporarily unavailable. Please try again shortly.'
        : 'Login failed'
      return { success: false, error: apiError || fallbackError }
    } catch (error) {
      return { success: false, error: 'Unable to reach login service. Please check your connection and try again.' }
    }
  }, [setUser, setPortal])

  const logoutUser = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      logout()
      router.push('/')
    }
  }, [logout, router])

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me')
      const data = await response.json()

      if (data.success && data.user) {
        setUser(data.user)
        if (data.user.type === 'customer') {
          setPortal('customer')
        } else if (data.user.role === 'DRIVER') {
          setPortal('driver')
        } else {
          setPortal('admin')
        }
      } else {
        setUser(null)
      }
    } catch (error) {
      setUser(null)
    }
  }, [setUser, setPortal])

  return {
    user,
    isAuthenticated,
    isLoading,
    currentPortal,
    login,
    logout: logoutUser,
    checkAuth,
    setPortal,
  }
}

export function useRequireAuth(allowedRoles?: string[]) {
  const { user, isAuthenticated, isLoading, checkAuth, logout } = useAuth()
  const router = useRouter()

  const hasAccess = useCallback(() => {
    if (!isAuthenticated || !user) return false
    if (!allowedRoles) return true
    return allowedRoles.includes(user.role)
  }, [isAuthenticated, user, allowedRoles])

  return {
    user,
    isAuthenticated,
    isLoading,
    hasAccess: hasAccess(),
    checkAuth,
    logout,
  }
}
