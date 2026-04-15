'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PortalType } from '@/types'

interface AuthUser {
  id: string
  userId?: string
  email: string
  name: string
  avatar?: string | null
  role: string
  type: 'staff' | 'customer'
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  currentPortal: PortalType
  isLoading: boolean
  
  setUser: (user: AuthUser | null) => void
  logout: () => void
  setPortal: (portal: PortalType) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      currentPortal: 'admin',
      isLoading: true,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
          isLoading: false,
        }),

      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      setPortal: (portal) =>
        set({
          currentPortal: portal,
        }),

      setLoading: (loading) =>
        set({
          isLoading: loading,
        }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        currentPortal: state.currentPortal,
      }),
    }
  )
)
