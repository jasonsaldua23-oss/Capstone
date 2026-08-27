'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export type WarehouseView =
  | 'dashboard'
  | 'retailPos'
  | 'purchaseRequests'
  | 'orders'
  | 'trips'
  | 'replacements'
  | 'liveTracking'
  | 'inventory'
  | 'warehouses'
  | 'transactions'
  | 'settings'

export interface PortalNotification {
  id: string
  title: string
  message: string
  type: string | null
  referenceType: string | null
  referenceId: string | null
  isRead: boolean
  createdAt: string
}

export function useWarehousePortalLayoutState({ logout }: { logout: () => Promise<void> }) {
  const [activeView, setActiveView] = useState<WarehouseView>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)

  const handleLogout = useCallback(async () => {
    await logout()
    toast.success('Logged out')
  }, [logout])

  const fetchNotifications = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setNotificationsLoading(true)
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      if (!response.ok) return null

      const payload = await response.json().catch(() => ({}))
      const list = Array.isArray(payload?.notifications) ? payload.notifications : []
      const unreadCount = Number(payload?.unreadCount || 0)
      setNotifications(list)
      setUnreadNotifications(unreadCount)
      return unreadCount
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
      return null
    } finally {
      if (!options?.silent) setNotificationsLoading(false)
    }
  }, [])

  const markAllNotificationsAsRead = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      })
      if (!response.ok) return
      setUnreadNotifications(0)
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })))
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }, [])

  const clearAllNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
      })
      if (!response.ok) return false
      setNotifications([])
      setUnreadNotifications(0)
      return true
    } catch (error) {
      console.error('Failed to clear notifications:', error)
      return false
    }
  }, [])

  const handleNotificationsOpen = useCallback(async (open: boolean) => {
    if (!open) return
    const currentUnreadCount = await fetchNotifications()
    if (currentUnreadCount && currentUnreadCount > 0) {
      await markAllNotificationsAsRead()
    }
  }, [fetchNotifications, markAllNotificationsAsRead])

  const formatNotificationTime = useCallback((createdAt: string) => {
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString()
  }, [])

  useEffect(() => {
    void fetchNotifications()

    // Added: poll quietly so the bell shows new cross-device order and replacement alerts.
    const refreshNotifications = () => {
      if (document.visibilityState === 'visible') void fetchNotifications({ silent: true })
    }
    const intervalId = window.setInterval(refreshNotifications, 15000)
    window.addEventListener('focus', refreshNotifications)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshNotifications)
    }
  }, [fetchNotifications])

  return {
    activeView,
    setActiveView,
    sidebarOpen,
    setSidebarOpen,
    notifications,
    notificationsLoading,
    unreadNotifications,
    handleNotificationsOpen,
    clearAllNotifications,
    formatNotificationTime,
    handleLogout,
  }
}
