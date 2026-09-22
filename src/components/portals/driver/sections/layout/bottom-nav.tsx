'use client'

import { Button } from '@/components/ui/button'
import { Clock, Home, Truck, User, type LucideIcon } from 'lucide-react'

type DriverView = 'home' | 'trips' | 'history' | 'profile'

type DriverBottomNavProps = {
  activeView: string
  onOpenHome: () => void
  onOpenTrips: () => void
  onOpenHistory: () => void
  onOpenProfile: () => void
  openTripCount?: number
}

/**
 * One row per destination, shared by the phone bar and the desktop rail.
 *
 * Both layouts used to be written out by hand, four tabs each, so every change had
 * to be made in eight places -- which is how Home ended up with an emerald active
 * state while the other three went sky blue. Driving both from this list keeps the
 * two layouts from drifting again.
 */
const DRIVER_DESTINATIONS: { view: DriverView; label: string; icon: LucideIcon }[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'trips', label: 'Trips', icon: Truck },
  { view: 'history', label: 'History', icon: Clock },
  { view: 'profile', label: 'Profile', icon: User },
]

// Chrome reads a shade deeper than the content area behind it, so the bar is
// legible as a bar without needing a shadow or a translucent wash.
const BED = 'bg-[#e8f1f8]'
const HAIRLINE = 'border-[#c8dcec]'
// The selected tab lifts to white against the blue-grey bed and carries a rail,
// the same grammar as the shop nav. Two channels rather than one: an earlier
// version used a pale sky tint alone, which vanished on a near-white bed, and the
// solid ink block that replaced it read as a button sitting in the bar.
const ACTIVE_TAB = 'bg-white text-[#0f3d72] hover:bg-white hover:text-[#0f3d72]'
const IDLE_TAB = 'text-[#0f3d72] hover:bg-white/60'
const FOCUS_RING = 'focus-visible:ring-[#0e5aa8]'
// Blue, not the shop's green: green is reserved for the GPS-live state.
const RAIL = 'bg-[#0e5aa8]'

/**
 * Open trips, shown against whichever background the tab currently has.
 *
 * The count is never abbreviated -- a driver with twelve stops needs to see twelve,
 * the same reason the header bell shows its exact unread total.
 *
 * A stacked tab on the phone has no room beside its label, so the count sits on the
 * icon; a sidebar row does have room, and pinning it over the icon there pushed a
 * two-digit count into the label.
 *
 * Selected and idle tabs are both light now, so the count needs only one tone.
 */
function OpenTripCount({ count, placement }: { count: number; placement: 'on-icon' | 'end-of-row' }) {
  if (count <= 0) return null
  return (
    <span
      className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[#0e5aa8] px-1 text-[10px] font-bold leading-none tabular-nums text-white ${
        placement === 'on-icon' ? 'absolute -right-2.5 -top-1.5' : ''
      }`}
    >
      {count}
    </span>
  )
}

export function DriverBottomNav({
  activeView,
  onOpenHome,
  onOpenTrips,
  onOpenHistory,
  onOpenProfile,
  openTripCount = 0,
}: DriverBottomNavProps) {
  const openDestination: Record<DriverView, () => void> = {
    home: onOpenHome,
    trips: onOpenTrips,
    history: onOpenHistory,
    profile: onOpenProfile,
  }

  return (
    <>
      {/* Desktop rail. The old "NAVIGATION" eyebrow above it only labelled the obvious. */}
      <aside
        aria-label="Driver sections"
        className={`hidden h-full min-h-0 w-56 shrink-0 overflow-y-auto border-r p-3 md:block lg:w-60 ${HAIRLINE} ${BED}`}
      >
        <ul className="space-y-1.5">
          {DRIVER_DESTINATIONS.map(({ view, label, icon: Icon }) => {
            const isActive = activeView === view
            return (
              <li key={view}>
                <Button
                  variant="ghost"
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative h-11 w-full justify-start gap-3 rounded-lg px-3 text-sm font-semibold ${FOCUS_RING} ${isActive ? ACTIVE_TAB : IDLE_TAB}`}
                  onClick={openDestination[view]}
                >
                  {isActive ? (
                    <span aria-hidden="true" className={`absolute inset-y-2 left-0 w-[3px] rounded-full ${RAIL}`} />
                  ) : null}
                  {/* Sized with `size-*`: the button's own `svg:not([class*='size-'])`
                      rule pins anything else, `h-5 w-5` included, back to 16px. */}
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1 truncate text-left">{label}</span>
                  {view === 'trips' ? (
                    <OpenTripCount count={openTripCount} placement="end-of-row" />
                  ) : null}
                </Button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/*
        Phone bar. The `max-height` variant is for a phone in a truck mount: in
        landscape the icon and label sit on one line and the bar gives back the
        vertical space the map and stop list need. Its vertical padding and tab
        height match the customer phone bar.
      */}
      <nav
        aria-label="Driver sections"
        className={`fixed inset-x-0 bottom-0 z-30 border-t pb-[max(0.375rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-1.5 md:hidden ${HAIRLINE} ${BED}`}
      >
        <ul className="grid grid-cols-4 gap-1.5">
          {DRIVER_DESTINATIONS.map(({ view, label, icon: Icon }) => {
            const isActive = activeView === view
            return (
              <li key={view} className="min-w-0">
                <Button
                  variant="ghost"
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative h-14 w-full flex-col gap-1.5 rounded-xl px-1 [@media(max-height:30rem)]:h-11 [@media(max-height:30rem)]:flex-row [@media(max-height:30rem)]:gap-3 ${FOCUS_RING} ${isActive ? ACTIVE_TAB : IDLE_TAB}`}
                  onClick={openDestination[view]}
                >
                  {isActive ? (
                    <span aria-hidden="true" className={`absolute inset-x-3 top-0 h-[3px] rounded-full ${RAIL}`} />
                  ) : null}
                  <span className="relative inline-flex shrink-0">
                    <Icon className="size-[1.375rem] [@media(max-height:30rem)]:size-5" />
                    {view === 'trips' ? (
                      <OpenTripCount count={openTripCount} placement="on-icon" />
                    ) : null}
                  </span>
                  <span className="truncate text-[11px] font-semibold leading-none tracking-[-0.01em] min-[360px]:text-xs">
                    {label}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
