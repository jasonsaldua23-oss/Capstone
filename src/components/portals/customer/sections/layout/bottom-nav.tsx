'use client'

import { ClipboardList, Home, Package, User, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

type CustomerBottomNavProps = {
  activeView: string
  setActiveView: (view: string) => void
  setSelectedOrder?: (order: unknown) => void
}

/**
 * One row per destination, shared by the phone bar and the desktop rail.
 *
 * `matches` lists every view that belongs to a tab, so opening one request or one
 * order keeps its own tab lit instead of leaving the bar with nothing selected.
 * Views reached from the header -- the cart and the notifications list -- belong to
 * no tab and leave every tab idle; notifications must never light Profile.
 *
 * The phone bar allows the purchase labels to wrap onto two lines so the full
 * business terms remain visible without widening the navigation bar.
 */
const CUSTOMER_DESTINATIONS: {
  view: string
  label: string
  shortLabel: string
  icon: LucideIcon
  matches: string[]
}[] = [
  { view: 'home', label: 'Home', shortLabel: 'Home', icon: Home, matches: ['home'] },
  {
    view: 'purchase-requests',
    label: 'Purchase Requests',
    shortLabel: 'Purchase Requests',
    icon: ClipboardList,
    matches: ['purchase-requests', 'purchase-request-detail'],
  },
  {
    view: 'orders',
    label: 'Purchase Orders',
    shortLabel: 'Purchase Orders',
    icon: Package,
    // Added: live tracking is opened from an order (and from delivery notifications).
    matches: ['orders', 'order-detail', 'track'],
  },
  { view: 'profile', label: 'Profile', shortLabel: 'Profile', icon: User, matches: ['profile', 'edit-address'] },
]

// A shop owner browses this indoors, so the selected tab is a quiet tint rather
// than the solid block the driver's daylight bar needs. The rail carries the same
// state in position as well as colour, which a tint this pale cannot do alone.
const ACTIVE_TAB = 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700'
const IDLE_TAB = 'text-slate-600 hover:bg-slate-100'
const FOCUS_RING = 'focus-visible:ring-emerald-600'
const RAIL = 'bg-[#2f9a34]'

export function CustomerBottomNav({ activeView, setActiveView, setSelectedOrder }: CustomerBottomNavProps) {
  const handleNav = (view: string) => {
    setSelectedOrder?.(null)
    setActiveView(view)
  }

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside
        aria-label="Shop sections"
        className="hidden h-full min-h-0 w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-3 md:flex"
      >
        <ul className="space-y-1.5">
          {CUSTOMER_DESTINATIONS.map(({ view, label, icon: Icon, matches }) => {
            const isActive = matches.includes(activeView)
            return (
              <li key={view}>
                <Button
                  variant="ghost"
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative h-11 w-full justify-start gap-3 rounded-lg px-3 text-sm font-semibold ${FOCUS_RING} ${isActive ? ACTIVE_TAB : IDLE_TAB}`}
                  onClick={() => handleNav(view)}
                >
                  {isActive ? (
                    <span aria-hidden="true" className={`absolute inset-y-2 left-0 w-[3px] rounded-full ${RAIL}`} />
                  ) : null}
                  {/* Sized with `size-*`: the button's own `svg:not([class*='size-'])`
                      rule pins anything else, `h-4 w-4` included, back to 16px. */}
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1 truncate text-left">{label}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/*
        ── Phone bar ──
        The `max-height` variant covers landscape and split screen: icon and label
        move onto one line so the bar stops eating a third of a short viewport.
      */}
      <nav
        aria-label="Shop sections"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[max(0.375rem,env(safe-area-inset-bottom))] pl-[max(0.375rem,env(safe-area-inset-left))] pr-[max(0.375rem,env(safe-area-inset-right))] pt-1.5 md:hidden"
      >
        <ul className="grid grid-cols-4 gap-1">
          {CUSTOMER_DESTINATIONS.map(({ view, shortLabel, icon: Icon, matches }) => {
            const isActive = matches.includes(activeView)
            return (
              <li key={view} className="min-w-0">
                <Button
                  variant="ghost"
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative h-14 w-full flex-col gap-1 rounded-xl px-1 [@media(max-height:30rem)]:h-11 [@media(max-height:30rem)]:flex-row [@media(max-height:30rem)]:gap-2 ${FOCUS_RING} ${isActive ? ACTIVE_TAB : IDLE_TAB}`}
                  onClick={() => handleNav(view)}
                >
                  {isActive ? (
                    <span aria-hidden="true" className={`absolute inset-x-3 top-0 h-[3px] rounded-full ${RAIL}`} />
                  ) : null}
                  <Icon className="size-[1.375rem] shrink-0 [@media(max-height:30rem)]:size-5" />
                  <span className="max-w-full whitespace-normal text-center text-[10px] font-semibold leading-[1.05] tracking-[-0.01em] min-[360px]:text-[11px]">
                    {shortLabel.startsWith('Purchase ') ? (
                      <><span className="block">Purchase</span><span className="block">{shortLabel.replace('Purchase ', '')}</span></>
                    ) : shortLabel}
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
