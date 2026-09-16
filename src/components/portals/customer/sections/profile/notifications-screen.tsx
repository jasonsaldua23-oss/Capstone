'use client'

import { type NotificationPrefs, timeAgo } from './profile-shared'
import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Bell, ChevronRight, Loader2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

/**
 * The customer's in-app notification list.
 */
export type NotificationsScreenProps = {
  clearAllNotifications: () => Promise<void>
  fetchRealNotifications: () => Promise<void>
  isLoadingNotifications: boolean
  markAllAsRead: () => Promise<void>
  notifications: NotificationPrefs
  onNavigateNotification: ((notification: any) => void) | undefined
  onUnreadCountChange: ((count: number) => void) | undefined
  realNotifications: any[]
  setRealNotifications: Dispatch<SetStateAction<any[]>>
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
  setUnreadCount: Dispatch<SetStateAction<number>>
  unreadCount: number
}

export function NotificationsScreen({
  clearAllNotifications,
  fetchRealNotifications,
  isLoadingNotifications,
  markAllAsRead,
  notifications,
  onNavigateNotification,
  onUnreadCountChange,
  realNotifications,
  setRealNotifications,
  setSubView,
  setUnreadCount,
  unreadCount,
}: NotificationsScreenProps) {
  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
      <div className="flex items-center justify-between px-4 pt-5 pb-1">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => {
              setSubView('menu')
              fetchRealNotifications()
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Notifications</h2>
        </div>
        {realNotifications.length > 0 && (
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs font-bold text-[#14532d] hover:underline"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={clearAllNotifications}
              className="text-xs font-bold text-red-600 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {isLoadingNotifications ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#14532d]" />
          <p className="text-sm font-medium text-slate-400">Loading notifications...</p>
        </div>
      ) : realNotifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="h-16 w-16 rounded-full bg-emerald-50 text-[#14532d] grid place-items-center mb-4">
            <Bell className="h-8 w-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800">All caught up!</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
            No new alerts right now. We will notify you when something important occurs.
          </p>
        </div>
      ) : (
        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          {realNotifications.map((n, idx) => {
            const handleItemClick = async () => {
              if (!n.isRead) {
                // Fix: only acknowledge an alert after its read status is persisted.
                try {
                  const response = await fetch('/api/notifications', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [n.id] }),
                  })
                  if (!response.ok) throw new Error('Unable to mark notification as read')
                  const payload = await response.json()
                  setUnreadCount(Number(payload.unreadCount) || 0)
                  onUnreadCountChange?.(Number(payload.unreadCount) || 0)
                } catch {
                  toast.error('Unable to mark notification as read. Please try again.')
                  return
                }
                setRealNotifications((prev) =>
                  prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item))
                )
              }
              if (onNavigateNotification) {
                onNavigateNotification(n)
              }
            }

            return (
              <div
                key={n.id || idx}
                role="button"
                tabIndex={0}
                onClick={handleItemClick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleItemClick()
                  }
                }}
                className={`group flex items-center gap-3 px-4 py-4 cursor-pointer select-none transition-all hover:bg-emerald-50/70 active:scale-[0.99] ${
                  !n.isRead ? 'bg-[#f4faf6]' : 'bg-white'
                } ${idx < realNotifications.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <div className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                  !n.isRead ? 'bg-emerald-100 text-emerald-800 shadow-xs' : 'bg-slate-100 text-slate-400'
                }`}>
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm leading-snug group-hover:text-emerald-950 transition-colors ${!n.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                      {n.title || 'Alert'}
                    </p>
                    <span className="text-[10px] text-slate-400 font-medium shrink-0 pt-0.5">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">
                    {n.message || n.content || ''}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-emerald-600 transition-all shrink-0 group-hover:translate-x-0.5" />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
