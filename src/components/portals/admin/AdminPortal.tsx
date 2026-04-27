
"use client";


import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic'
import { toast } from 'sonner';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { useAuth } from '@/app/page';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts';
import type { DashboardStats } from '@/types';
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync';
import { clearTabAuthToken, getTabAuthToken } from '@/lib/client-auth'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'
import { SettingsView } from './sections/settings-view'
import { InventoryView } from './sections/inventory-view'
import { StocksView } from './sections/stocks-view'
import { UsersView } from './sections/users-view'
import { OrdersView } from './sections/orders-view'
import { TripsView } from './sections/trips-view'
import { VehiclesView } from './sections/vehicles-view'
import { DriversView } from './sections/drivers-view'
import { DashboardView } from './sections/dashboard-view'
import { TransportationView } from './sections/transportation-view'
import { WarehousesView } from './sections/warehouses-view'
import { ReplacementsView } from './sections/replacements-view'
import { TrackingView } from './sections/tracking-view'
import { FeedbackView } from './sections/feedback-view'
import { ReportsView } from './sections/reports-view'
import { CustomersView } from './sections/customers-view'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

//   lowStockItems: number
//   pendingReturns: number
//   avgRating: number
//   totalRevenue: number
// }
const PERCENT_WIDTH_CLASSES: Record<number, string> = {
  0: 'w-0',
  5: 'w-[5%]',
  10: 'w-[10%]',
  15: 'w-[15%]',
  20: 'w-[20%]',
  25: 'w-1/4',
  30: 'w-[30%]',
  35: 'w-[35%]',
  40: 'w-2/5',
  45: 'w-[45%]',
  50: 'w-1/2',
  55: 'w-[55%]',
  60: 'w-3/5',
  65: 'w-[65%]',
  70: 'w-[70%]',
  75: 'w-3/4',
  80: 'w-4/5',
  85: 'w-[85%]',
  90: 'w-[90%]',
  95: 'w-[95%]',
  100: 'w-full',
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function toPercentStep(value: number) {
  return Math.round(clampPercent(value) / 5) * 5
}

function getWidthClass(value: number) {
  return PERCENT_WIDTH_CLASSES[toPercentStep(value)] ?? 'w-0'
}

const PRODUCT_UNIT_OPTIONS = [
  { value: 'case', label: 'case' },
  { value: 'pack(bundle)', label: 'pack(bundle)' },
]

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

function getDefaultRouteDate() {
  const now = new Date()
  now.setDate(now.getDate() + 1)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeTripStatus(status: unknown) {
  const value = String(status || '').toUpperCase()
  return value === 'IN_TRANSIT' ? 'IN_PROGRESS' : value
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function formatDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toIsoDateTime(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function formatDateTime(value: unknown) {
  const iso = toIsoDateTime(value)
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleString()
}

function formatDayLabel(value: unknown) {
  const iso = toIsoDateTime(value)
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function withinRange(value: unknown, startAt: Date) {
  const iso = toIsoDateTime(value)
  if (!iso) return false
  return new Date(iso).getTime() >= startAt.getTime()
}

function getWarehouseIdFromRow(row: any) {
  const value = row?.warehouseId ?? row?.warehouse_id ?? row?.warehouse?.id ?? row?.warehouse
  return typeof value === 'object' && value !== null ? String(value.id || '') : String(value || '')
}

async function downloadPdf(
  filename: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  options?: { companyName?: string; subtitle?: string; preparedBy?: string }
) {
  if (!rows.length) {
    toast.error(`No data to export for ${filename}`)
    return
  }

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([842, 595])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const companyName = options?.companyName || "Ann Ann's Beverages Trading"
  const subtitle = options?.subtitle || 'Logistics Management System'
  const preparedBy = options?.preparedBy || 'System Administrator'

  const margin = 28
  const usableWidth = 842 - margin * 2
  const lineHeight = 14
  const maxRows = Math.min(rows.length, 180)
  const headers = Object.keys(rows[0]).slice(0, 8)
  const colWidth = usableWidth / Math.max(1, headers.length)

  let y = 560
  page.drawText(companyName, {
    x: margin,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.08),
  })
  y -= 16
  page.drawText(subtitle, {
    x: margin,
    y,
    size: 10,
    font,
    color: rgb(0.25, 0.25, 0.25),
  })
  y -= 18
  page.drawText(title, {
    x: margin,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  })
  y -= 14
  page.drawText(`Generated: ${new Date().toLocaleString()} | Prepared by: ${preparedBy}`, {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  })
  y -= 18

  headers.forEach((header, index) => {
    page.drawText(header, {
      x: margin + index * colWidth,
      y,
      size: 9,
      font: boldFont,
      color: rgb(0.15, 0.15, 0.15),
      maxWidth: colWidth - 6,
    })
  })
  y -= lineHeight

  for (let i = 0; i < maxRows; i += 1) {
    if (y < 30) {
      const nextPage = pdfDoc.addPage([842, 595])
      y = 560
      headers.forEach((header, index) => {
        nextPage.drawText(header, {
          x: margin + index * colWidth,
          y,
          size: 9,
          font: boldFont,
          color: rgb(0.15, 0.15, 0.15),
          maxWidth: colWidth - 6,
        })
      })
      y -= lineHeight
      const row = rows[i]
      headers.forEach((header, index) => {
        const value = String(row[header] ?? '')
        nextPage.drawText(value, {
          x: margin + index * colWidth,
          y,
          size: 8,
          font,
          color: rgb(0.25, 0.25, 0.25),
          maxWidth: colWidth - 6,
        })
      })
      y -= lineHeight
      continue
    }

    const row = rows[i]
    headers.forEach((header, index) => {
      const value = String(row[header] ?? '')
      page.drawText(value, {
        x: margin + index * colWidth,
        y,
        size: 8,
        font,
        color: rgb(0.25, 0.25, 0.25),
        maxWidth: colWidth - 6,
      })
    })
    y -= lineHeight
  }

  page.drawText('Prepared by: ____________________', {
    x: margin,
    y: 26,
    size: 9,
    font,
    color: rgb(0.25, 0.25, 0.25),
  })
  page.drawText('Reviewed by: ____________________', {
    x: margin + 240,
    y: 26,
    size: 9,
    font,
    color: rgb(0.25, 0.25, 0.25),
  })
  page.drawText('Approved by: ____________________', {
    x: margin + 480,
    y: 26,
    size: 9,
    font,
    color: rgb(0.25, 0.25, 0.25),
  })

  const bytes = await pdfDoc.save()
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function safeFetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
) {
  const retries = options?.retries ?? 5
  const timeoutMs = options?.timeoutMs ?? 12000
  let lastError = 'Request failed'
  let lastStatus = 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers || {})
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }

      const response = await fetch(input, {
        ...(init || {}),
        signal: controller.signal,
        credentials: 'include',
        headers,
      })
      lastStatus = response.status
      const data = await response.json().catch(() => ({}))
      if (response.ok && data?.success !== false) {
        return { ok: true as const, data, status: response.status }
      }
      lastError = data?.error || `Request failed (${response.status})`
    } catch (error: any) {
      lastError = error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed'
    } finally {
      window.clearTimeout(timeout)
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)))
    }
  }

  return { ok: false as const, data: null, status: lastStatus, error: lastError }
}

