'use client'

import { Button } from '@/components/ui/button'
import { Clock, Home, Truck, User } from 'lucide-react'

type DriverBottomNavProps = {
  activeView: string
  onOpenHome: () => void
  onOpenTrips: () => void
  onOpenHistory: () => void
  onOpenProfile: () => void
}

export function DriverBottomNav({
  activeView,
  onOpenHome,
  onOpenTrips,
  onOpenHistory,
  onOpenProfile,
}: DriverBottomNavProps) {
  return (
    <>
      <aside className="hidden h-full w-56 shrink-0 border-r border-sky-200/60 bg-[#eff7fb] p-3 md:block">
        <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-sky-700/60">Navigation</div>
        <div className="space-y-1.5">
          <Button
            variant="ghost"
            className={`h-10 w-full justify-start gap-2 rounded-lg transition-all ${activeView === 'home' ? 'bg-emerald-100/90 text-emerald-700 shadow-sm shadow-emerald-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={onOpenHome}
          >
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">Home</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-10 w-full justify-start gap-2 rounded-lg transition-all ${activeView === 'trips' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={onOpenTrips}
          >
            <Truck className="h-4 w-4" />
            <span className="text-sm font-medium">Trips</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-10 w-full justify-start gap-2 rounded-lg transition-all ${activeView === 'history' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={onOpenHistory}
          >
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">History</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-10 w-full justify-start gap-2 rounded-lg transition-all ${activeView === 'profile' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
            onClick={onOpenProfile}
          >
            <User className="h-4 w-4" />
            <span className="text-sm font-medium">Profile</span>
          </Button>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sky-200/70 bg-[#eff7fb]/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl px-1 ${activeView === 'home' ? 'bg-emerald-100/90 text-emerald-700' : 'text-[#0e4f92]'}`}
            onClick={onOpenHome}
          >
            <Home className="h-4 w-4" />
            <span className="text-[11px] font-medium">Home</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl px-1 ${activeView === 'trips' ? 'bg-sky-100/90 text-sky-700' : 'text-[#0e4f92]'}`}
            onClick={onOpenTrips}
          >
            <Truck className="h-4 w-4" />
            <span className="text-[11px] font-medium">Trips</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl px-1 ${activeView === 'history' ? 'bg-sky-100/90 text-sky-700' : 'text-[#0e4f92]'}`}
            onClick={onOpenHistory}
          >
            <Clock className="h-4 w-4" />
            <span className="text-[11px] font-medium">History</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl px-1 ${activeView === 'profile' ? 'bg-sky-100/90 text-sky-700' : 'text-[#0e4f92]'}`}
            onClick={onOpenProfile}
          >
            <User className="h-4 w-4" />
            <span className="text-[11px] font-medium">Profile</span>
          </Button>
        </div>
      </nav>
    </>
  )
}
