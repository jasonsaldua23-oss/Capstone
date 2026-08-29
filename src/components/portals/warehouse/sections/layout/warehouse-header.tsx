'use client'

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
import { Input } from '@/components/ui/input'
import { Bell, ChevronDown, LogOut, Menu, Search } from 'lucide-react'
import type { PortalNotification } from './portal-state'

type WarehouseHeaderProps = {
  userName: string
  userEmail: string
  userAvatar?: string
  notifications: PortalNotification[]
  notificationsLoading: boolean
  unreadNotifications: number
  onOpenSidebar: () => void
  onNotificationsOpen: (open: boolean) => void
  onClearNotifications: () => void
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
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input placeholder="Search requests, orders, inventory..." className="w-64 border-white/40 bg-white/50 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md" />
          </div>
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
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(26rem,calc(100vw-1rem))] p-0">
              <div className="flex items-center justify-between px-3 py-2">
                <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
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
                      className="block cursor-pointer rounded-none border-b px-3 py-2 last:border-b-0"
                      onSelect={() => onNotificationClick(item)}
                    >
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
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