interface PortalNotification {
  id: string
  title: string
  message: string
  type: string | null
  isRead: boolean
  createdAt: string
}

function formatNotificationTime(createdAt: string) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function formatRoleLabel(role: string | null | undefined) {
  const value = String(role || '').trim().toUpperCase()
  if (value === 'SUPER_ADMIN') return 'ADMIN'
  return value || 'N/A'
}

export function AdminPortal() {
  const { user, logout } = useAuth()
  const [activeView, setActiveView] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)

  useEffect(() => {
    async function fetchDashboardStats() {
      try {
        const response = await fetch('/api/dashboard/stats')
        if (response.ok) {
          const data = await response.json()
          setStats((data?.stats ?? null) as DashboardStats | null)
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchDashboardStats()
  }, [])

  const fetchNotifications = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) {
      setNotificationsLoading(true)
    }
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      if (!response.ok) return

      const payload = await response.json()
      const list = Array.isArray(payload?.notifications) ? payload.notifications : []
      setNotifications(list)
      setUnreadNotifications(Number(payload?.unreadCount || 0))
    } catch (error: any) {
      const message = String(error?.message || '')
      const isTransientFetchFailure =
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        error?.name === 'AbortError'
      if (!isTransientFetchFailure) {
        console.error('Failed to fetch notifications:', error)
      }
    } finally {
      if (!silent) {
        setNotificationsLoading(false)
      }
    }
  }

  const markAllNotificationsAsRead = async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      })
      if (!response.ok) return
      setUnreadNotifications(0)
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })))
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }

  const handleNotificationsOpen = async (open: boolean) => {
    if (!open) return
    await fetchNotifications()
    if (unreadNotifications > 0) {
      await markAllNotificationsAsRead()
    }
  }

  useEffect(() => {
    void fetchNotifications({ silent: true })
    const interval = setInterval(() => {
      void fetchNotifications({ silent: true })
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
  }

  const SidebarContent = () => {
    const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
      { id: 'orders', label: 'Orders', icon: ShoppingCart },
      { id: 'transportation', label: 'Transportation', icon: Truck },
      { id: 'replacements', label: 'Replacements', icon: AlertTriangle },
      { id: 'tracking', label: 'Live Tracking', icon: MapPin },
      { id: 'inventory', label: 'Inventory', icon: Archive },
      { id: 'warehouses', label: 'Warehouses', icon: Building2 },
      { id: 'stocks', label: 'Stocks', icon: Database },
      { id: 'feedback', label: 'Feedback', icon: MessageSquare },
      { id: 'reports', label: 'Reports', icon: FileText },
      { id: 'customers', label: 'Registered Customers', icon: Users },
      { id: 'users', label: 'Users', icon: Users },
      { id: 'settings', label: 'Settings', icon: Settings },
    ]

    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-white/20 bg-white/10 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <img
              src="/ann-anns-logo.png"
              alt="Ann Ann's Beverages Trading logo"
              className="h-11 w-11 rounded-xl border border-white/40 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
            />
            <div>
              <h2 className="font-bold text-slate-950">Ann Ann's Beverages Trading</h2>
              <p className="text-xs text-slate-600">Admin Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {navItems.map((item) => {
            const IconComponent = item.icon
            return (
              <Button
                key={item.id}
                variant={activeView === item.id ? 'default' : 'ghost'}
                className={`w-full justify-start gap-3 ${
                  activeView === item.id
                    ? 'border border-white/50 bg-linear-to-r from-sky-600/95 via-blue-600/95 to-cyan-500/95 text-white shadow-[0_14px_30px_rgba(37,99,235,0.28)] hover:from-sky-500 hover:via-blue-500 hover:to-cyan-400'
                    : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
                }`}
                onClick={() => {
                  setActiveView(item.id)
                  setSidebarOpen(false)
                }}
              >
                <IconComponent className="h-4 w-4" />
                <span>{item.label}</span>
              </Button>
            )
          })}
        </nav>

        {/* Logout Button */}
        <div className="p-4 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-slate-700 hover:bg-white/45 hover:text-red-600"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    )
  }

  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView stats={stats} isLoading={isLoading} />
      case 'orders':
        return <OrdersView />
      case 'trips':
        return <TripsView />
      case 'transportation':
        return <TransportationView />
      case 'warehouses':
        return <WarehousesView />
      case 'inventory':
        return <InventoryView />
      case 'stocks':
        return <StocksView />
      case 'replacements':
        return <ReplacementsView />
      case 'tracking':
        return <TrackingView />
      case 'feedback':
        return <FeedbackView />
      case 'reports':
        return <ReportsView />
      case 'customers':
        return <CustomersView />
      case 'users':
        return <UsersView />
      case 'settings':
        return <SettingsView />
      default:
        return <DashboardView stats={stats} isLoading={isLoading} />
    }
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.34),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(129,140,248,0.22),_transparent_32%),linear-gradient(145deg,_#e8f4ff_0%,_#eefbf4_52%,_#f6fbff_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 top-8 h-64 w-64 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="absolute right-[-4rem] top-24 h-72 w-72 rounded-full bg-cyan-200/20 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-1/3 h-72 w-72 rounded-full bg-emerald-200/20 blur-3xl" />
      </div>
      {/* Desktop Sidebar */}
      <aside className="relative z-[1] hidden w-64 flex-col border-r border-white/25 bg-white/38 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-2xl lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 border-white/30 bg-white/44 p-0 shadow-[0_24px_60px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="relative z-[1] flex min-h-screen flex-1 flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-10 border-b border-white/25 bg-white/42 backdrop-blur-2xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-700 hover:bg-white/45 hover:text-slate-950 lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="relative hidden md:block">
                <label className="sr-only" htmlFor="global-admin-search">Search orders and customers</label>
                <Input
                  id="global-admin-search"
                  placeholder="Search orders, customers..."
                  className="w-64 border-white/40 bg-white/50 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DropdownMenu onOpenChange={(open) => { void handleNotificationsOpen(open) }}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative text-slate-700 hover:bg-white/45 hover:text-slate-950">
                    <Bell className="h-5 w-5" />
                    {unreadNotifications > 0 && <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <div className="px-2 py-1.5 text-sm font-medium">Notifications</div>
                  <DropdownMenuSeparator />
                  {notificationsLoading ? (
                    <div className="px-2 py-3 text-sm text-gray-500">Loading notifications...</div>
                  ) : notifications.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-gray-500">No notifications yet.</div>
                  ) : (
                    notifications.slice(0, 8).map((item) => (
                      <div key={item.id} className="px-2 py-2 border-b last:border-b-0">
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        <p className="text-xs text-gray-600">{item.message}</p>
                        <p className="text-[11px] text-gray-500 mt-1">{formatNotificationTime(item.createdAt)}</p>
                      </div>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 text-slate-700 hover:bg-white/45 hover:text-slate-950">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-linear-to-br from-sky-600 to-blue-700 text-white text-sm shadow-[0_8px_18px_rgba(37,99,235,0.3)]">
                        {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden md:inline">{user?.name}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {/* DropdownMenuLabel removed */}
                    <div>
                      <p className="font-medium">{user?.name}</p>
                      <p className="text-xs text-gray-500">{user?.email}</p>
                    </div>
                  {/* DropdownMenuLabel removed */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setActiveView('settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {renderActiveView()}
        </main>
      </div>
    </div>
  )
}

// Dashboard View Component

// Placeholder views for other sections


