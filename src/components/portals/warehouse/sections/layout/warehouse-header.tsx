'use client'

import type { WarehouseSearchResult } from '@/lib/warehouse-search'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Bell, ChevronDown, LogOut, Menu } from 'lucide-react'
import type { PortalNotification } from './portal-state'

type WarehouseHeaderProps = {
  searchQuery: string
  searchResults: WarehouseSearchResult[]
  searchLoading: boolean
  onSearchChange: (query: string) => void
  onSearchSelect: (result: WarehouseSearchResult) => void
  userName: string
  userEmail: string
  userAvatar?: string
  notifications: PortalNotification[]
  notificationsLoading: boolean
  unreadNotifications: number
  onOpenSidebar: () => void
  onNotificationsOpen: (open: boolean) => void
  onClearNotifications: () => void
  onMarkAllRead: () => void
  onNotificationClick: (notification: PortalNotification) => void
  formatNotificationTime: (createdAt: string) => string
  onLogout: () => void
}

export function WarehouseHeader({
  userName,
  userEmail,
  userAvatar,
  notifications,
  notificationsLoading,
  unreadNotifications,
  onOpenSidebar,
  onNotificationsOpen,
  onClearNotifications,
  onMarkAllRead,
  onNotificationClick,
  formatNotificationTime,
  onLogout,
}: WarehouseHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-white/25 bg-white/42 backdrop-blur-2xl">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="text-slate-700 hover:bg-white/45 hover:text-slate-950 lg:hidden" onClick={onOpenSidebar}>
            <Menu className="h-5 w-5" />
          </Button>
          {/* Removed: global header search; page-specific inventory search remains available. */}
        </div>

        <div className="flex items-center gap-3">
          {/* Added: warehouse alerts open the related operational record. */}
          <DropdownMenu onOpenChange={onNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-slate-700 hover:bg-white/45 hover:text-slate-950" title="Notifications">
                <Bell className="h-5 w-5" />
                {unreadNotifications > 0 ? (
                  // Changed: show the unread total instead of a status-only dot.
                  <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white">
                    {unreadNotifications}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(26rem,calc(100vw-1rem))] p-0">
              <div className="flex items-center justify-between px-3 py-2">
                <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={notificationsLoading || unreadNotifications === 0} onClick={onMarkAllRead}>Mark all read</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                  onClick={onClearNotifications}
                  disabled={notificationsLoading || notifications.length === 0}
                >
                  Clear All
                </Button>
              </div>
              <DropdownMenuSeparator className="m-0" />
              <div className="max-h-[26rem] overflow-y-auto">
                {notificationsLoading ? (
                  <div className="px-3 py-3 text-sm text-gray-500">Loading notifications...</div>
                ) : notifications.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gray-500">No notifications yet.</div>
                ) : (
                  notifications.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      className={`block cursor-pointer rounded-none border-b px-3 py-2 last:border-b-0 ${!item.isRead ? 'bg-sky-50 focus:bg-sky-100' : ''}`}
                      onSelect={() => onNotificationClick(item)}
                    >
                      {/* Fix: retain a visible unread label and highlight until acknowledged. */}
                      <p className={`text-sm text-gray-900 ${!item.isRead ? 'font-bold' : 'font-medium'}`}>{!item.isRead && <span className="mr-2 text-xs text-blue-700">Unread</span>}{item.title}</p>
                      <p className="whitespace-normal text-xs text-gray-600">{item.message}</p>
                      <p className="mt-1 text-[11px] text-gray-500">{formatNotificationTime(item.createdAt)}</p>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 text-slate-700 hover:bg-white/45 hover:text-slate-950">
                <Avatar className="h-8 w-8">
                  {userAvatar ? <AvatarImage src={userAvatar} alt={`${userName || 'User'} avatar`} className="object-cover" /> : null}
                  <AvatarFallback className="bg-linear-to-br from-cyan-600 to-emerald-600 text-sm text-white shadow-[0_8px_18px_rgba(8,145,178,0.28)]">
                    {userName?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden md:inline">{userName}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="font-medium">{userName}</p>
                <p className="text-xs text-gray-500">{userEmail}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
