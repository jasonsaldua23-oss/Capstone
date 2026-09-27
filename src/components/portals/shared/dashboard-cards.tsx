import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, CircleCheck, Package } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Dashboard cards shared by the Admin and Warehouse dashboards, so both portals
 * present the same figures the same way.
 */

export type DashboardCardTone = 'blue' | 'rose' | 'emerald' | 'indigo' | 'amber'
type Icon = ComponentType<{ className?: string }>

// Tailwind needs literal class names, so every tone spells its classes out in full.
const METRIC_TONES: Record<DashboardCardTone, { card: string; icon: string; value: string; label: string }> = {
  blue: {
    card: 'border-blue-100/70 bg-blue-50 shadow-[0_18px_40px_rgba(37,99,235,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(37,99,235,0.22)]',
    icon: 'border-blue-200/60 bg-white/70 p-2.5 text-blue-700',
    value: 'text-blue-900',
    label: 'text-blue-900/70',
  },
  rose: {
    card: 'border-rose-100/70 bg-rose-50 shadow-[0_18px_40px_rgba(225,29,72,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(225,29,72,0.2)]',
    icon: 'border-rose-200/60 bg-white/70 p-2.5 text-rose-700',
    value: 'text-rose-900',
    label: 'text-rose-900/70',
  },
  emerald: {
    card: 'border-emerald-100/70 bg-emerald-50 shadow-[0_18px_40px_rgba(5,150,105,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(5,150,105,0.2)]',
    icon: 'border-emerald-200/60 bg-white/70 p-2.5 text-emerald-700',
    value: 'text-emerald-900',
    label: 'text-emerald-900/70',
  },
  indigo: {
    card: 'border-indigo-100/70 bg-indigo-50 shadow-[0_18px_40px_rgba(79,70,229,0.15)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(79,70,229,0.22)]',
    icon: 'border-indigo-200/60 bg-white/70 p-2.5 text-indigo-700',
    value: 'text-indigo-900',
    label: 'text-indigo-900/70',
  },
  amber: {
    card: 'border-amber-100/70 bg-amber-50 shadow-[0_18px_40px_rgba(217,119,6,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(217,119,6,0.2)]',
    icon: 'border-amber-200/60 bg-white/70 p-2.5 text-amber-700',
    value: 'text-amber-900',
    label: 'text-amber-900/70',
  },
}

const SUMMARY_TONES: Record<DashboardCardTone, { card: string; icon: string; label: string; value: string; hint: string }> = {
  blue: {
    card: 'border-blue-100/70 bg-blue-50 shadow-[0_14px_32px_rgba(37,99,235,0.12)]',
    icon: 'border-blue-200/60 bg-white/80 p-2.5 text-blue-700',
    label: 'text-blue-900/75',
    value: 'text-blue-900',
    hint: 'text-blue-900/60',
  },
  rose: {
    card: 'border-rose-100/70 bg-rose-50 shadow-[0_14px_32px_rgba(225,29,72,0.12)]',
    icon: 'border-rose-200/60 bg-white/80 p-2.5 text-rose-700',
    label: 'text-rose-900/75',
    value: 'text-rose-900',
    hint: 'text-rose-900/60',
  },
  emerald: {
    card: 'border-emerald-100/70 bg-emerald-50 shadow-[0_14px_32px_rgba(5,150,105,0.11)]',
    icon: 'border-emerald-200/60 bg-white/80 p-2.5 text-emerald-700',
    label: 'text-emerald-900/75',
    value: 'text-emerald-900',
    hint: 'text-emerald-900/60',
  },
  indigo: {
    card: 'border-indigo-100/70 bg-indigo-50 shadow-[0_14px_32px_rgba(79,70,229,0.12)]',
    icon: 'border-indigo-200/60 bg-white/80 p-2.5 text-indigo-700',
    label: 'text-indigo-900/75',
    value: 'text-indigo-900',
    hint: 'text-indigo-900/60',
  },
  amber: {
    card: 'border-amber-100/70 bg-amber-50 shadow-[0_14px_32px_rgba(217,119,6,0.12)]',
    icon: 'border-amber-200/60 bg-white/80 p-2.5 text-amber-700',
    label: 'text-amber-900/75',
    value: 'text-amber-900',
    hint: 'text-amber-900/60',
  },
}

