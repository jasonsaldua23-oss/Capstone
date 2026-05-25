'use client'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function PortalTableSkeleton({
  rows = 5,
  columns = 5,
  showHeader = true,
  className,
}: {
  rows?: number
  columns?: number
  showHeader?: boolean
  className?: string
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-0">
        {showHeader ? (
          <div className="border-b bg-slate-50/80 px-4 py-3">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: columns }).map((_, index) => (
                <Skeleton key={`table-head-${index}`} className="h-4 w-24" />
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-0">
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={`table-row-${rowIndex}`}
              className="grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: columns }).map((__, columnIndex) => (
                <Skeleton
                  key={`table-cell-${rowIndex}-${columnIndex}`}
                  className={cn(
                    'h-4',
                    columnIndex === 0 ? 'w-32' : columnIndex === columns - 1 ? 'w-20' : 'w-full'
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function PortalCardsSkeleton({
  cards = 3,
  className,
  compact = false,
}: {
  cards?: number
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('grid gap-4', className)}>
      {Array.from({ length: cards }).map((_, index) => (
        <Card key={`card-skeleton-${index}`}>
          <CardContent className={cn('pt-6', compact ? 'space-y-3' : 'space-y-4')}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-20 rounded-lg" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function PortalStatsSkeleton({
  cards = 4,
  className,
}: {
  cards?: number
  className?: string
}) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: cards }).map((_, index) => (
        <Card key={`stats-skeleton-${index}`}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-14" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function PortalTabsSkeleton({ tabs = 3 }: { tabs?: number }) {
  return (
    <div className="rounded-2xl border border-white/40 bg-white/65 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl">
      <div className="grid gap-2 md:grid-cols-3">
        {Array.from({ length: tabs }).map((_, index) => (
          <Skeleton key={`tab-skeleton-${index}`} className="h-11 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export function PortalDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <PortalStatsSkeleton />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={`dashboard-metric-${index}`}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-8 w-20" />
                </div>
                <Skeleton className="h-10 w-10 rounded-xl" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full rounded-2xl" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full rounded-2xl" />
          </CardContent>
        </Card>
      </div>
      <PortalCardsSkeleton cards={2} className="md:grid-cols-2" compact />
    </div>
  )
}

export function PortalProductGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
      {Array.from({ length: cards }).map((_, index) => (
        <Card key={`product-skeleton-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90">
          <CardContent className="p-0">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function PortalTimelineSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={`timeline-skeleton-${index}`} className="grid grid-cols-[20px_1fr_auto] gap-2">
          <div className="flex justify-center pt-1">
            <Skeleton className="h-3 w-3 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

export function PortalProfileSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center">
            <Skeleton className="mb-4 h-20 w-20 rounded-full" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-2 h-4 w-56" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`profile-field-${index}`} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
