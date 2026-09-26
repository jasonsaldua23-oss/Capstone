'use client'

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Loader2, MapPin, PackageCheck, PanelRightClose, PanelRightOpen, Truck, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { DeliveredTransaction } from '@/lib/delivered-transactions'

/**
 * Map-first Live Tracking layout shared by the admin and warehouse portals.
 *
 * The map and the Tracking Details panel share one shell. On desktop the panel
 * collapses to zero width and the map takes the space; the map re-fits itself
 * through its own ResizeObserver (MapResizeSync), so tiles never leave gaps.
 * Below `lg` the panel becomes a bottom sheet and the map stays full width.
 */

const DETAILS_OPEN_KEY = 'live-tracking-details-open'
const ACTIVE_TRIPS_PAGE_SIZE = 10
const PANEL_WIDTH_CLASS = 'w-[360px]'

// The panel choice is remembered per browser. Storage can be blocked (private
// windows, cleared site data), so an in-memory value keeps the toggle working.
const detailsOpenListeners = new Set<() => void>()
let detailsOpenFallback = true

function readDetailsOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(DETAILS_OPEN_KEY)
    if (stored !== null) return stored !== 'false'
  } catch {}
  return detailsOpenFallback
}

function writeDetailsOpen(open: boolean) {
  detailsOpenFallback = open
  try {
    window.localStorage.setItem(DETAILS_OPEN_KEY, String(open))
  } catch {}
  detailsOpenListeners.forEach((listener) => listener())
}

