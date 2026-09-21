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
  onOpenNotifications,
  unreadCount = 0,
}: DriverPortalHeaderProps) {
  return (
    // Chrome is set off by a hairline and a slightly deeper bed rather than a
    // 24px drop shadow, which read as a seam across the top of every screen.
    <header className="border-b border-[#c8dcec] bg-[#e8f1f8] text-[#0f3d72]">
      <div className="px-4 pb-3 pt-[max(env(safe-area-inset-top),0.65rem)] md:py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="min-w-0 leading-tight">
              {/*
                The GPS state shares the company line, which has slack, rather than
                the title line, which does not: the title below is set nowrap, so a
                third item in that row pushed the whole header wider than a 360px
                phone. The company name truncates; the GPS state never shrinks.
              */}
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-[9px] uppercase tracking-[0.14em] text-slate-700 min-[360px]:text-[10px] min-[360px]:tracking-[0.18em]">ANN ANN'S BEVERAGES TRADING</p>
                {/*
                  Whether location is reporting decides whether the office can see
                  this truck at all, so it is stated in the chrome instead of being
                  left for the driver to infer. Green is used here and nowhere else.
                */}
                <p
                  className="flex shrink-0 items-center gap-1 text-[9px] font-semibold tracking-[-0.01em] text-[#0f3d72] min-[360px]:text-[10px]"
                  aria-live="polite"
                >
                  <span
                    aria-hidden="true"
                    className={`size-1.5 shrink-0 rounded-full ${isTracking ? 'bg-[#2f9a34]' : 'bg-slate-400'}`}
                  />
                  {isTracking ? 'GPS on' : 'GPS off'}
                </p>
              </div>
              <h1 className="whitespace-nowrap text-[clamp(0.95rem,4.5vw,1.125rem)] font-black tracking-[-0.01em] text-[#0f3d72]">AAB<span className="text-[#2f9a34]"> TRADING DRIVER</span></h1>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative size-10 shrink-0 rounded-full bg-[#0e5aa8] text-white hover:bg-[#0d4f92] hover:text-white focus-visible:ring-[#0f3d72]"
            onClick={onOpenNotifications}
            aria-label={`Notifications, ${unreadCount} unread`}
          >
            {/* `size-5` so the button's own svg rule does not pin this back to 16px. */}
            <Bell className="size-5" />
            {unreadCount > 0 && (
              // Changed: show the unread total as a stable badge without a flickering animation.
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none tabular-nums text-white ring-2 ring-[#e8f1f8]">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </header>
  )
}
