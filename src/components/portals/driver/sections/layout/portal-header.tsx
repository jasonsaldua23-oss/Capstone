'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Home, LogOut, Truck, User } from 'lucide-react'

type DriverPortalHeaderProps = {
  isTracking: boolean
  onOpenHome: () => void
  onOpenTrips: () => void
  onOpenProfile: () => void
  onLogout: () => void
}

export function DriverPortalHeader({
  isTracking,
  onOpenHome,
  onOpenTrips,
  onOpenProfile,
  onLogout,
}: DriverPortalHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-sky-200/70 bg-[#edf5fb]/95 text-[#0f3d72] shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-md">
      <div className="px-4 pb-3 pt-[max(env(safe-area-inset-top),0.65rem)] md:py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl border border-white/90 bg-white shadow-[0_6px_14px_rgba(15,23,42,0.14)]">
              <img src="/anndrive.png" alt="AnnDrive" className="h-full w-full object-cover" />
            </div>
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-700">Ann Ann's Beveraes Trading</p>
              <h1 className="text-[18px] font-black tracking-[-0.01em] text-[#0f3d72]">Ann<span className="text-[#2f9a34]">Drive</span></h1>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full border border-blue-200/70 bg-[#0e5aa8] text-white shadow-sm shadow-blue-900/30 hover:bg-[#0d4f92]">
                <User className="h-4.5 w-4.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenHome}>
                <Home className="mr-2 h-4 w-4" />
                Home
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenTrips}>
                <Truck className="mr-2 h-4 w-4" />
                Trips
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenProfile}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[1.1rem] font-semibold tracking-tight text-[#0a1b36]">DELIVERY APP</p>
          {isTracking ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-100 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              LIVE TRACKING
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