/** Headline count: icon above, large figure, label underneath. */
export function DashboardMetricCard({ icon: IconComponent, value, label, tone }: {
  icon: Icon
  value: number
  label: string
  tone: DashboardCardTone
}) {
  const classes = METRIC_TONES[tone]
  return (
    <Card data-dashboard-card className={`group relative overflow-hidden rounded-3xl border ${classes.card}`}>
      <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
        <div className={`inline-flex w-fit rounded-2xl border ${classes.icon} backdrop-blur`}>
          <IconComponent className="h-5 w-5" />
        </div>
        <div className="mt-4">
          <p className={`text-4xl font-extrabold leading-none tracking-tight ${classes.value}`}>{value.toLocaleString()}</p>
          <p className={`mt-2 text-sm leading-tight font-medium ${classes.label}`}>{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** Supporting figure: icon beside a label, the value, and an optional hint. */
export function DashboardSummaryCard({ icon: IconComponent, label, value, hint, tone, valueKind }: {
  icon: Icon
  label: string
  value: ReactNode
  hint?: string
  tone: DashboardCardTone
  /** A name is set smaller than a figure so it can wrap without clipping; defaults by value type. */
  valueKind?: 'number' | 'text'
}) {
  const classes = SUMMARY_TONES[tone]
  const valueClass = (valueKind ?? (typeof value === 'string' ? 'text' : 'number')) === 'text'
    ? `mt-2 text-2xl font-extrabold leading-tight tracking-tight ${classes.value}`
    : `mt-2 text-4xl font-extrabold leading-none tracking-tight ${classes.value}`
  return (
    <Card data-dashboard-card className={`group relative overflow-hidden rounded-3xl border ${classes.card} transition-all duration-300 hover:-translate-y-0.5`}>
      <CardContent className="relative flex h-full items-start gap-3 p-6">
        <div className={`rounded-2xl border ${classes.icon} backdrop-blur`}>
          <IconComponent className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${classes.label}`}>{label}</p>
          <p className={valueClass}>
            {value}
          </p>
          {hint ? <p className={`mt-2 text-xs ${classes.hint}`}>{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** Mean units on hand per tracked item. */
export function averageStockLevel(items: Array<{ quantity?: unknown }>) {
  if (items.length === 0) return 0
  const totalQty = items.reduce((sum, item) => sum + (Number(item?.quantity || 0)), 0)
  return Math.round(totalQty / items.length)
}

export function InventoryStatusOverviewCard({ breakdown, totalItems }: {
  breakdown: { healthy: number; lowStock: number; critical: number; outOfStock: number }
  totalItems: number
}) {
  return (
    <Card className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/70 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.08),transparent_30%),radial-gradient(circle_at_88%_22%,rgba(244,63,94,0.08),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.07),transparent_35%)]" />
      <div className="relative h-1.5 w-full bg-linear-to-r from-emerald-400 via-amber-400 to-rose-400" />
      <CardHeader>
        <CardTitle className="text-xl font-bold text-slate-900">Inventory Status Overview</CardTitle>
        <CardDescription className="text-base text-slate-500">Quick view of stock levels across all items</CardDescription>
      </CardHeader>
      <CardContent className="relative">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-teal-100/70 p-5 shadow-[0_10px_24px_rgba(16,185,129,0.14)]">
            <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-emerald-300/30 blur-xl" />
            <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-emerald-700">
              <CircleCheck className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-emerald-900/75">Healthy Stock</p>
            <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-emerald-700">{breakdown.healthy}</p>
            <p className="mt-3 text-sm text-emerald-900/70">Good levels</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-yellow-100/70 p-5 shadow-[0_10px_24px_rgba(245,158,11,0.14)]">
            <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-amber-300/30 blur-xl" />
            <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-amber-900/75">Low Stock</p>
            <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-amber-700">{breakdown.lowStock}</p>
            <p className="mt-3 text-sm text-amber-900/70">Needs order soon</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-orange-200/70 bg-gradient-to-br from-orange-50 to-amber-100/70 p-5 shadow-[0_10px_24px_rgba(249,115,22,0.14)]">
            <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-orange-300/30 blur-xl" />
            <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-orange-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-orange-900/75">Critical</p>
            <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-orange-700">{breakdown.critical}</p>
            <p className="mt-3 text-sm text-orange-900/70">Below minimum</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-rose-200/70 bg-gradient-to-br from-rose-50 to-pink-100/70 p-5 shadow-[0_10px_24px_rgba(244,63,94,0.14)]">
            <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-rose-300/30 blur-xl" />
            <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-rose-700">
              <Package className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-rose-900/75">Out of Stock</p>
            <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-rose-700">{breakdown.outOfStock}</p>
            <p className="mt-3 text-sm text-rose-900/70">Urgent reorder</p>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
          <div className="flex items-center justify-between text-base">
            <span className="font-medium text-slate-600">Total Items</span>
            <span className="text-2xl font-extrabold leading-none text-slate-900">{totalItems}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Share of tracked items at or below their reorder threshold, as a ring. */
export function StockHealthCard({ lowStockCount, totalItems, className = 'rounded-2xl border-0 shadow-sm' }: {
  lowStockCount: number
  totalItems: number
  className?: string
}) {
  const stockHealthPercentage = totalItems === 0 ? 0 : Math.round((lowStockCount / totalItems) * 100)
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm">Stock Health</CardTitle>
        <CardDescription>Low stock percentage</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <div className="relative h-24 w-24 flex items-center justify-center">
              {/* The ring is the gradient itself; an opaque border here used to hide the arc entirely. */}
              <div className="absolute inset-0 rounded-full" style={{
                background: `conic-gradient(from 0deg, ${stockHealthPercentage > 30 ? '#ef4444' : '#10b981'} ${stockHealthPercentage * 3.6}deg, #e5e7eb ${stockHealthPercentage * 3.6}deg)`
              }} />
              <div className="absolute inset-2 rounded-full bg-white flex items-center justify-center">
                <span className={`text-2xl font-bold ${stockHealthPercentage > 30 ? 'text-red-600' : 'text-green-600'}`}>
                  {stockHealthPercentage}%
                </span>
              </div>
            </div>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600">
              {stockHealthPercentage > 30 ? 'Needs Attention' : 'Healthy'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {lowStockCount} of {totalItems} items
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