function subscribeDetailsOpen(listener: () => void) {
  detailsOpenListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    detailsOpenListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

type LiveTrackingPageProps = {
  trackingDate: string
  onTrackingDateChange: (value: string) => void
  onRefresh: () => void
  isRefreshing: boolean
  map: ReactNode
  activeTrips: any[]
  deliveries: DeliveredTransaction[]
  recentLocations: any[]
  isLoadingTrips: boolean
}

export function LiveTrackingPage({
  trackingDate,
  onTrackingDateChange,
  onRefresh,
  isRefreshing,
  map,
  activeTrips,
  deliveries,
  recentLocations,
  isLoadingTrips,
}: LiveTrackingPageProps) {
  const detailsOpen = useSyncExternalStore(subscribeDetailsOpen, readDetailsOpen, () => true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const toggleDetails = writeDetailsOpen

  const details = (
    <TrackingDetails
      activeTrips={activeTrips}
      deliveries={deliveries}
      recentLocations={recentLocations}
      isLoadingTrips={isLoadingTrips}
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
          <p className="text-gray-500">Monitor active deliveries in real-time</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Input
            type="date"
            aria-label="Tracking date"
            value={trackingDate}
            onChange={(event) => onTrackingDateChange(event.target.value)}
            className="w-full bg-white sm:w-[160px]"
          />
          <Button className="gap-2" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            Refresh Map
          </Button>
        </div>
      </div>

      <div className="relative flex h-[max(24rem,calc(100dvh-17rem))] overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/5 sm:h-[max(26rem,calc(100dvh-11.5rem))]">
        <div className="relative min-w-0 flex-1">
          {map}

          {/* Desktop: restores the collapsed panel. */}
          {!detailsOpen ? (
            <FloatingDetailsButton className="hidden lg:inline-flex" onClick={() => toggleDetails(true)} />
          ) : null}
          {/* Tablet and phone: the panel lives in a bottom sheet. */}
          <FloatingDetailsButton className="inline-flex lg:hidden" onClick={() => setSheetOpen(true)} />
        </div>

        <aside
          aria-label="Tracking details"
          inert={!detailsOpen}
          className={`relative hidden shrink-0 overflow-hidden bg-slate-50/90 transition-[width] duration-300 ease-out motion-reduce:transition-none lg:block ${
            detailsOpen ? `${PANEL_WIDTH_CLASS} border-l border-slate-200/80` : 'w-0'
          }`}
        >
          {/* Fixed inner width, so the content slides out instead of reflowing. */}
          <div className={`flex h-full ${PANEL_WIDTH_CLASS} flex-col`}>
            <div className="pb-3 pl-7 pr-5 pt-5">
              <h2 className="text-base font-semibold text-slate-900">Tracking Details</h2>
              <p className="text-xs text-slate-500">Trips, deliveries and GPS logs for the selected date</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [scrollbar-color:var(--color-slate-300)_transparent] [scrollbar-width:thin]">{details}</div>
          </div>
        </aside>

        {/* The collapse control sits on the seam between the map and the panel. */}
        {detailsOpen ? (
          <button
            type="button"
            onClick={() => toggleDetails(false)}
            aria-label="Hide tracking details"
            title="Hide tracking details"
            className="absolute right-[360px] top-5 z-20 hidden size-9 translate-x-1/2 place-items-center rounded-full bg-white text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.15)] ring-1 ring-slate-200 transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 lg:grid"
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] gap-0 rounded-t-[20px] bg-slate-50 p-0 lg:hidden">
          <SheetHeader className="px-5 pb-3 pt-5">
            <SheetTitle className="text-base text-slate-900">Tracking Details</SheetTitle>
            <SheetDescription className="text-xs">Trips, deliveries and GPS logs for the selected date</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{details}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function FloatingDetailsButton({ className, onClick }: { className: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show tracking details"
      className={`absolute right-3 top-3 z-20 items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-[0_2px_10px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${className}`}
    >
      <PanelRightOpen className="size-4" aria-hidden="true" />
      Show details
    </button>
  )
}

function TrackingDetails({
  activeTrips,
  deliveries,
  recentLocations,
  isLoadingTrips,
}: {
  activeTrips: any[]
  deliveries: DeliveredTransaction[]
  recentLocations: any[]
  isLoadingTrips: boolean
}) {
  return (
    <div className="space-y-3">
      {/* Same icons as the sidebar entries for these areas (Transportation,
          Purchase Orders, Live Tracking), drawn the same plain way. */}
      <DetailsSection title="Active Trips" count={isLoadingTrips ? null : activeTrips.length} icon={Truck}>
        <ActiveTripsList trips={activeTrips} isLoading={isLoadingTrips} />
      </DetailsSection>
      <DetailsSection title="Delivered Transactions" count={isLoadingTrips ? null : deliveries.length} icon={PackageCheck}>
        <DeliveredList deliveries={deliveries} isLoading={isLoadingTrips} />
      </DetailsSection>
      <DetailsSection title="Recent Locations" count={null} icon={MapPin}>
        <RecentLocationsList logs={recentLocations} isLoading={isLoadingTrips} />
      </DetailsSection>
    </div>
  )
}

function DetailsSection({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string
  count: number | null
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_18px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {count ? (
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function RowSkeletons({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-2 rounded-xl bg-slate-50 p-2.5">
          <Skeleton className="h-4 w-24 max-w-full" />
          <Skeleton className="h-3 w-36 max-w-full" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>
}

function ActiveTripsList({ trips, isLoading }: { trips: any[]; isLoading: boolean }) {
  const [requestedPage, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(trips.length / ACTIVE_TRIPS_PAGE_SIZE))
  // Clamped on read, so a shrinking trip list never strands the view on an empty page.
  const page = Math.min(requestedPage, totalPages)

  if (isLoading) return <RowSkeletons rows={2} />
  if (trips.length === 0) return <EmptyState>No active trips right now</EmptyState>

  const start = (page - 1) * ACTIVE_TRIPS_PAGE_SIZE
  return (
    <div className="space-y-2">
      {trips.slice(start, start + ACTIVE_TRIPS_PAGE_SIZE).map((trip) => (
        <div key={trip.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{trip.tripNumber}</p>
            <p className="truncate text-xs text-slate-500">Driver: {trip.driver?.name || trip.driver?.user?.name || 'Unassigned'}</p>
          </div>
          <span
            className="shrink-0 rounded-md bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700 ring-1 ring-slate-200"
            title="Completed stops"
          >
            {trip.completedDropPoints || 0}/{trip.totalDropPoints || 0}
          </span>
        </div>
      ))}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>
            Previous
          </Button>
          <span className="text-xs tabular-nums text-slate-500">Page {page} of {totalPages}</span>
          <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DeliveredList({ deliveries, isLoading }: { deliveries: DeliveredTransaction[]; isLoading: boolean }) {
  if (isLoading) return <RowSkeletons rows={2} />
  if (deliveries.length === 0) return <EmptyState>No deliveries completed on this date</EmptyState>
  return (
    <div className="space-y-2">
      {deliveries.map((delivery) => (
        <div key={delivery.orderId} className="rounded-xl bg-slate-50 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-slate-900">{delivery.orderNumber}</p>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {new Date(delivery.deliveredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
          {delivery.customerName ? <p className="truncate text-xs text-slate-600">{delivery.customerName}</p> : null}
          <p className="truncate text-xs text-slate-500">
            {delivery.tripNumber
              ? delivery.driverName
                ? `${delivery.driverName} on ${delivery.tripNumber}`
                : delivery.tripNumber
              : 'Marked delivered without a trip'}
          </p>
        </div>
      ))}
    </div>
  )
}

function RecentLocationsList({ logs, isLoading }: { logs: any[]; isLoading: boolean }) {
  if (isLoading) return <RowSkeletons rows={2} />
  if (logs.length === 0) return <EmptyState>No coordinate logs available</EmptyState>
  return (
    <div className="space-y-1.5">
      {logs.map((log: any) => (
        <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-2.5 py-2 text-sm">
          <span className="truncate text-slate-500">
            {new Date(log.recordedAt || log.createdAt || Date.now()).toLocaleTimeString()}
          </span>
          <span className="shrink-0 tabular-nums text-slate-800">
            {Number(log.latitude).toFixed(4)}, {Number(log.longitude).toFixed(4)}
          </span>
        </div>
      ))}
    </div>
  )
}
