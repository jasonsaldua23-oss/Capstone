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
    <nav className="fixed bottom-2 left-2 right-2 rounded-3xl border border-white/80 bg-[#eff7fb]/85 backdrop-blur-xl shadow-[0_14px_30px_rgba(15,23,42,0.14)] md:relative md:bottom-auto md:left-auto md:right-auto md:w-full md:rounded-none md:border md:border-t md:border-sky-200/60 md:shadow-[0_-2px_8px_rgba(15,23,42,0.06)]">
      <div className="flex justify-around py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:pb-2">
        <Button
          variant="ghost"
          className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'home' ? 'bg-emerald-100/90 text-emerald-700 shadow-sm shadow-emerald-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
          onClick={onOpenHome}
        >
          <Home className="h-5 w-5" />
          <span className="text-xs font-medium">Home</span>
        </Button>
        <Button
          variant="ghost"
          className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'trips' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
          onClick={onOpenTrips}
        >
          <Truck className="h-5 w-5" />
          <span className="text-xs font-medium">Trips</span>
        </Button>
        <Button
          variant="ghost"
          className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'history' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
          onClick={onOpenHistory}
        >
          <Clock className="h-5 w-5" />
          <span className="text-xs font-medium">History</span>
        </Button>
        <Button
          variant="ghost"
          className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'profile' ? 'bg-sky-100/90 text-sky-700 shadow-sm shadow-blue-900/20' : 'text-[#0e4f92] hover:bg-white/70'}`}
          onClick={onOpenProfile}
        >
          <User className="h-5 w-5" />
          <span className="text-xs font-medium">Profile</span>
        </Button>
      </div>
    </nav>
  )
}

