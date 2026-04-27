'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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

type WarehouseNotification = {
  id: string
  title: string
  message: string
  createdAt: string
}

type WarehouseHeaderProps = {
  unreadNotifications: number
  notificationsLoading: boolean
  notifications: WarehouseNotification[]
  onNotificationsOpen: (open: boolean) => void
  formatNotificationTime: (createdAt: string) => string
  userName: string
  userEmail: string
  onOpenSidebar: () => void
  onLogout: () => void
}

export function WarehouseHeader({
  unreadNotifications,
  notificationsLoading,
  notifications,
  onNotificationsOpen,
  formatNotificationTime,
  userName,
  userEmail,
  onOpenSidebar,
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
            <Input placeholder="Search inventory, warehouse..." className="w-64 border-white/40 bg-white/50 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <DropdownMenu onOpenChange={onNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-slate-700 hover:bg-white/45 hover:text-slate-950">
                <Bell className="h-5 w-5" />
                {unreadNotifications > 0 && <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <div className="px-2 py-1.5 text-sm font-medium">Notifications</div>
              <DropdownMenuSeparator />
              {notificationsLoading ? (
                <div className="px-2 py-3 text-sm text-gray-500">Loading notifications...</div>
              ) : notifications.length === 0 ? (
                <div className="px-2 py-3 text-sm text-gray-500">No notifications yet.</div>
              ) : (
                notifications.slice(0, 8).map((item) => (
                  <div key={item.id} className="px-2 py-2 border-b last:border-b-0">
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-600">{item.message}</p>
                    <p className="text-[11px] text-gray-500 mt-1">{formatNotificationTime(item.createdAt)}</p>
                  </div>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 text-slate-700 hover:bg-white/45 hover:text-slate-950">
                <Avatar className="h-8 w-8">
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

