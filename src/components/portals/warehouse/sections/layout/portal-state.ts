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

  const fetchNotifications = useCallback(async () => {
    setNotificationsLoading(true)
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      if (!response.ok) return

      const payload = await response.json()
      const list = Array.isArray(payload?.notifications) ? payload.notifications : []
      setNotifications(list)
      setUnreadNotifications(Number(payload?.unreadCount || 0))
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setNotificationsLoading(false)
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
    await fetchNotifications()
    if (unreadNotifications > 0) {
      await markAllNotificationsAsRead()
    }
  }, [fetchNotifications, markAllNotificationsAsRead, unreadNotifications])

  const formatNotificationTime = useCallback((createdAt: string) => {
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString()
  }, [])

  useEffect(() => {
    void fetchNotifications()
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
