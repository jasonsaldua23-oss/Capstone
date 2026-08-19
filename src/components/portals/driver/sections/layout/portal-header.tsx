'use client'

import { Button } from '@/components/ui/button'
import { Bell } from 'lucide-react'

type DriverPortalHeaderProps = {
  isTracking: boolean
  onOpenHome: () => void
  onOpenTrips: () => void
  onOpenProfile: () => void
  onLogout: () => void
  onOpenNotifications: () => void
  unreadCount?: number
}

export function DriverPortalHeader({
  isTracking,
  onOpenHome,
  onOpenTrips,
  onOpenProfile,
  onLogout,
  onOpenNotifications,
  unreadCount = 0,
}: DriverPortalHeaderProps) {
  return (
    <header className="border-b border-sky-200/70 bg-[#edf5fb]/95 text-[#0f3d72] shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-md">
      <div className="px-4 pb-3 pt-[max(env(safe-area-inset-top),0.65rem)] md:py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-700">ANN ANN'S BEVERAGES TRADING</p>
              <h1 className="text-[18px] font-black tracking-[-0.01em] text-[#0f3d72]">AAB<span className="text-[#2f9a34]"> TRADING DRIVER</span></h1>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative h-10 w-10 rounded-full border border-blue-200/70 bg-[#0e5aa8] text-white shadow-sm shadow-blue-900/30 hover:bg-[#0d4f92]"
            onClick={onOpenNotifications}
          >
            <Bell className="h-4.5 w-4.5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
            )}
          </Button>
        </div>
      </div>
    </header>
  )
}
