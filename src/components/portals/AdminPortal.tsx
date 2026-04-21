
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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil } from 'lucide-react';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer } from 'recharts';
import type { DashboardStats } from '@/types';
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync';
import { clearTabAuthToken, getTabAuthToken } from '@/lib/client-auth'

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

const PERCENT_HEIGHT_CLASSES: Record<number, string> = {
  0: 'h-0',
  5: 'h-[5%]',
  10: 'h-[10%]',
  15: 'h-[15%]',
  20: 'h-[20%]',
  25: 'h-1/4',
  30: 'h-[30%]',
  35: 'h-[35%]',
  40: 'h-2/5',
  45: 'h-[45%]',
  50: 'h-1/2',
  55: 'h-[55%]',
  60: 'h-3/5',
  65: 'h-[65%]',
  70: 'h-[70%]',
  75: 'h-3/4',
  80: 'h-4/5',
  85: 'h-[85%]',
  90: 'h-[90%]',
  95: 'h-[95%]',
  100: 'h-full',
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

function getHeightClass(value: number) {
  return PERCENT_HEIGHT_CLASSES[toPercentStep(value)] ?? 'h-0'
}

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

function toCsvValue(value: unknown) {
  if (value === null || value === undefined) return ''
  const normalized = String(value).replace(/\r?\n/g, ' ').replace(/"/g, '""')
  return `"${normalized}"`
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    toast.error(`No data to export for ${filename}`)
    return
  }
  const headers = Object.keys(rows[0])
  const csvLines = [headers.join(',')]
  rows.forEach((row) => {
    csvLines.push(headers.map((header) => toCsvValue(row[header])).join(','))
  })

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
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
  const retries = options?.retries ?? 1
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
          setStats(data)
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
      { id: 'trips', label: 'Trips & Deliveries', icon: Package },
      { id: 'transportation', label: 'Transportation', icon: Truck },
      { id: 'returns', label: 'Replacements', icon: AlertTriangle },
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
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            <img
              src="/ann-anns-logo.png"
              alt="Ann Ann's Beverages Trading logo"
              className="h-11 w-11 rounded-lg object-cover border"
            />
            <div>
              <h2 className="font-bold text-gray-900">Ann Ann's Beverages Trading</h2>
              <p className="text-xs text-gray-500">Admin Portal</p>
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
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
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
            className="w-full justify-start gap-3 text-gray-700 hover:bg-red-50 hover:text-red-600"
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
      case 'returns':
        return <ReturnsView />
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
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="bg-white border-b sticky top-0 z-10">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="relative hidden md:block">
                <label className="sr-only" htmlFor="global-admin-search">Search orders and customers</label>
                <Input
                  id="global-admin-search"
                  placeholder="Search orders, customers..."
                  className="pl-10 w-64"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DropdownMenu onOpenChange={(open) => { void handleNotificationsOpen(open) }}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
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
                  <Button variant="ghost" className="gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-blue-600 text-white text-sm">
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
function DashboardView({ stats, isLoading }: { stats: DashboardStats | null; isLoading: boolean }) {
  const [dashboardOrders, setDashboardOrders] = useState<any[]>([])

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const ordersRes = await fetch('/api/orders?limit=200&includeItems=none')

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json()
          setDashboardOrders(getCollection<any>(ordersData, ['orders']))
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      }
    }
    fetchDashboardData()
  }, [])

  const dashboardOrderStats = useMemo(() => {
    const totalOrders = Number(stats?.totalOrders || dashboardOrders.length || 0)
    const processing = Number(stats?.pendingOrders || 0)
    const loadedOutForDelivery = Number(stats?.processingOrders || 0)
    const outForDelivery = Number(stats?.inTransitOrders || 0)
    const delivered = Number(stats?.deliveredOrders || 0)
    const deliveredPaidRevenue = Number(stats?.totalRevenue || 0)

    return {
      totalOrders,
      processing,
      loadedOutForDelivery,
      outForDelivery,
      delivered,
      deliveredPaidRevenue,
    }
  }, [dashboardOrders.length, stats])

  const activeTripsFromData = Number(stats?.activeTrips || 0)
  const availableDrivers = Number(stats?.availableDrivers || stats?.activeDrivers || 0)

  const statCards = [
    { label: 'Total Orders', value: dashboardOrderStats.totalOrders, color: 'blue', icon: ShoppingCart },
    { label: 'Processing', value: dashboardOrderStats.processing, color: 'yellow', icon: Clock },
    { label: 'Loaded / Out for Delivery', value: dashboardOrderStats.loadedOutForDelivery, color: 'purple', icon: Truck },
    { label: 'Out for Delivery', value: dashboardOrderStats.outForDelivery, color: 'red', icon: MapPin },
    { label: 'Delivered', value: dashboardOrderStats.delivered, color: 'green', icon: CircleCheck },
    { label: 'Active Trips', value: activeTripsFromData, color: 'indigo', icon: Truck },
  ]

  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  }

  const last7Days = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (6 - index))
      return {
        key: formatDayKey(date),
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      }
    })
  }, [])

  const ordersComparisonData = useMemo(() => {
    const thisWeekCount = new Map<string, number>()
    const lastWeekCount = new Map<string, number>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (const order of dashboardOrders) {
      if (!order?.createdAt) continue
      const orderDate = new Date(order.createdAt)
      if (Number.isNaN(orderDate.getTime())) continue
      orderDate.setHours(0, 0, 0, 0)
      const dayDiff = Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))
      if (dayDiff >= 0 && dayDiff <= 6) {
        const orderKey = formatDayKey(orderDate)
        thisWeekCount.set(orderKey, (thisWeekCount.get(orderKey) || 0) + 1)
      } else if (dayDiff >= 7 && dayDiff <= 13) {
        const mappedLastWeekKeyDate = new Date(orderDate)
        mappedLastWeekKeyDate.setDate(mappedLastWeekKeyDate.getDate() + 7)
        const mappedLastWeekKey = formatDayKey(mappedLastWeekKeyDate)
        lastWeekCount.set(mappedLastWeekKey, (lastWeekCount.get(mappedLastWeekKey) || 0) + 1)
      }
    }

    return last7Days.map((day) => ({
      day: day.label,
      thisWeek: thisWeekCount.get(day.key) || 0,
      lastWeek: lastWeekCount.get(day.key) || 0,
    }))
  }, [dashboardOrders, last7Days])

  const revenueOverviewData = useMemo(() => {
    const dailyRevenue = new Map<string, number>()
    for (const order of dashboardOrders) {
      if (!order?.createdAt) continue
      if (String(order?.status || '').toUpperCase() !== 'DELIVERED') continue
      if (String(order?.paymentStatus || '').toLowerCase() !== 'paid') continue
      const orderDate = new Date(order.createdAt)
      if (Number.isNaN(orderDate.getTime())) continue
      const orderKey = formatDayKey(orderDate)
      dailyRevenue.set(orderKey, (dailyRevenue.get(orderKey) || 0) + Number(order.totalAmount || 0))
    }
    return last7Days.map((day) => ({
      day: day.label,
      value: Math.round(dailyRevenue.get(day.key) || 0),
    }))
  }, [dashboardOrders, last7Days])

  const weekRevenue = useMemo(() => revenueOverviewData.reduce((sum, entry) => sum + entry.value, 0), [revenueOverviewData])

  const ordersChartConfig = {
    thisWeek: {
      label: 'This Week',
      color: '#3b82f6',
    },
    lastWeek: {
      label: 'Last Week',
      color: '#1d4ed8',
    },
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Welcome back! Here's your logistics overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat, i) => (
          <Card key={i} className="relative overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm">
            <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
              <div className={`inline-flex w-fit rounded-xl border p-2.5 ${colorClasses[stat.color as keyof typeof colorClasses]}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div className="mt-4">
                <p className="text-2xl font-bold leading-none">{stat.value.toLocaleString()}</p>
                <p className="mt-2 text-sm leading-tight text-gray-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Total Revenue</p>
                <p className="text-3xl font-bold mt-1">
                  {formatPeso(dashboardOrderStats.deliveredPaidRevenue)}
                </p>
              </div>
              <TrendingUp className="h-10 w-10 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Available Drivers</p>
                <p className="text-3xl font-bold mt-1">{availableDrivers}</p>
              </div>
              <UserCheck className="h-10 w-10 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm">Avg. Customer Rating</p>
                <p className="text-3xl font-bold mt-1">{Number(stats?.avgRating || 0).toFixed(1)}</p>
              </div>
              <MessageSquare className="h-10 w-10 text-orange-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Orders This Week vs Last Week</CardTitle>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Month</span>
                <span className="rounded-md border border-blue-400 px-2 py-0.5 text-blue-600">Week</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={ordersChartConfig} className="h-[320px] w-full">
              <AreaChart data={ordersComparisonData} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillThisWeekAdmin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.08} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <YAxis axisLine={false} tickLine={false} width={28} domain={[0, 'auto']} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} />
                <Area type="monotone" dataKey="thisWeek" stroke="#3b82f6" strokeWidth={2.5} fill="url(#fillThisWeekAdmin)" dot={false} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>This Week Statistics</CardDescription>
            <CardTitle className="text-3xl">{formatPeso(weekRevenue)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] flex items-end gap-3">
              {revenueOverviewData.map((item) => {
                const maxRevenueBar = Math.max(...revenueOverviewData.map((d) => d.value), 1)
                return (
                  <div key={item.day} className="flex-1 flex flex-col items-center gap-2">
                    <div className="h-full w-full rounded-t-md bg-cyan-100/50 relative min-h-[18px] overflow-hidden">
                      <div className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-cyan-400 min-h-[18px] ${getHeightClass((item.value / maxRevenueBar) * 100)}`} />
                    </div>
                    <span className="text-[10px] text-gray-500">{item.day}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Low Stock Alerts
            </CardTitle>
            <CardDescription>Items that need restocking soon</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{stats?.lowStockItems || 0}</h1>
                  <p className="text-sm text-gray-500">Items currently below threshold</p>
                </div>
                <Badge variant={Number(stats?.lowStockItems || 0) > 0 ? 'destructive' : 'secondary'}>
                  {Number(stats?.lowStockItems || 0) > 0 ? 'Needs Action' : 'Stable'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {/* <Undo2 className="h-5 w-5 text-purple-500" /> */}
              Pending Replacements
            </CardTitle>
            <CardDescription>Replacement cases awaiting review</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="font-medium">{stats?.pendingReturns || 0} pending replacement case(s)</p>
                  <p className="text-sm text-gray-500">Awaiting admin follow-up or closure</p>
                </div>
                <Badge variant={Number(stats?.pendingReturns || 0) > 0 ? 'secondary' : 'outline'}>
                  {Number(stats?.pendingReturns || 0) > 0 ? 'Pending' : 'Clear'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Placeholder views for other sections
function OrdersView() {
  const [orders, setOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false)
  const [rejectOrder, setRejectOrder] = useState<any | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false)
  const [dispatchForm, setDispatchForm] = useState({
    itemsVerified: false,
    quantityVerified: false,
    packagingVerified: false,
    vehicleAssigned: false,
    driverAssigned: false,
    signoffName: '',
    shortLoadQty: 0,
    damagedOnLoadingQty: 0,
    holdReason: '',
    exceptionNotes: '',
  })

  useEffect(() => {
    let isMounted = true
    let isFetchingOrders = false

    async function fetchOrders(silent = false) {
      if (isFetchingOrders) return
      isFetchingOrders = true
      try {
        const requestOrders = () => fetch('/api/orders?limit=100&includeItems=preview', { credentials: 'include' })

        let response = await requestOrders()
        let data = await response.json().catch(() => ({}))

        if (response.status === 401 || response.status === 403) {
          clearTabAuthToken()
          response = await requestOrders()
          data = await response.json().catch(() => ({}))
          if (response.status === 401 || response.status === 403) {
            if (isMounted) {
              setOrders([])
            }
            return
          }
        }

        if (!response.ok || data?.success === false) {
          throw new Error(data?.error || 'Failed to fetch orders')
        }

        if (isMounted) {
          setOrders(getCollection<any>(data, ['orders']))
        }
      } catch (error) {
        if (!silent) {
          console.error('Failed to fetch orders:', error)
        }
      } finally {
        isFetchingOrders = false
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchOrders()

    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.includes('orders') || message.scopes.includes('trips')) {
        void fetchOrders(true)
      }
    })

    const onFocus = () => {
      void fetchOrders(true)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchOrders(true)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchOrders(true)
      }
    }, 15000)

    return () => {
      isMounted = false
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [])

  const openOrderDetail = async (order: any) => {
    setSelectedOrder(order)
    setLoadingOrderDetail(true)
    try {
      const response = await fetch(`/api/orders/${order.id}`, { credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false || !payload?.order) return
      setSelectedOrder(payload.order)
    } catch (error) {
      console.error('Failed to load full order details:', error)
    } finally {
      setLoadingOrderDetail(false)
    }
  }

  const formatOrderStatus = (status: string, paymentStatus?: string) => {
    if (String(paymentStatus || '').toLowerCase() === 'pending_approval') {
      return 'PENDING'
    }
    const raw = String(status || '').toUpperCase()
    if (['PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'UNAPPROVED'].includes(raw)) return 'PREPARING'
    if (['DISPATCHED', 'IN_TRANSIT'].includes(raw)) return 'OUT FOR DELIVERY'
    if (raw === 'FAILED_DELIVERY') return 'CANCELLED'
    return raw.replace(/_/g, ' ')
  }

  const formatWarehouseStage = (stage: string | null | undefined) => {
    const value = String(stage || 'READY_TO_LOAD').toUpperCase()
    return value.replace(/_/g, ' ')
  }

  const mergeOrderState = (orderId: string, updatedOrder: any, fallbackStatus?: string) => {
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              ...(updatedOrder || {}),
              status: updatedOrder?.status || fallbackStatus || order.status,
            }
          : order
      )
    )
    setSelectedOrder((prev) =>
      prev && prev.id === orderId
        ? {
            ...prev,
            ...(updatedOrder || {}),
            status: updatedOrder?.status || fallbackStatus || prev.status,
          }
        : prev
    )
  }

  const formatOrderAddress = (order: any) => {
    const address = String(order?.shippingAddress || '').trim()
    const city = String(order?.shippingCity || '').trim()
    const province = String(order?.shippingProvince || '').trim()
    const zipCode = String(order?.shippingZipCode || '').trim()

    const normalize = (value: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()

    const addressTokens = address
      .split(',')
      .map((token: string) => token.trim())
      .filter(Boolean)

    const existingTokenSet = new Set(addressTokens.map((token: string) => normalize(token)))
    const extras = [city, province, zipCode].filter((part) => {
      if (!part) return false
      const key = normalize(part)
      if (!key) return false
      if (existingTokenSet.has(key)) return false
      existingTokenSet.add(key)
      return true
    })

    const combined = [address, ...extras].filter(Boolean).join(', ')
    return combined || 'N/A'
  }

  const updateOrderStatus = async (
    orderId: string,
    status: 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED',
    reason?: string
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason }),
      })
      const responseText = await response.text()
      let payload: any = {}
      if (responseText) {
        try {
          payload = JSON.parse(responseText)
        } catch {
          payload = { raw: responseText }
        }
      }
      if (!response.ok || payload?.success === false) {
        const backendError =
          payload?.error ||
          payload?.message ||
          (typeof payload?.raw === 'string' ? payload.raw.replace(/<[^>]*>/g, ' ').trim().slice(0, 180) : '')
        throw new Error(
          backendError
            ? `Failed to update status (HTTP ${response.status}): ${backendError}`
            : `Failed to update status (HTTP ${response.status})`
        )
      }

      const updatedOrder = payload?.order
      mergeOrderState(orderId, updatedOrder, status)
      emitDataSync(['orders', 'trips'])
      toast.success('Order status updated')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update order status')
      return false
    } finally {
      setUpdatingOrderId(null)
    }
  }

  const updateWarehouseStage = async (
    orderId: string,
    stage: 'READY_TO_LOAD' | 'LOADED' | 'DISPATCHED',
    payload: Partial<typeof dispatchForm> = {}
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/warehouse-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseStage: stage,
          checklist: {
            itemsVerified: payload.itemsVerified,
            quantityVerified: payload.quantityVerified,
            packagingVerified: payload.packagingVerified,
            vehicleAssigned: payload.vehicleAssigned,
            driverAssigned: payload.driverAssigned,
          },
          signoffName: payload.signoffName,
          shortLoadQty: payload.shortLoadQty,
          damagedOnLoadingQty: payload.damagedOnLoadingQty,
          holdReason: payload.holdReason,
          exceptionNotes: payload.exceptionNotes,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || 'Failed to update warehouse stage')
      }

      mergeOrderState(orderId, result?.order)
      emitDataSync(['orders', 'trips'])
      toast.success(result?.message || `Warehouse stage moved to ${stage.replace(/_/g, ' ')}`)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update warehouse stage')
      return false
    } finally {
      setUpdatingOrderId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-500">Manage customer orders and fulfillment</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              {/* <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" /> */}
              <p className="text-gray-500">No orders found</p>
              <Button className="mt-4">Create First Order</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">ORDER ID</th>
                    <th className="text-left p-4 font-medium text-gray-600">CUSTOMER</th>
                    <th className="text-left p-4 font-medium text-gray-600">PRODUCTS</th>
                    <th className="text-left p-4 font-medium text-gray-600">DELIVERY</th>
                    <th className="text-left p-4 font-medium text-gray-600">VALUE</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order: any) => (
                    <tr key={order.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {/* <Package className="h-4 w-4 text-gray-400" /> */}
                          <span className="font-semibold text-gray-900">{order.orderNumber}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold text-gray-900">{order.customer?.name || order.shippingName || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{order.shippingCity || order.shippingProvince || 'N/A'}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-gray-900">
                          {toArray<any>(order.items)
                            .slice(0, 2)
                            .map((item) => `${item.product?.name || 'Product'} x${item.quantity}`)
                            .join(', ') || 'No items'}
                          {Number(order.itemCount || toArray<any>(order.items).length) > 2
                            ? ` +${Number(order.itemCount || toArray<any>(order.items).length) - 2} more`
                            : ''}
                        </p>
                        <p className="text-sm text-gray-500">
                          {order.priority === 'high' || order.priority === 'urgent' ? 'Express' : 'Standard'}
                        </p>
                      </td>
                      <td className="p-4 text-gray-600">
                        {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 font-semibold text-gray-900">{formatPeso(order.totalAmount || 0)}</td>
                      <td className="p-4">
                        {(() => {
                          const orderStatus = String(order.status || '').toUpperCase()
                          const isPendingApproval = String(order.paymentStatus || '').toLowerCase() === 'pending_approval'
                          return (
                        <div className="flex items-center gap-3">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => void openOrderDetail(order)}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={() => updateOrderStatus(order.id, 'PREPARING')}
                            disabled={(!['PENDING', 'CONFIRMED'].includes(orderStatus) && !isPendingApproval) || updatingOrderId === order.id}
                            title="Approve order"
                          >
                            <CircleCheck className="h-5 w-5" />
                          </Button>
                        </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent>
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Order Details - {selectedOrder.orderNumber}</DialogTitle>
                <DialogDescription>Complete order and client information</DialogDescription>
              </DialogHeader>
              {loadingOrderDetail ? (
                <div className="h-20 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : null}
              <div className="space-y-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Order Status</p>
                  <p className="font-semibold">{formatOrderStatus(selectedOrder.status, selectedOrder.paymentStatus)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-gray-500">Warehouse Stage</p>
                  <p className="font-semibold">{formatWarehouseStage(selectedOrder.warehouseStage)}</p>
                  <p className="text-xs text-gray-600">
                    Checklist: {selectedOrder.checklistItemsVerified ? 'Items' : '-'} {selectedOrder.checklistQuantityVerified ? '| Qty' : ''}{' '}
                    {selectedOrder.checklistPackagingVerified ? '| Packaging' : ''} {selectedOrder.checklistVehicleAssigned ? '| Vehicle' : ''}{' '}
                    {selectedOrder.checklistDriverAssigned ? '| Driver' : ''}
                  </p>
                  {(selectedOrder.exceptionHoldReason || selectedOrder.exceptionShortLoadQty || selectedOrder.exceptionDamagedOnLoadingQty) ? (
                    <p className="text-xs text-red-600">
                      Exceptions: short load {Number(selectedOrder.exceptionShortLoadQty || 0)}, damaged {Number(selectedOrder.exceptionDamagedOnLoadingQty || 0)}
                      {selectedOrder.exceptionHoldReason ? `, hold: ${selectedOrder.exceptionHoldReason}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium">Client Information</p>
                  <p className="text-sm text-gray-700">{selectedOrder.customer?.name || selectedOrder.shippingName || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.customer?.email || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.shippingPhone || selectedOrder.customer?.phone || 'N/A'}</p>
                  <p className="text-sm text-gray-600">
                    {formatOrderAddress(selectedOrder)}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-2">Order Details</p>
                  <div className="space-y-1">
                    {(selectedOrder.items || []).map((item: any) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span>{item.product?.name || 'Product'} x{item.quantity}</span>
                        <span>{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                      </div>
                    ))}
                    <p className="text-right font-semibold pt-2">Total: {formatPeso(selectedOrder.totalAmount || 0)}</p>
                  </div>
                </div>
                {(() => {
                  const selectedOrderStatus = String(selectedOrder.status || '').toUpperCase()
                  const selectedWarehouseStage = String(selectedOrder.warehouseStage || 'READY_TO_LOAD').toUpperCase()
                  const isPendingApproval = String(selectedOrder.paymentStatus || '').toLowerCase() === 'pending_approval'
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {!isPendingApproval && selectedOrderStatus === 'PREPARING' ? (
                        <Button
                          className="bg-amber-600 text-white hover:bg-amber-700"
                          onClick={() => void updateWarehouseStage(selectedOrder.id, 'LOADED')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Mark as Loaded
                        </Button>
                      ) : isPendingApproval || ['PENDING', 'CONFIRMED'].includes(selectedOrderStatus) ? (
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void updateOrderStatus(selectedOrder.id, 'PREPARING')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Approve Order
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          No Action
                        </Button>
                      )}
                      {!isPendingApproval && selectedWarehouseStage !== 'READY_TO_LOAD' ? (
                        <Button
                          variant="outline"
                          onClick={() => void updateWarehouseStage(selectedOrder.id, 'READY_TO_LOAD')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Set Ready To Load
                        </Button>
                      ) : null}
                      {!isPendingApproval && selectedWarehouseStage === 'LOADED' ? (
                        <Button
                          className="bg-blue-600 text-white hover:bg-blue-700"
                          onClick={() => {
                            setDispatchForm({
                              itemsVerified: !!selectedOrder.checklistItemsVerified,
                              quantityVerified: !!selectedOrder.checklistQuantityVerified,
                              packagingVerified: !!selectedOrder.checklistPackagingVerified,
                              vehicleAssigned: !!selectedOrder.checklistVehicleAssigned,
                              driverAssigned: !!selectedOrder.checklistDriverAssigned,
                              signoffName: String(selectedOrder.dispatchSignedOffBy || ''),
                              shortLoadQty: Number(selectedOrder.exceptionShortLoadQty || 0),
                              damagedOnLoadingQty: Number(selectedOrder.exceptionDamagedOnLoadingQty || 0),
                              holdReason: String(selectedOrder.exceptionHoldReason || ''),
                              exceptionNotes: String(selectedOrder.exceptionNotes || ''),
                            })
                            setDispatchDialogOpen(true)
                          }}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Dispatch With Checklist
                        </Button>
                      ) : null}
                      {!isPendingApproval && selectedOrderStatus === 'OUT_FOR_DELIVERY' ? (
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void updateOrderStatus(selectedOrder.id, 'DELIVERED')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Mark Delivered
                        </Button>
                      ) : null}
                      <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                        Close
                      </Button>
                    </div>
                  )
                })()}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispatch Checklist & Signoff</DialogTitle>
            <DialogDescription>Complete required checks before dispatching this order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['itemsVerified', 'Items verified'],
                ['quantityVerified', 'Quantity verified'],
                ['packagingVerified', 'Packaging verified'],
                ['vehicleAssigned', 'Vehicle assigned'],
                ['driverAssigned', 'Driver assigned'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded border p-2">
                  <input
                    type="checkbox"
                    checked={Boolean((dispatchForm as any)[key])}
                    onChange={(event) =>
                      setDispatchForm((prev) => ({
                        ...prev,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <Input
              placeholder="Signoff name (required)"
              value={dispatchForm.signoffName}
              onChange={(event) => setDispatchForm((prev) => ({ ...prev, signoffName: event.target.value }))}
            />

            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={0}
                placeholder="Short load qty"
                value={dispatchForm.shortLoadQty}
                onChange={(event) => setDispatchForm((prev) => ({ ...prev, shortLoadQty: Number(event.target.value || 0) }))}
              />
              <Input
                type="number"
                min={0}
                placeholder="Damaged on loading qty"
                value={dispatchForm.damagedOnLoadingQty}
                onChange={(event) => setDispatchForm((prev) => ({ ...prev, damagedOnLoadingQty: Number(event.target.value || 0) }))}
              />
            </div>

            <Input
              placeholder="Hold reason (leave blank if no hold)"
              value={dispatchForm.holdReason}
              onChange={(event) => setDispatchForm((prev) => ({ ...prev, holdReason: event.target.value }))}
            />

            <textarea
              className="w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Exception notes"
              value={dispatchForm.exceptionNotes}
              onChange={(event) => setDispatchForm((prev) => ({ ...prev, exceptionNotes: event.target.value }))}
            />

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDispatchDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={async () => {
                  if (!selectedOrder?.id) return
                  const done = await updateWarehouseStage(selectedOrder.id, 'DISPATCHED', dispatchForm)
                  if (done) {
                    setDispatchDialogOpen(false)
                  }
                }}
                disabled={updatingOrderId === selectedOrder?.id}
              >
                Confirm Dispatch
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectOrder} onOpenChange={(open) => !open && setRejectOrder(null)}>
        <DialogContent>
          {rejectOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Reject Order</DialogTitle>
                <DialogDescription>Please provide a reason for rejecting order {rejectOrder.orderNumber}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Rejection Reason</label>
                <textarea
                  className="w-full min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Enter rejection reason..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setRejectOrder(null)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700"
                    onClick={async () => {
                      if (!rejectReason.trim()) {
                        toast.error('Rejection reason is required')
                        return
                      }
                      if (!['PREPARING'].includes(rejectOrder.status)) {
                        toast.error('You can only update eligible delivery orders')
                        return
                      }
                      await updateOrderStatus(rejectOrder.id, 'PREPARING', rejectReason.trim())
                      setRejectOrder(null)
                    }}
                    disabled={updatingOrderId === rejectOrder.id}
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TripsView() {
    const [selectedTrip, setSelectedTrip] = useState<any | null>(null)
  const [trips, setTrips] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [routePlans, setRoutePlans] = useState<any[]>([])
  const [savedRoutes, setSavedRoutes] = useState<any[]>([])
  const [routeDate, setRouteDate] = useState(getDefaultRouteDate())
  const [routeWarehouseId, setRouteWarehouseId] = useState('')
  const [selectedRouteCity, setSelectedRouteCity] = useState('')
  const [selectedRouteOrderIds, setSelectedRouteOrderIds] = useState<string[]>([])
  const [selectedSavedRouteId, setSelectedSavedRouteId] = useState('')
  const [selectedRouteDriverId, setSelectedRouteDriverId] = useState('')
  const [selectedRouteVehicleId, setSelectedRouteVehicleId] = useState('')
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [loadingRoutePlans, setLoadingRoutePlans] = useState(false)
  const [creatingTripFromRoute, setCreatingTripFromRoute] = useState(false)
  const [routePlanMessage, setRoutePlanMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Auto-fill popup when opened
  useEffect(() => {
    if (createRouteOpen && warehouses.length > 0) {
      // Pre-select first warehouse if not already selected
      if (!routeWarehouseId) {
        setRouteWarehouseId(warehouses[0].id)
      }
      // Pre-select today's date if not already set
      if (!routeDate) {
        setRouteDate(getDefaultRouteDate())
      }
      // Auto-filter orders if not already filtered
      if (routePlans.length === 0) {
        createRoutePlan(true, routeDate, warehouses[0].id)
      }
    }
  }, [createRouteOpen, warehouses])

  // Auto-select all orders for first city group after filtering
  useEffect(() => {
    if (routePlans.length > 0 && selectedRouteCity === '') {
      const firstGroup = routePlans[0]
      if (firstGroup) {
        setSelectedRouteCity(firstGroup.city)
        setSelectedRouteOrderIds(toArray<any>(firstGroup.orders).map((order: any) => order.id))
      }
    }
  }, [routePlans])

  const selectedRouteGroup = routePlans.find((group) => group.city === selectedRouteCity) || null
  const selectedRouteOrders = toArray<any>(selectedRouteGroup?.orders).filter((order) => selectedRouteOrderIds.includes(order.id))
  const selectedSavedRoute = savedRoutes.find((route) => route.id === selectedSavedRouteId) || null
  const selectedDriverAssignedVehicle = toArray<any>(drivers.find((d) => d.id === selectedRouteDriverId)?.vehicles)
    .map((entry) => entry?.vehicle)
    .find((vehicle) => vehicle?.id)

  const fetchSavedRoutes = async () => {
    try {
      const response = await fetch('/api/trips/saved-routes?limit=200')
      if (!response.ok) throw new Error('Failed to load saved routes')
      const data = await response.json().catch(() => ({}))
      setSavedRoutes(getCollection<any>(data, ['savedRoutes']))
    } catch (error) {
      console.error('Failed to fetch saved routes:', error)
      setSavedRoutes([])
    }
  }

  const deleteSavedRouteDraft = async (routeId: string) => {
    const response = await fetch('/api/trips/saved-routes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: routeId }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || 'Failed to delete saved route')
    }
  }

  const removeSavedRoute = async (routeId: string) => {
    try {
      await deleteSavedRouteDraft(routeId)
      setSavedRoutes((prev) => prev.filter((route) => route.id !== routeId))
      setSelectedSavedRouteId((prev) => (prev === routeId ? '' : prev))
      toast.success('Route deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete route')
    }
  }

  useEffect(() => {
    async function fetchTripsAndMeta() {
      try {
        const [tripsResponse, warehousesResponse, driversResponse, vehiclesResponse, savedRoutesResponse] = await Promise.all([
          fetch('/api/trips?limit=100'),
          fetch('/api/warehouses'),
          fetch('/api/drivers'),
          fetch('/api/vehicles?status=AVAILABLE'),
          fetch('/api/trips/saved-routes?limit=200'),
        ])

        if (tripsResponse.ok) {
          const tripsData = await tripsResponse.json()
          setTrips(getCollection<any>(tripsData, ['trips']))
        }

        if (warehousesResponse.ok) {
          const warehousesData = await warehousesResponse.json()
          const list = getCollection<any>(warehousesData, ['warehouses'])
          setWarehouses(list)
          if (list[0]?.id) {
            setRouteWarehouseId((prev) => prev || list[0].id)
          }
        }

        if (driversResponse.ok) {
          const driversData = await driversResponse.json()
          const list = getCollection<any>(driversData, ['drivers'])
          setDrivers(list)
          const preferredDriver =
            list.find((driver: any) => driver?.isActive !== false && toArray<any>(driver?.vehicles).some((entry: any) => entry?.vehicle?.id)) ||
            list.find((driver: any) => driver?.isActive !== false) ||
            list[0]

          if (preferredDriver?.id) {
            setSelectedRouteDriverId((prev) => prev || preferredDriver.id)
          }
        }

        if (vehiclesResponse.ok) {
          const vehiclesData = await vehiclesResponse.json()
          const list = getCollection<any>(vehiclesData, ['vehicles'])
          setVehicles(list)
          if (list[0]?.id) {
            setSelectedRouteVehicleId((prev) => prev || list[0].id)
          }
        }

        if (savedRoutesResponse.ok) {
          const savedRoutesData = await savedRoutesResponse.json().catch(() => ({}))
          setSavedRoutes(getCollection<any>(savedRoutesData, ['savedRoutes']))
        }
      } catch (error) {
        console.error('Failed to fetch trips meta:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchTripsAndMeta()
  }, [])

  const refreshTrips = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/trips?limit=100')
      if (!response.ok) throw new Error('Failed trips fetch')
      const data = await response.json()
      setTrips(getCollection<any>(data, ['trips']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load trips')
    } finally {
      setIsLoading(false)
    }
  }

  const createRoutePlan = async (silent = false, inputDate?: string, inputWarehouseId?: string) => {
    const effectiveDate = inputDate ?? routeDate
    const effectiveWarehouseId = inputWarehouseId ?? routeWarehouseId
    if (!effectiveDate || !effectiveWarehouseId) {
      if (!silent) toast.error('Select route date and warehouse')
      setRoutePlanMessage({ type: 'error', text: 'Select route date and warehouse first.' })
      return false
    }

    setLoadingRoutePlans(true)
    setRoutePlanMessage(null)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const query = new URLSearchParams({
        date: effectiveDate,
        warehouseId: effectiveWarehouseId,
      });
      const response = await fetch(`/api/trips/route-plan?${query.toString()}`, {
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to generate route plan');
      }

      const plans = getCollection<any>(data, ['routePlans']);
      setRoutePlans(plans);
      setSelectedRouteCity(plans[0]?.city || '');
      setSelectedRouteOrderIds(toArray<any>(plans[0]?.orders).map((order) => order.id));
      if (plans.length === 0) {
        setRoutePlanMessage({
          type: 'info',
          text: 'No eligible orders found for that delivery date.',
        });
      } else {
        setRoutePlanMessage({ type: 'success', text: `Found ${plans.length} city group(s) for this delivery date.` });
        if (!silent) toast.success('Filtered scheduled orders by city')
      }
      return plans.length > 0;
    } catch (error: any) {
      const message =
        error?.name === 'AbortError' ? 'Request timed out. Please try again.' : error?.message || 'Failed to generate route plan';
      if (!silent) toast.error(message);
      setRoutePlanMessage({ type: 'error', text: message });
      setRoutePlans([]);
      setSelectedRouteCity('');
      setSelectedRouteOrderIds([]);
      return false;
    } finally {
      clearTimeout(timeout);
      setLoadingRoutePlans(false);
    }
  }

  const handleRouteOrderClick = (city: string, orderId: string) => {
    setSelectedRouteCity(city)
    setSelectedRouteOrderIds((prev) => {
      const belongsToCity = toArray<any>(routePlans.find((group) => group.city === city)?.orders).some((order) => order.id === orderId)
      if (!belongsToCity) return [orderId]
      if (prev.includes(orderId)) {
        const next = prev.filter((id) => id !== orderId)
        return next.length > 0 ? next : [orderId]
      }
      return [...prev, orderId]
    })
  }

  const createTripFromRoute = async () => {
    if (!selectedSavedRoute || !selectedRouteDriverId) {
      toast.error('Select a saved route and driver first')
      return
    }
    if (selectedSavedRoute.orderIds.length === 0) {
      toast.error('Selected saved route has no orders')
      return
    }
    if (!selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }

    setCreatingTripFromRoute(true)
    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannedStartAt: selectedSavedRoute.date,
          status: 'PLANNED',
          warehouseId: selectedSavedRoute.warehouseId,
          driverId: selectedRouteDriverId,
          vehicleId: selectedDriverAssignedVehicle.id,
          orderIds: selectedSavedRoute.orderIds,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to create trip')
      }
      toast.success('Trip created from route')
      try {
        await deleteSavedRouteDraft(selectedSavedRoute.id)
      } catch (deleteError) {
        console.error('Failed to delete saved route:', deleteError)
      }
      setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
      setSelectedSavedRouteId('')
      setCreateTripOpen(false)
      await refreshTrips()
    } catch (error: any) {
      const message = String(error?.message || 'Failed to create trip')
      const lowerMessage = message.toLowerCase()

      if (lowerMessage.includes('no eligible orders') || lowerMessage.includes('already assigned')) {
        try {
          await deleteSavedRouteDraft(selectedSavedRoute.id)
        } catch (deleteError) {
          console.error('Failed to delete stale saved route:', deleteError)
        }
        setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
        setSelectedSavedRouteId('')
        setCreateTripOpen(false)
        await refreshTrips()
        toast.success('Trip data refreshed. Stale saved route was removed.')
      } else {
        toast.error(message)
      }
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const saveRouteDraft = async () => {
    if (!routeDate || !routeWarehouseId || !selectedRouteCity || selectedRouteOrderIds.length === 0) {
      toast.error('Select date, warehouse, city and at least one order')
      return
    }

    const warehouse = warehouses.find((w) => w.id === routeWarehouseId)
    const group = routePlans.find((g) => g.city === selectedRouteCity)
    const selectedOrders = toArray<any>(group?.orders).filter((order) => selectedRouteOrderIds.includes(order.id))

    if (!group || selectedOrders.length === 0) {
      toast.error('No orders selected for this route')
      return
    }

    try {
      const response = await fetch('/api/trips/saved-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: routeDate,
          warehouseId: routeWarehouseId,
          warehouseName: warehouse?.name || 'Unknown Warehouse',
          city: selectedRouteCity,
          totalDistanceKm: Number(group.totalDistanceKm || 0),
          orderIds: selectedRouteOrderIds,
          orders: selectedOrders,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to save route')
      }

      const savedRoute = data?.savedRoute
      if (savedRoute?.id) {
        setSavedRoutes((prev) => [savedRoute, ...prev.filter((route) => route.id !== savedRoute.id)])
        setSelectedSavedRouteId(savedRoute.id)
      } else {
        await fetchSavedRoutes()
      }

      setCreateRouteOpen(false)
      toast.success('Route saved. Assign driver later in New Trip.')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save route')
    }
  }

  const statusColors: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    COMPLETED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
  }

  return (
    <>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trips & Deliveries</h1>
          <p className="text-gray-500">Manage delivery trips and schedules</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateRouteOpen(true)} className="bg-black text-white hover:bg-black/90 rounded-xl px-4">
            Create Route
          </Button>
          <Button
            onClick={() => setCreateTripOpen(true)}
            className="bg-black text-white hover:bg-black/90 rounded-xl px-4"
            disabled={savedRoutes.length === 0}
          >
            <Truck className="h-4 w-4 mr-2" />
            New Trip
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Saved Routes
          </CardTitle>
          <CardDescription>Routes created ahead of time. Use New Trip to assign driver and dispatch.</CardDescription>
        </CardHeader>
        <CardContent>
          {savedRoutes.length === 0 ? (
            <div className="h-44 rounded-md border bg-gray-50 flex flex-col items-center justify-center text-center px-4">
              <p className="text-gray-600">No saved routes yet</p>
              <p className="text-sm text-gray-500">Click "Create Route" to save routes for later dispatch</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedRoutes.map((route: any) => (
                <div key={route.id} className="rounded-md border">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b">
                    <p className="font-medium">{route.city}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-600">{route.orderIds.length} orders - {Number(route.totalDistanceKm || 0).toFixed(2)} km total</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                        onClick={() => {
                          void removeSavedRoute(route.id)
                        }}
                      >
                        Delete Route
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <p className="text-xs text-gray-500">
                      {route.warehouseName} • {new Date(route.date).toLocaleDateString()}
                    </p>
                    {toArray<any>(route.orders).map((order: any) => (
                      <div key={order.id} className="flex items-center justify-between text-sm">
                        <p><span className="font-medium">{order.orderNumber}</span> - {order.customerName}</p>
                        <p className="text-gray-600">{order.distanceKm !== null ? `${Number(order.distanceKm).toFixed(2)} km` : 'No geo data'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : trips.length === 0 ? (
            <div className="text-center py-12">
              <Truck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No trips found</p>
              <Button className="mt-4">Create First Trip</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {trips.map((trip: any) => (
                <div
                  key={trip.id}
                  className="rounded-xl border bg-white shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedTrip(trip)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-semibold text-gray-900">{trip.tripNumber}</span>
                        <Badge className={`${statusColors[normalizeTripStatus(trip.status)] || 'bg-gray-100'} text-xs px-2 py-0.5`}>
                          {normalizeTripStatus(trip.status).replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="text-[13px] text-gray-700">
                        Vehicle: {trip.vehicle?.licensePlate || 'Unassigned'} • Driver: {trip.driver?.user?.name || 'Unassigned'}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Route: {(trip.route?.start || trip.origin || 'Warehouse')} {'->'} {(trip.route?.end || trip.destination || trip.destinationCity || 'Destination')}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-8 px-3 text-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedTrip(trip)
                      }}
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        {/* Trip Details Dialog (outside conditional block) */}
        <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
          <DialogContent className="max-w-3xl w-full">
            {selectedTrip && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg font-bold text-gray-900">{selectedTrip.tripNumber}</span>
                  <Badge className={statusColors[normalizeTripStatus(selectedTrip.status)] || 'bg-gray-100'}>{normalizeTripStatus(selectedTrip.status).replace(/_/g, ' ')}</Badge>
                </div>
                <div className="flex flex-wrap gap-6 mb-2 text-sm">
                  <div>
                    <span className="font-semibold">Vehicle:</span> {selectedTrip.vehicle?.licensePlate || 'Unassigned'}
                  </div>
                  <div>
                    <span className="font-semibold">Driver:</span> {selectedTrip.driver?.user?.name || 'Unassigned'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-6 mb-2 text-sm">
                  <div>
                    <span className="font-semibold">Progress:</span> {selectedTrip.completedDropPoints ?? 0}/{selectedTrip.totalDropPoints ?? 0}
                  </div>
                  <div>
                    <span className="font-semibold">Drop points:</span> {selectedTrip.dropPoints?.length ?? 0}
                  </div>
                </div>

                <div className="rounded-lg border bg-gray-50 p-3">
                  <p className="text-sm font-semibold text-gray-900 mb-2">Drop Point Details</p>
                  {Array.isArray(selectedTrip.dropPoints) && selectedTrip.dropPoints.length > 0 ? (
                    <div className="space-y-2 max-h-72 overflow-auto pr-1">
                      {selectedTrip.dropPoints.map((point: any, index: number) => {
                        const statusLabel = String(point.status || 'PENDING').replace(/_/g, ' ')
                        const statusClass =
                          ['COMPLETED', 'DELIVERED'].includes(String(point.status || ''))
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : ['FAILED', 'FAILED_DELIVERY', 'CANCELLED', 'SKIPPED'].includes(String(point.status || ''))
                              ? 'bg-red-100 text-red-700 border-red-200'
                              : ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ARRIVED'].includes(String(point.status || ''))
                                ? 'bg-blue-100 text-blue-700 border-blue-200'
                                : 'bg-gray-100 text-gray-700 border-gray-200'

                        const hasCoordinates =
                          typeof point.latitude === 'number' && typeof point.longitude === 'number'

                        return (
                          <div key={point.id || `${selectedTrip.id}-dp-${index}`} className="rounded-md border bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-900">
                                Drop Point {index + 1}: {point.locationName || 'Unnamed drop point'}
                              </p>
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                                {statusLabel}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-600">
                              {hasCoordinates
                                ? `Coordinates: ${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`
                                : 'Coordinates: Not available'}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No drop-point records attached to this trip yet.</p>
                  )}
                </div>
                <div className="flex justify-end mt-4">
                  <Button variant="outline" onClick={() => setSelectedTrip(null)}>Close</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        </CardContent>
      </Card>


      <Dialog open={createRouteOpen} onOpenChange={setCreateRouteOpen}>
        <DialogContent className="w-[98vw] min-w-[1400px] h-full max-w-none max-h-[95vh] m-auto rounded-xl shadow-xl overflow-hidden p-0 flex items-stretch justify-center z-[60]">
          <DialogHeader>
            <DialogTitle className="sr-only">Create Delivery Route</DialogTitle>
          </DialogHeader>
          <div className="flex flex-row w-full h-full">
            {/* Left: Filters and Orders Preview */}
            <div className="flex flex-col bg-white border-r p-8 min-w-[340px] max-w-[400px] w-[360px]">
              <h2 className="text-2xl font-bold mb-6">Create Delivery Route</h2>
              <div className="mb-4">
                <label htmlFor="popup-route-date" className="text-sm font-medium text-gray-700">Delivery Date</label>
                <Input
                  id="popup-route-date"
                  type="date"
                  value={routeDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setRouteDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="warehouse-select" className="text-sm font-medium text-gray-700">Select Warehouse</label>
                <select
                  id="warehouse-select"
                  value={routeWarehouseId}
                  onChange={(e) => setRouteWarehouseId(e.target.value)}
                  title="Select warehouse"
                  className="w-full mt-1 px-3 py-2 border rounded-md bg-white"
                >
                  <option value="">-- Choose Warehouse --</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.city})
                    </option>
                  ))}
                </select>
              </div>
              <Button className="w-full bg-black text-white hover:bg-black/90 mt-2 mb-4" onClick={() => createRoutePlan(false, routeDate, routeWarehouseId)} disabled={loadingRoutePlans}>
                {loadingRoutePlans ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Filter Orders
              </Button>
              
              {routePlanMessage && (
                <div className={`p-3 rounded-lg mb-4 text-sm ${routePlanMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {routePlanMessage.text}
                </div>
              )}
              
              {/* Orders Preview below the filter button */}
              <div className="bg-gray-50 rounded-lg p-4 overflow-y-auto flex-1">
                <h3 className="text-lg font-semibold mb-3">Orders by City</h3>
                {routePlans.length === 0 ? (
                  <div className="flex items-center justify-center text-sm text-gray-400 min-h-[80px]">
                    {loadingRoutePlans ? 'Loading orders...' : 'Pick a delivery date and warehouse to view orders by city'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {routePlans.map((cityGroup: any) => (
                      <div key={cityGroup.city}>
                        <button 
                          onClick={() => setSelectedRouteCity(cityGroup.city)}
                          className={`w-full text-left p-3 rounded-lg font-semibold mb-2 transition-colors ${
                            selectedRouteCity === cityGroup.city 
                              ? 'bg-blue-500 text-white' 
                              : 'bg-white border border-gray-200 text-gray-900 hover:border-blue-400'
                          }`}
                        >
                          {cityGroup.city} ({toArray<any>(cityGroup.orders).length} orders)
                        </button>
                        {selectedRouteCity === cityGroup.city && (
                          <div className="space-y-1 pl-2 mb-3">
                            {toArray<any>(cityGroup.orders).map((order: any) => (
                              <button
                                key={order.id}
                                onClick={() => handleRouteOrderClick(cityGroup.city, order.id)}
                                className={`w-full text-left text-sm p-2 rounded transition-colors ${
                                  selectedRouteOrderIds.includes(order.id)
                                    ? 'bg-blue-100 text-blue-900 font-medium'
                                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                                      selectedRouteOrderIds.includes(order.id)
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-gray-300 bg-white'
                                    }`}
                                  >
                                    {selectedRouteOrderIds.includes(order.id) ? '✓' : ''}
                                  </span>
                                  <span className="truncate">{order.orderNumber || order.id}</span>
                                </div>
                                <div className="text-xs text-gray-500 truncate">{order.customerName}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 space-y-2">
                <p className="text-xs text-gray-500">
                  Driver assignment is done in New Trip.
                </p>
                <Button
                  className="w-full bg-blue-600 text-white hover:bg-blue-700"
                  onClick={() => {
                    void saveRouteDraft()
                  }}
                  disabled={
                    loadingRoutePlans ||
                    !routeDate ||
                    !routeWarehouseId ||
                    !selectedRouteCity ||
                    selectedRouteOrderIds.length === 0
                  }
                >
                  Save Route
                </Button>
              </div>
            </div>
            {/* Right: Delivery Route Map or other content */}
            <div className="flex-1 flex flex-col bg-gray-50 p-10 overflow-y-auto min-w-0">
              {/* Delivery Route Map - styled like Warehouse Portal */}
              <Card>
                <CardHeader>
                  <CardTitle>Delivery Locations</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="w-full rounded-xl border bg-gray-50 p-6 flex flex-col items-center">
                    {/* Warehouse as starting point */}
                    {(() => {
                      const wh = warehouses.find((w) => w.id === routeWarehouseId);
                      if (!wh) return <div className="mb-4 text-gray-400">Select a warehouse to start</div>;
                      return (
                        <div className="w-full max-w-xl mb-4">
                          <div className="rounded-lg border-2 border-green-400 bg-green-50 p-4 flex flex-col items-start mb-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-green-500 text-white font-bold mr-2">
                                <svg width="18" height="18" fill="none"><path d="M9 2.25a6.75 6.75 0 1 1 0 13.5a6.75 6.75 0 0 1 0-13.5Zm0 2.25v2.25m0 2.25h.008v.008H9V6.75Z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </span>
                              <span className="font-semibold text-green-900">Warehouse - Starting Point</span>
                            </div>
                            <div className="text-sm font-medium text-gray-700">{wh.name}</div>
                            <div className="text-xs text-green-700">{[wh.address, wh.city, wh.province].filter(Boolean).join(', ')}</div>
                            {wh.latitude && wh.longitude && (
                              <div className="text-xs text-gray-500 mt-1">?? {wh.latitude}, {wh.longitude}</div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Delivery locations */}
                    <div className="w-full max-w-xl flex flex-col gap-3">
                      {(() => {
                        if (!routePlans || !selectedRouteCity) return null;
                        const group = routePlans.find((g) => g.city === selectedRouteCity);
                        if (!group) return null;
                        const selectedOrders = toArray(group.orders).filter((order: any) => selectedRouteOrderIds.includes(order.id));
                        return selectedOrders.map((order: any, idx: number) => (
                          <div key={order.id} className="rounded-lg border bg-white flex items-start gap-3 p-4">
                            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-500 text-white font-bold text-lg">{idx + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-gray-900">{order.customerName || order.orderNumber}</div>
                              <div className="text-xs text-gray-600">{order.address || order.city || ''}</div>
                              {order.products && (
                                <div className="text-xs text-gray-500 mt-1">{order.products}</div>
                              )}
                              {order.latitude && order.longitude && (
                                <div className="text-xs text-gray-500 mt-1">?? {order.latitude}, {order.longitude}</div>
                              )}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          </DialogContent>
        </Dialog>

      <Dialog open={createTripOpen} onOpenChange={setCreateTripOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Trip</DialogTitle>
            <DialogDescription>Select a saved route and assign an available driver.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Saved Route</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                title="Select Saved Route"
                value={selectedSavedRouteId}
                onChange={(e) => setSelectedSavedRouteId(e.target.value)}
              >
                <option value="">Select route</option>
                {savedRoutes.map((route: any) => (
                  <option key={route.id} value={route.id}>
                    {route.city} • {new Date(route.date).toLocaleDateString()} • {route.orderIds.length} orders
                  </option>
                ))}
              </select>
            </div>

            {selectedSavedRoute ? (
              <div className="rounded-md border bg-gray-50 p-3 text-sm">
                <p className="font-medium text-gray-900">{selectedSavedRoute.city}</p>
                <p className="text-gray-600">Warehouse: {selectedSavedRoute.warehouseName}</p>
                <p className="text-gray-600">Date: {new Date(selectedSavedRoute.date).toLocaleDateString()}</p>
                <p className="text-gray-600">Orders: {selectedSavedRoute.orderIds.length}</p>
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Assign Driver</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                title="Assign Driver"
                value={selectedRouteDriverId}
                onChange={(e) => setSelectedRouteDriverId(e.target.value)}
              >
                <option value="">Select driver</option>
                {drivers.map((driver: any) => (
                  <option key={driver.id} value={driver.id} disabled={driver?.isActive === false}>
                    {(driver.user?.name || driver.name || driver.email || driver.id) + (driver?.isActive === false ? ' (Inactive)' : '')}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Assigned Vehicle</label>
              <Input
                readOnly
                value={selectedDriverAssignedVehicle?.licensePlate || 'No assigned vehicle'}
              />
              {!selectedDriverAssignedVehicle?.id && selectedRouteDriverId ? (
                <p className="text-xs text-amber-600">Selected driver has no assigned vehicle.</p>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCreateTripOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-black text-white hover:bg-black/90"
                onClick={createTripFromRoute}
                disabled={creatingTripFromRoute || !selectedSavedRouteId || !selectedRouteDriverId || !selectedDriverAssignedVehicle?.id}
              >
                {creatingTripFromRoute ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Create Trip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* ...existing code... */}
      {/* End of TripsView */}
      </div>
    </>
  );
}
function VehiclesView() {
  const [vehicles, setVehicles] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [historyVehicle, setHistoryVehicle] = useState<any | null>(null)
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null)
  const [form, setForm] = useState({
    licensePlate: '',
    type: 'VAN',
    capacity: '',
    status: 'AVAILABLE',
    driverId: '',
  })

  const fetchVehicles = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/vehicles')
      if (response.ok) {
        const data = await response.json()
        setVehicles(getCollection<any>(data, ['vehicles']))
      }
    } catch (error) {
      console.error('Failed to fetch vehicles:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchDrivers = async () => {
    try {
      const response = await fetch('/api/drivers?active=true')
      if (response.ok) {
        const data = await response.json()
        const list = getCollection<any>(data, ['drivers'])
        if (list.length > 0) {
          setDrivers(list)
          return
        }
      }

      const fallbackResponse = await fetch('/api/drivers')
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json()
        setDrivers(getCollection<any>(fallbackData, ['drivers']))
      }
    } catch (error) {
      console.error('Failed to fetch drivers:', error)
    }
  }

  useEffect(() => {
    fetchVehicles()
    fetchDrivers()
  }, [])

  const statusColors: Record<string, string> = {
    AVAILABLE: 'bg-green-100 text-green-800',
    IN_USE: 'bg-blue-100 text-blue-800',
    MAINTENANCE: 'bg-yellow-100 text-yellow-800',
    OUT_OF_SERVICE: 'bg-red-100 text-red-800',
  }

  const resetForm = () => {
    setForm({
      licensePlate: '',
      type: 'VAN',
      capacity: '',
      status: 'AVAILABLE',
      driverId: '',
    })
    setEditingVehicle(null)
  }

  const openEdit = (vehicle: any) => {
    setEditingVehicle(vehicle)
    setForm({
      licensePlate: vehicle.licensePlate || '',
      type: vehicle.type || 'VAN',
      capacity: vehicle.capacity ? String(vehicle.capacity) : '',
      status: vehicle.status || 'AVAILABLE',
      driverId: vehicle.drivers?.[0]?.driver?.id || '',
    })
    setEditOpen(true)
  }

  const driverSelectOptions = (() => {
    const list = [...drivers]
    if (form.driverId && !list.some((driver) => driver.id === form.driverId)) {
      const assignedName = editingVehicle?.drivers?.[0]?.driver?.user?.name || `Assigned Driver (${form.driverId})`
      list.unshift({ id: form.driverId, user: { name: assignedName } })
    }
    return list
  })()

  const saveVehicle = async (mode: 'create' | 'edit') => {
    if (!form.licensePlate.trim()) {
      toast.error('License plate is required')
      return
    }
    if (!form.type) {
      toast.error('Vehicle type is required')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = '/api/vehicles'
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mode === 'edit' ? editingVehicle.id : undefined,
          licensePlate: form.licensePlate.trim().toUpperCase(),
          type: form.type,
          capacity: form.capacity ? Number(form.capacity) : null,
          status: form.status,
          driverId: form.driverId || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save vehicle')
      }
      toast.success(mode === 'create' ? 'Vehicle added' : 'Vehicle updated')
      setAddOpen(false)
      setEditOpen(false)
      resetForm()
      await fetchVehicles()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save vehicle')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicles</h1>
          <p className="text-gray-500">Manage your delivery fleet</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          Add Vehicle
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-500">No vehicles found</p>
            <Button className="mt-4">Add First Vehicle</Button>
          </div>
        ) : (
          vehicles.map((vehicle: any) => (
            <Card key={vehicle.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{vehicle.licensePlate}</h3>
                    <p className="text-sm text-gray-500">{vehicle.type || 'Vehicle'}</p>
                  </div>
                  <Badge className={statusColors[vehicle.status] || 'bg-gray-100'}>
                    {vehicle.status?.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Type:</span>
                    <span className="ml-1 font-medium">{vehicle.type}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Capacity:</span>
                    <span className="ml-1 font-medium">{vehicle.capacity || 'N/A'} kg</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Assigned Driver:</span>
                    <span className="ml-1 font-medium">{vehicle.drivers?.[0]?.driver?.user?.name || 'Unassigned'}</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(vehicle)}>Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => setHistoryVehicle(vehicle)}>History</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (open) fetchDrivers(); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Vehicle</DialogTitle>
            <DialogDescription>Create a new delivery vehicle.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium text-gray-700">License Plate</label>
              <Input value={form.licensePlate} onChange={(e) => setForm((f) => ({ ...f, licensePlate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Type</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="VAN">VAN</option>
                <option value="TRUCK">TRUCK</option>
                <option value="MOTORCYCLE">MOTORCYCLE</option>
                <option value="CAR">CAR</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="AVAILABLE">AVAILABLE</option>
                <option value="IN_USE">IN USE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="OUT_OF_SERVICE">OUT OF SERVICE</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity (kg)</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              {/* Assign Driver Label and Select removed */}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveVehicle('create')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Vehicle
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (open) fetchDrivers(); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Vehicle</DialogTitle>
            <DialogDescription>Update vehicle details and status.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium text-gray-700">License Plate</label>
              <Input value={form.licensePlate} onChange={(e) => setForm((f) => ({ ...f, licensePlate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Type</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="VAN">VAN</option>
                <option value="TRUCK">TRUCK</option>
                <option value="MOTORCYCLE">MOTORCYCLE</option>
                <option value="CAR">CAR</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="AVAILABLE">AVAILABLE</option>
                <option value="IN_USE">IN USE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="OUT_OF_SERVICE">OUT OF SERVICE</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity (kg)</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              {/* Assign Driver Label and Select removed */}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveVehicle('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyVehicle} onOpenChange={(open) => !open && setHistoryVehicle(null)}>
        <DialogContent>
          {historyVehicle && (
            <>
              <DialogHeader>
                <DialogTitle>Vehicle History - {historyVehicle.licensePlate}</DialogTitle>
                <DialogDescription>Vehicle lifecycle and maintenance fields.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-3">
                  <p><span className="text-gray-500">Status:</span> {historyVehicle.status?.replace(/_/g, ' ') || 'N/A'}</p>
                  <p><span className="text-gray-500">Mileage:</span> {historyVehicle.mileage ?? 0} km</p>
                  <p><span className="text-gray-500">Last Maintenance:</span> {historyVehicle.lastMaintenance ? new Date(historyVehicle.lastMaintenance).toLocaleDateString() : 'N/A'}</p>
                  <p><span className="text-gray-500">Next Maintenance:</span> {historyVehicle.nextMaintenance ? new Date(historyVehicle.nextMaintenance).toLocaleDateString() : 'N/A'}</p>
                  <p><span className="text-gray-500">Created:</span> {historyVehicle.createdAt ? new Date(historyVehicle.createdAt).toLocaleString() : 'N/A'}</p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setHistoryVehicle(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DriversView() {
  const [drivers, setDrivers] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [profileDriver, setProfileDriver] = useState<any | null>(null)
  const [assignDriver, setAssignDriver] = useState<any | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [assignVehicleId, setAssignVehicleId] = useState('')
  const [driverForm, setDriverForm] = useState({
    mode: 'existing',
    userId: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    roleId: '',
    licenseNumber: '',
    licenseType: 'B',
    licenseExpiry: '',
    city: '',
    province: '',
    address: '',
    zipCode: '',
  })

  const isDriverAssignable = (driver: any) => {
    const status = String(driver?.status || '').toUpperCase()
    return driver?.isActive !== false && status !== 'INACTIVE'
  }

  const isVehicleAssignable = (vehicle: any) => {
    const status = String(vehicle?.status || '').toUpperCase()
    return vehicle?.isActive !== false && !['INACTIVE', 'OUT_OF_SERVICE', 'MAINTENANCE'].includes(status)
  }

  const fetchDrivers = async () => {
    setIsLoading(true)
    try {
      const [driversResponse, vehiclesResponse, usersResponse, rolesResponse] = await Promise.all([
        fetch('/api/drivers'),
        fetch('/api/vehicles?status=AVAILABLE'),
        fetch('/api/users?pageSize=200'),
        fetch('/api/roles'),
      ])

      if (driversResponse.ok) {
        const driversData = await driversResponse.json()
        setDrivers(getCollection<any>(driversData, ['drivers']))
      }
      if (vehiclesResponse.ok) {
        const vehiclesData = await vehiclesResponse.json()
        setVehicles(getCollection<any>(vehiclesData, ['vehicles']))
      }
      if (usersResponse.ok) {
        const usersData = await usersResponse.json()
        setUsers(toArray<any>(usersData?.data ?? usersData?.users ?? usersData))
      }
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        const roleList = toArray<any>(rolesData?.data ?? rolesData?.roles ?? rolesData)
        setRoles(roleList)
        const defaultDriverRole = roleList.find((role) => String(role.name).toUpperCase() === 'DRIVER')
        if (defaultDriverRole?.id) {
          setDriverForm((prev) => ({ ...prev, roleId: prev.roleId || defaultDriverRole.id }))
        }
      }
    } catch (error) {
      console.error('Failed to fetch drivers:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchDrivers()
  }, [])

  const resetDriverForm = () => {
    const defaultDriverRole = roles.find((role) => String(role.name).toUpperCase() === 'DRIVER')
    setDriverForm({
      mode: 'existing',
      userId: '',
      name: '',
      email: '',
      phone: '',
      password: '',
      roleId: defaultDriverRole?.id || '',
      licenseNumber: '',
      licenseType: 'B',
      licenseExpiry: '',
      city: '',
      province: '',
      address: '',
      zipCode: '',
    })
  }

  const createDriver = async () => {
    if (!driverForm.licenseNumber.trim()) {
      toast.error('License number is required')
      return
    }

    setIsSubmitting(true)
    try {
      let userId = driverForm.userId

      if (driverForm.mode === 'new') {
        if (!driverForm.name.trim() || !driverForm.email.trim() || !driverForm.password) {
          throw new Error('Name, email, and password are required for new user')
        }
        if (!driverForm.roleId) {
          throw new Error('Role is required for new user')
        }
        const createUserResponse = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: driverForm.name.trim(),
            email: driverForm.email.trim(),
            password: driverForm.password,
            phone: driverForm.phone.trim() || null,
            roleId: driverForm.roleId,
          }),
        })
        const createUserPayload = await createUserResponse.json().catch(() => ({}))
        if (!createUserResponse.ok || createUserPayload?.success === false) {
          throw new Error(createUserPayload?.error || 'Failed to create user')
        }
        userId = createUserPayload?.data?.id
      }

      if (!userId) {
        throw new Error('Please select a user')
      }

      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          licenseNumber: driverForm.licenseNumber.trim(),
          licenseType: driverForm.licenseType || 'B',
          licenseExpiry: driverForm.licenseExpiry || null,
          phone: driverForm.phone.trim() || null,
          address: driverForm.address.trim() || null,
          city: driverForm.city.trim() || null,
          province: driverForm.province.trim() || null,
          zipCode: driverForm.zipCode.trim() || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to create driver')
      }

      toast.success('Driver added')
      setAddOpen(false)
      resetDriverForm()
      await fetchDrivers()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add driver')
    } finally {
      setIsSubmitting(false)
    }
  }

  const assignVehicleToDriver = async () => {
    if (!assignDriver?.id || !assignVehicleId) {
      toast.error('Select driver and vehicle')
      return
    }

    if (!isDriverAssignable(assignDriver)) {
      toast.error('Selected driver is inactive and cannot be assigned')
      return
    }

    const selectedVehicle = vehicles.find((vehicle) => vehicle.id === assignVehicleId)
    if (selectedVehicle && !isVehicleAssignable(selectedVehicle)) {
      toast.error('Selected vehicle is unavailable and cannot be assigned')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assignDriver.id, vehicleId: assignVehicleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to assign vehicle')
      }
      await fetchDrivers()
      toast.success('Vehicle assigned to driver')
      setAssignDriver(null)
      setAssignVehicleId('')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to assign vehicle')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drivers</h1>
          <p className="text-gray-500">Manage your delivery drivers</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          <UserCheck className="h-4 w-4" />
          Add Driver
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : drivers.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <UserCheck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No drivers found</p>
            <Button className="mt-4">Add First Driver</Button>
          </div>
        ) : (
          drivers.map((driver: any) => (
            <Card key={driver.id}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-blue-600 text-white">
                      {driver.user?.name?.charAt(0) || 'D'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-semibold">{driver.user?.name || 'Unknown'}</h3>
                    <p className="text-sm text-gray-500">{driver.user?.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline">License: {driver.licenseNumber}</Badge>
                      <Badge variant={driver.isActive ? 'default' : 'secondary'}>
                        {driver.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Rating:</span>
                    <span className="ml-1 font-medium">{Number(driver.rating || 0).toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Deliveries:</span>
                    <span className="ml-1 font-medium">{driver.totalDeliveries || 0}</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setProfileDriver(driver)}>View Profile</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title={!isDriverAssignable(driver) ? 'Inactive driver cannot be assigned' : 'Assign vehicle'}
                    disabled={!isDriverAssignable(driver)}
                    onClick={() => { setAssignDriver(driver); setAssignVehicleId('') }}
                  >
                    Assign
                  </Button>
                </div>
                {!isDriverAssignable(driver) ? (
                  <p className="mt-2 text-xs text-amber-600">Inactive driver cannot be assigned.</p>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetDriverForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Driver</DialogTitle>
            <DialogDescription>Create a driver profile from existing user or a new user account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={driverForm.mode === 'existing' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setDriverForm((f) => ({ ...f, mode: 'existing' }))}
              >
                Existing User
              </Button>
              <Button
                type="button"
                variant={driverForm.mode === 'new' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setDriverForm((f) => ({ ...f, mode: 'new' }))}
              >
                New User
              </Button>
            </div>

            {driverForm.mode === 'existing' ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Select User</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  title="Select Driver User"
                  value={driverForm.userId}
                  onChange={(e) => setDriverForm((f) => ({ ...f, userId: e.target.value }))}
                >
                  <option value="">Choose user</option>
                  {users
                    .filter((user) => !drivers.some((driver) => driver.userId === user.id))
                    .map((user) => (
                      <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                    ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Name</label>
                  <Input value={driverForm.name} onChange={(e) => setDriverForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Email</label>
                  <Input type="email" value={driverForm.email} onChange={(e) => setDriverForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Phone</label>
                  <Input value={driverForm.phone} onChange={(e) => setDriverForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Password</label>
                  <Input type="password" value={driverForm.password} onChange={(e) => setDriverForm((f) => ({ ...f, password: e.target.value }))} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Role</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    title="Driver Role"
                    value={driverForm.roleId}
                    onChange={(e) => setDriverForm((f) => ({ ...f, roleId: e.target.value }))}
                  >
                    <option value="">Select role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">License Number</label>
                <Input value={driverForm.licenseNumber} onChange={(e) => setDriverForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">License Type</label>
                <Input value={driverForm.licenseType} onChange={(e) => setDriverForm((f) => ({ ...f, licenseType: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">License Expiry</label>
                <Input type="date" value={driverForm.licenseExpiry} onChange={(e) => setDriverForm((f) => ({ ...f, licenseExpiry: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">City</label>
                <Input value={driverForm.city} onChange={(e) => setDriverForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Province</label>
                <Input value={driverForm.province} onChange={(e) => setDriverForm((f) => ({ ...f, province: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Zip Code</label>
                <Input value={driverForm.zipCode} onChange={(e) => setDriverForm((f) => ({ ...f, zipCode: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <Input value={driverForm.address} onChange={(e) => setDriverForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={createDriver} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Driver
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!profileDriver} onOpenChange={(open) => !open && setProfileDriver(null)}>
        <DialogContent>
          {profileDriver && (
            <>
              <DialogHeader>
                <DialogTitle>Driver Profile - {profileDriver.user?.name || 'N/A'}</DialogTitle>
                <DialogDescription>Driver account and performance details.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-3 space-y-1">
                  <p><span className="text-gray-500">Email:</span> {profileDriver.user?.email || 'N/A'}</p>
                  <p><span className="text-gray-500">Phone:</span> {profileDriver.phone || profileDriver.user?.phone || 'N/A'}</p>
                  <p><span className="text-gray-500">License:</span> {profileDriver.licenseNumber || 'N/A'} ({profileDriver.licenseType || 'N/A'})</p>
                  <p><span className="text-gray-500">License Expiry:</span> {profileDriver.licenseExpiry ? new Date(profileDriver.licenseExpiry).toLocaleDateString() : 'N/A'}</p>
                  <p><span className="text-gray-500">Rating:</span> {Number(profileDriver.rating || 0).toFixed(1)}</p>
                  <p><span className="text-gray-500">Total Deliveries:</span> {profileDriver.totalDeliveries || 0}</p>
                  <p><span className="text-gray-500">Address:</span> {[profileDriver.address, profileDriver.city, profileDriver.province, profileDriver.zipCode].filter(Boolean).join(', ') || 'N/A'}</p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setProfileDriver(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignDriver} onOpenChange={(open) => !open && setAssignDriver(null)}>
        <DialogContent>
          {assignDriver && (
            <>
              <DialogHeader>
                <DialogTitle>Assign Vehicle</DialogTitle>
                <DialogDescription>Assign an available vehicle to {assignDriver.user?.name || 'driver'}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Available Vehicles</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    title="Select Vehicle"
                    value={assignVehicleId}
                    onChange={(e) => setAssignVehicleId(e.target.value)}
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id} disabled={!isVehicleAssignable(vehicle)}>
                          {vehicle.licensePlate} - {vehicle.type}{!isVehicleAssignable(vehicle) ? ' (Unavailable)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setAssignDriver(null)}>Cancel</Button>
                  <Button className="flex-1" onClick={assignVehicleToDriver} disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Assign
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TransportationView() {
  const [activeTab, setActiveTab] = useState<'vehicles' | 'trips' | 'drivers'>('vehicles')
  const [vehicles, setVehicles] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [trips, setTrips] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [addDriverOpen, setAddDriverOpen] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null)
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null)
  const [deleteVehicleOpen, setDeleteVehicleOpen] = useState(false)
  const [vehicleToDelete, setVehicleToDelete] = useState<any | null>(null)
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({
    licensePlate: '',
    type: 'TRUCK',
    capacity: '',
    status: 'AVAILABLE',
    driverId: '',
    isActive: true,
  })
  const [driverForm, setDriverForm] = useState({
    name: '',
    email: '',
    phoneNumber: '',
    licenseNumber: '',
    licenseExpiry: '',
    vehicleId: '',
    status: 'Active',
    isActive: true,
  })

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [vehiclesRes, driversRes, tripsRes] = await Promise.all([
        fetch('/api/vehicles?page=1&pageSize=100'),
        fetch('/api/drivers?page=1&pageSize=100'),
        fetch('/api/trips?page=1&pageSize=100'),
      ])

      if (vehiclesRes.ok) {
        const data = await vehiclesRes.json()
        setVehicles(getCollection<any>(data, ['vehicles']))
      }
      if (driversRes.ok) {
        const data = await driversRes.json()
        setDrivers(getCollection<any>(data, ['drivers']))
      }
      if (tripsRes.ok) {
        const data = await tripsRes.json()
        setTrips(getCollection<any>(data, ['trips']))
      }
    } catch (error) {
      console.error('Failed to fetch transportation data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const activeTripsCount = trips.filter((trip) => ['IN_PROGRESS', 'PLANNED'].includes(normalizeTripStatus(trip?.status))).length
  const driversOnDutyCount = drivers.filter((driver) => String(driver?.status).toUpperCase() === 'ACTIVE' || String(driver?.status).toUpperCase() === 'ON_DUTY').length
  const maintenanceCount = vehicles.filter((vehicle) => String(vehicle?.status).toUpperCase().includes('MAINTENANCE')).length

  const isDriverAssignable = (driver: any) => {
    const status = String(driver?.status || '').toUpperCase()
    return driver?.isActive !== false && status !== 'INACTIVE'
  }

  const isVehicleAssignable = (vehicle: any) => {
    const status = String(vehicle?.status || '').toUpperCase()
    return vehicle?.isActive !== false && !['INACTIVE', 'OUT_OF_SERVICE', 'MAINTENANCE'].includes(status)
  }

  const saveVehicle = async (mode: 'create' | 'edit') => {
    if (!vehicleForm.licensePlate.trim()) {
      toast.error('License plate is required')
      return
    }

    if (vehicleForm.driverId) {
      const selectedDriverRecord = drivers.find((driver) => driver.id === vehicleForm.driverId)
      if (selectedDriverRecord && !isDriverAssignable(selectedDriverRecord)) {
        toast.error('Selected driver is inactive and cannot be assigned')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const endpoint = '/api/vehicles'
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mode === 'edit' ? selectedVehicle.id : undefined,
          licensePlate: vehicleForm.licensePlate.trim(),
          type: String(vehicleForm.type || '').toUpperCase(),
          capacity: parseInt(vehicleForm.capacity) || 0,
          status: String(vehicleForm.status || '').toUpperCase(),
          driverId: vehicleForm.driverId || null,
          isActive: vehicleForm.isActive,
        }),
      })

      if (response.ok) {
        await fetchData()
        resetVehicleForm()
        setAddVehicleOpen(false)
        toast.success(`Vehicle ${mode === 'create' ? 'created' : 'updated'} successfully`)
      } else {
        toast.error('Failed to save vehicle')
      }
    } catch (error: any) {
      toast.error(error?.message || 'An error occurred while saving')
    } finally {
      setIsSubmitting(false)
    }
  }

  const saveDriver = async () => {
    if (!selectedDriver?.id) {
      toast.error('No driver selected')
      return
    }

    const name = (driverForm.name || '').trim()
    const email = (driverForm.email || '').trim()
    const phoneNumber = (driverForm.phoneNumber || '').trim()

    if (!name || !email || !phoneNumber) {
      toast.error('Name, email, and phone number are required')
      return
    }

    if (driverForm.vehicleId) {
      const selectedVehicleRecord = vehicles.find((vehicle) => vehicle.id === driverForm.vehicleId)
      if (selectedVehicleRecord && !isVehicleAssignable(selectedVehicleRecord)) {
        toast.error('Selected vehicle is inactive and cannot be assigned')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const userId = selectedDriver?.user?.id
      if (userId) {
        const userResponse = await fetch(`/api/users/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone: phoneNumber,
            isActive: driverForm.isActive,
          }),
        })
        const userPayload = await userResponse.json().catch(() => ({}))
        if (!userResponse.ok || userPayload?.success === false) {
          throw new Error(userPayload?.error || 'Failed to update driver user profile')
        }
      }

      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedDriver.id,
          phone: phoneNumber,
          licenseExpiry: driverForm.licenseExpiry || null,
          vehicleId: driverForm.vehicleId || null,
          isActive: driverForm.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (response.ok && payload?.success !== false) {
        await fetchData()
        resetDriverForm()
        setAddDriverOpen(false)
        toast.success('Driver updated successfully')
      } else {
        toast.error(payload?.error || 'Failed to save driver')
      }
    } catch (error) {
      toast.error('An error occurred while saving')
    } finally {
      setIsSubmitting(false)
    }
  }

  const promptDeleteVehicle = (vehicle: any) => {
    setVehicleToDelete(vehicle)
    setDeleteVehicleOpen(true)
  }

  const deleteVehicle = async () => {
    if (!vehicleToDelete?.id) return
    setIsDeletingVehicle(true)
    try {
      const response = await fetch(`/api/vehicles/${vehicleToDelete.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to delete vehicle')
      }
      await fetchData()
      setDeleteVehicleOpen(false)
      setVehicleToDelete(null)
      emitDataSync(['vehicles', 'drivers', 'trips'])
      toast.success(payload?.message || 'Vehicle deleted successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete vehicle')
    } finally {
      setIsDeletingVehicle(false)
    }
  }

  const deleteDriver = async (id: string) => {
    if (!confirm('Are you sure you want to delete this driver?')) return
    try {
      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: false }),
      })
      if (response.ok) {
        await fetchData()
        toast.success('Driver deactivated successfully')
      }
    } catch (error) {
      toast.error('Failed to delete driver')
    }
  }

  const resetVehicleForm = () => {
    setVehicleForm({
      licensePlate: '',
      type: 'TRUCK',
      capacity: '',
      status: 'AVAILABLE',
      driverId: '',
      isActive: true,
    })
    setSelectedVehicle(null)
  }

  const resetDriverForm = () => {
    setDriverForm({
      name: '',
      email: '',
      phoneNumber: '',
      licenseNumber: '',
      licenseExpiry: '',
      vehicleId: '',
      status: 'Active',
      isActive: true,
    })
    setSelectedDriver(null)
  }

  const openTripDetails = (trip: any) => {
    setSelectedTrip(trip)
  }

  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Transportation Management</h1>
          <p className="text-gray-600">Fleet, trips, and driver management system</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { resetVehicleForm(); setAddVehicleOpen(true) }} className="bg-blue-600 hover:bg-blue-700">
            + Add Vehicle
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-blue-100 text-blue-600"><Truck className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Total Vehicles</p>
                <p className="text-2xl font-bold">{vehicles.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-green-100 text-green-600"><CheckCircle className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Active Trips</p>
                <p className="text-2xl font-bold">{activeTripsCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-purple-100 text-purple-600"><UserCheck className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Drivers On Duty</p>
                <p className="text-2xl font-bold">{driversOnDutyCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-orange-100 text-orange-600"><AlertTriangle className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Maintenance</p>
                <p className="text-2xl font-bold">{maintenanceCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)} className="w-full">
        <TabsList className="w-full justify-start gap-2 overflow-x-auto">
          <TabsTrigger value="vehicles">Fleet Management</TabsTrigger>
          <TabsTrigger value="trips">Active Trips</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="space-y-4 mt-4">
          <Dialog open={addVehicleOpen} onOpenChange={setAddVehicleOpen}>
            <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{selectedVehicle ? 'Edit Vehicle' : 'Add New Vehicle'}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <label className="text-sm font-medium text-gray-700">License Plate</label>
                  <Input placeholder="License Plate" value={vehicleForm.licensePlate} onChange={(e) => setVehicleForm({...vehicleForm, licensePlate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Vehicle Type</label>
                  <select value={vehicleForm.type} onChange={(e) => setVehicleForm({...vehicleForm, type: e.target.value})} title="Vehicle Type" className="w-full px-3 py-2 border rounded-md">
                    <option value="TRUCK">Truck</option>
                    <option value="VAN">Van</option>
                    <option value="CAR">Car</option>
                    <option value="MOTORCYCLE">Motorcycle</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Capacity (kg)</label>
                  <Input type="number" placeholder="Capacity (kg)" value={vehicleForm.capacity} onChange={(e) => setVehicleForm({...vehicleForm, capacity: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <select value={vehicleForm.status} onChange={(e) => setVehicleForm({...vehicleForm, status: e.target.value})} title="Status" className="w-full px-3 py-2 border rounded-md">
                    <option value="AVAILABLE">Available</option>
                    <option value="IN_USE">In Use</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="OUT_OF_SERVICE">Out of Service</option>
                  </select>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-sm font-medium text-gray-700">Assign Driver</label>
                  <select
                    value={vehicleForm.driverId}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driverId: e.target.value })}
                    title="Assign Driver"
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((driver: any) => (
                      <option key={driver.id} value={driver.id} disabled={!isDriverAssignable(driver)}>
                        {(driver.user?.name || driver.name || driver.email || driver.id) + (!isDriverAssignable(driver) ? ' (Inactive)' : '')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" title="Vehicle active" checked={vehicleForm.isActive} onChange={(e) => setVehicleForm({...vehicleForm, isActive: e.target.checked})} />
                  <label>Active</label>
                </div>
                <Button onClick={() => saveVehicle(selectedVehicle ? 'edit' : 'create')} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : null}
                  {selectedVehicle ? 'Update' : 'Add'} Vehicle
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <div className="grid gap-4">
            {vehicles.map((vehicle: any) => (
              <Card key={vehicle.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{vehicle.licensePlate || 'Vehicle'}</h3>
                      <p className="text-sm text-gray-500">Plate: {vehicle.licensePlate}</p>
                      <p className="text-sm text-gray-500">Capacity: {vehicle.capacity} kg</p>
                      <p className="text-sm text-gray-500">Driver: {vehicle?.drivers?.[0]?.driver?.user?.name || vehicle?.drivers?.[0]?.driver?.name || 'Not Assigned'}</p>
                      <Badge className={String(vehicle.status).toUpperCase().includes('MAINTENANCE') ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}>
                        {vehicle.status || 'Active'}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setSelectedVehicle(vehicle); setVehicleForm({ licensePlate: vehicle.licensePlate || '', type: String(vehicle.type || 'TRUCK').toUpperCase(), capacity: String(vehicle.capacity || ''), status: String(vehicle.status || 'AVAILABLE').toUpperCase(), driverId: vehicle?.drivers?.[0]?.driver?.id || '', isActive: vehicle.isActive !== false }); setAddVehicleOpen(true) }}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => promptDeleteVehicle(vehicle)}>Delete</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <AlertDialog open={deleteVehicleOpen} onOpenChange={setDeleteVehicleOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-red-600">Delete Vehicle Permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete{' '}
                  <span className="font-semibold text-foreground">
                    {vehicleToDelete?.licensePlate || 'this vehicle'}
                  </span>
                  . This cannot be undone. If this vehicle is already used in trips, deletion will be blocked.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingVehicle}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={deleteVehicle}
                  disabled={isDeletingVehicle}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {isDeletingVehicle ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Delete Vehicle
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="trips" className="space-y-4 mt-4">
          {trips.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-gray-500">No active trips found.</CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {trips.slice(0, 10).map((trip: any) => {
                const status = normalizeTripStatus(trip?.status || 'PLANNED')
                const driverName = trip?.driver?.name || trip?.driver?.user?.name || 'Unassigned'
                const vehicleName = trip?.vehicle?.licensePlate || 'Unassigned'
                const origin = trip?.origin || trip?.warehouse?.city || 'Warehouse'
                const destination = trip?.destination || trip?.destinationCity || 'Destination'
                return (
                  <Card key={trip.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-base font-semibold">{trip.tripNumber || trip.id}</p>
                            <Badge className={`${status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'} text-xs px-2 py-0.5`}>{status.replace(/_/g, ' ')}</Badge>
                          </div>
                          <p className="text-[13px] text-gray-600">Vehicle: {vehicleName} • Driver: {driverName}</p>
                          <p className="text-[13px] text-gray-600">Route: {origin} {'->'} {destination}</p>
                        </div>
                        <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => openTripDetails(trip)}>View Details</Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drivers" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 text-sm text-gray-600">
              New drivers are created from Users (Add User). Use this section to review, edit, and remove existing drivers.
            </CardContent>
          </Card>

          <Dialog open={addDriverOpen} onOpenChange={setAddDriverOpen}>
            <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Driver</DialogTitle>
              </DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Name</label>
                      <Input placeholder="Name" value={driverForm.name} onChange={(e) => setDriverForm({...driverForm, name: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Email</label>
                      <Input type="email" placeholder="Email" value={driverForm.email} onChange={(e) => setDriverForm({...driverForm, email: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Phone Number</label>
                      <Input placeholder="Phone Number" value={driverForm.phoneNumber} onChange={(e) => setDriverForm({...driverForm, phoneNumber: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">License Number</label>
                      <Input placeholder="License Number" value={driverForm.licenseNumber} onChange={(e) => setDriverForm({...driverForm, licenseNumber: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">License Expiry</label>
                      <Input type="date" placeholder="License Expiry" value={driverForm.licenseExpiry} onChange={(e) => setDriverForm({...driverForm, licenseExpiry: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Status</label>
                      <select value={driverForm.status} onChange={(e) => setDriverForm({...driverForm, status: e.target.value})} title="Status" className="w-full px-3 py-2 border rounded-md">
                        <option>Active</option>
                        <option>OnLeave</option>
                        <option>Inactive</option>
                      </select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-sm font-medium text-gray-700">Assign Vehicle</label>
                      <select
                        value={driverForm.vehicleId}
                        onChange={(e) => setDriverForm({ ...driverForm, vehicleId: e.target.value })}
                        title="Assign Vehicle"
                        className="w-full px-3 py-2 border rounded-md"
                      >
                        <option value="">Unassigned</option>
                        {vehicles.map((vehicle: any) => (
                          <option key={vehicle.id} value={vehicle.id} disabled={!isVehicleAssignable(vehicle)}>
                            {vehicle.licensePlate} - {vehicle.type || 'VEHICLE'}{!isVehicleAssignable(vehicle) ? ' (Unavailable)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" title="Driver active" checked={driverForm.isActive} onChange={(e) => setDriverForm({...driverForm, isActive: e.target.checked})} />
                      <label>Active</label>
                    </div>
                  </div>
                  <div>
                <Button onClick={saveDriver} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : null}
                  Update Driver
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <div className="grid gap-4">
            {drivers.map((driver: any) => (
              <Card key={driver.id}>
                <CardContent className="pt-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold">{driver.user?.name || driver.name || 'N/A'}</h3>
                      <p className="text-sm text-gray-500">{driver.user?.email || driver.email || 'N/A'}</p>
                      <p className="text-sm text-gray-500">{driver.phone || driver.user?.phone || driver.phoneNumber || 'N/A'}</p>
                      <p className="text-sm text-gray-500">License: {driver.licenseNumber}</p>
                      <p className={`text-sm font-medium ${driver.isActive ? 'text-green-600' : 'text-orange-600'}`}>
                        {driver.isActive ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setSelectedDriver(driver); setDriverForm({ name: driver.user?.name || driver.name || '', email: driver.user?.email || driver.email || '', phoneNumber: driver.phone || driver.user?.phone || driver.phoneNumber || '', licenseNumber: driver.licenseNumber || '', licenseExpiry: driver.licenseExpiry || '', vehicleId: driver?.vehicles?.[0]?.vehicle?.id || '', status: driver.isActive ? 'Active' : 'Inactive', isActive: driver.isActive !== false }); setAddDriverOpen(true) }}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteDriver(driver.id)}>Delete</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
        <DialogContent className="max-w-3xl w-full">
          {selectedTrip && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg font-bold text-gray-900">{selectedTrip.tripNumber || selectedTrip.id}</span>
                <Badge className={['IN_PROGRESS'].includes(normalizeTripStatus(selectedTrip?.status || '')) ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}>
                  {normalizeTripStatus(selectedTrip.status || 'PLANNED').replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-6 mb-2 text-sm">
                <div>
                  <span className="font-semibold">Vehicle:</span> {selectedTrip?.vehicle?.licensePlate || 'Unassigned'}
                </div>
                <div>
                  <span className="font-semibold">Driver:</span> {selectedTrip?.driver?.name || selectedTrip?.driver?.user?.name || 'Unassigned'}
                </div>
              </div>
              <div className="flex flex-wrap gap-6 mb-2 text-sm">
                <div>
                  <span className="font-semibold">Progress:</span> {selectedTrip?.completedDropPoints ?? 0}/{selectedTrip?.totalDropPoints ?? 0}
                </div>
                <div>
                  <span className="font-semibold">Drop points:</span> {selectedTrip?.dropPoints?.length ?? 0}
                </div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3">
                <p className="text-sm font-semibold text-gray-900 mb-2">Drop Point Details</p>
                {Array.isArray(selectedTrip.dropPoints) && selectedTrip.dropPoints.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {selectedTrip.dropPoints.map((point: any, index: number) => {
                      const statusLabel = String(point.status || 'PENDING').replace(/_/g, ' ')
                      const statusClass =
                        ['COMPLETED', 'DELIVERED'].includes(String(point.status || ''))
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : ['FAILED', 'FAILED_DELIVERY', 'CANCELLED', 'SKIPPED'].includes(String(point.status || ''))
                            ? 'bg-red-100 text-red-700 border-red-200'
                            : ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ARRIVED'].includes(String(point.status || ''))
                              ? 'bg-blue-100 text-blue-700 border-blue-200'
                              : 'bg-gray-100 text-gray-700 border-gray-200'

                      const hasCoordinates =
                        typeof point.latitude === 'number' && typeof point.longitude === 'number'

                      return (
                        <div key={point.id || `${selectedTrip.id}-dp-${index}`} className="rounded-md border bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900">
                              Drop Point {index + 1}: {point.locationName || 'Unnamed drop point'}
                            </p>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-600">
                            {hasCoordinates
                              ? `Coordinates: ${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`
                              : 'Coordinates: Not available'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No drop-point records attached to this trip yet.</p>
                )}
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setSelectedTrip(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WarehousesView() {
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [warehouseStaffUsers, setWarehouseStaffUsers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAutofillingLocation, setIsAutofillingLocation] = useState(false)
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false)
  const [mapPickerLatitude, setMapPickerLatitude] = useState<number | null>(null)
  const [mapPickerLongitude, setMapPickerLongitude] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState<any | null>(null)
  const [warehouseInventoryItems, setWarehouseInventoryItems] = useState<any[]>([])
  const [insightStockBatches, setInsightStockBatches] = useState<any[]>([])
  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    city: '',
    province: '',
    zipCode: '',
    country: 'USA',
    latitude: '',
    longitude: '',
    capacity: '',
    managerId: '',
    isActive: true,
  })

  const fetchWarehouses = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/warehouses?page=1&pageSize=100')
      if (response.ok) {
        const data = await response.json()
        setWarehouses(getCollection<any>(data, ['warehouses']))
      }
    } catch (error) {
      console.error('Failed to fetch warehouses:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWarehouses()
    fetchWarehouseStaffUsers()
  }, [])

  const fetchWarehouseStaffUsers = async () => {
    try {
      const [usersResponse, rolesResponse] = await Promise.all([
        fetch('/api/users?page=1&pageSize=500'),
        fetch('/api/roles'),
      ])

      if (!usersResponse.ok || !rolesResponse.ok) {
        throw new Error('Failed to fetch warehouse staff users')
      }

      const usersPayload = await usersResponse.json()
      const rolesPayload = await rolesResponse.json()
      const users = toArray<any>(usersPayload?.data ?? usersPayload?.users ?? usersPayload)
      const roles = toArray<any>(rolesPayload?.data ?? rolesPayload?.roles ?? rolesPayload)

      const warehouseRoles = roles.filter((role) => String(role?.name || '').toUpperCase().includes('WAREHOUSE'))
      const warehouseRoleIds = new Set(warehouseRoles.map((role) => String(role?.id || '')).filter(Boolean))
      const scopedUsers = users.filter((entry) => {
        if (entry?.isActive === false) return false

        const userRoleId = String(entry?.roleId || entry?.role?.id || '')
        const userRoleName = String(entry?.role?.name || '').toUpperCase()

        if (warehouseRoleIds.size > 0) {
          if (userRoleId && warehouseRoleIds.has(userRoleId)) return true
          return userRoleName.includes('WAREHOUSE')
        }

        return userRoleName.includes('WAREHOUSE')
      })

      setWarehouseStaffUsers(scopedUsers)
    } catch (error) {
      console.error('Failed to fetch warehouse staff users:', error)
      toast.error('Failed to load warehouse staff users')
    }
  }

  const resetForm = () => {
    setForm({
      name: '',
      code: '',
      address: '',
      city: '',
      province: '',
      zipCode: '',
      country: 'USA',
      latitude: '',
      longitude: '',
      capacity: '',
      managerId: '',
      isActive: true,
    })
    setSelectedWarehouse(null)
  }

  const applyLocationAutofill = (payload: {
    latitude?: number
    longitude?: number
    city?: string
    province?: string
    zipCode?: string
    country?: string
    address?: string
  }) => {
    setForm((prev) => ({
      ...prev,
      latitude:
        typeof payload.latitude === 'number' && Number.isFinite(payload.latitude)
          ? payload.latitude.toFixed(6)
          : prev.latitude,
      longitude:
        typeof payload.longitude === 'number' && Number.isFinite(payload.longitude)
          ? payload.longitude.toFixed(6)
          : prev.longitude,
      city: payload.city || prev.city,
      province: payload.province || prev.province,
      zipCode: payload.zipCode || prev.zipCode,
      country: payload.country || prev.country,
      address: payload.address || prev.address,
    }))
  }

  const autofillFromNominatimResult = (result: any, fallbackAddress?: string) => {
    const address = result?.address || {}
    const city = String(address.city || address.town || address.village || address.municipality || '').trim()
    const province = String(address.state || address.region || address.county || '').trim()
    const zipCode = String(address.postcode || '').trim()
    const country = String(address.country || '').trim()
    const latitude = Number(result?.lat)
    const longitude = Number(result?.lon)
    const fullAddress = String(result?.display_name || '').trim()

    applyLocationAutofill({
      latitude,
      longitude,
      city,
      province,
      zipCode,
      country,
      address: fallbackAddress || fullAddress,
    })
  }

  const openMapPicker = () => {
    const latitudeValue = form.latitude.trim() ? Number(form.latitude) : null
    const longitudeValue = form.longitude.trim() ? Number(form.longitude) : null
    setMapPickerLatitude(typeof latitudeValue === 'number' && Number.isFinite(latitudeValue) ? latitudeValue : null)
    setMapPickerLongitude(typeof longitudeValue === 'number' && Number.isFinite(longitudeValue) ? longitudeValue : null)
    setIsMapPickerOpen(true)
  }

  const pickCurrentLocationInMap = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported on this browser')
      return
    }

    setIsAutofillingLocation(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        })
      })

      setMapPickerLatitude(position.coords.latitude)
      setMapPickerLongitude(position.coords.longitude)
      toast.success('Current location selected on map')
    } catch {
      toast.error('Unable to access current location')
    } finally {
      setIsAutofillingLocation(false)
    }
  }

  const applyPinnedLocationFromMap = async () => {
    if (typeof mapPickerLatitude !== 'number' || typeof mapPickerLongitude !== 'number') {
      toast.error('Pin a location on the map first')
      return
    }

    setIsAutofillingLocation(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(mapPickerLatitude))}&lon=${encodeURIComponent(String(mapPickerLongitude))}&addressdetails=1`
      )
      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error('Failed to reverse-geocode selected location')
      }

      autofillFromNominatimResult(result)
      setIsMapPickerOpen(false)
      toast.success('Pinned location saved and address auto-filled')
    } catch {
      applyLocationAutofill({ latitude: mapPickerLatitude, longitude: mapPickerLongitude })
      setIsMapPickerOpen(false)
      toast.success('Pinned location saved')
    } finally {
      setIsAutofillingLocation(false)
    }
  }

  const saveWarehouse = async (mode: 'create' | 'edit') => {
    if (!form.name.trim() || !form.code.trim() || !form.address.trim() || !form.city.trim() || !form.province.trim() || !form.zipCode.trim()) {
      toast.error('Name, code, address, city, province and zip code are required')
      return
    }

    const latitudeValue = form.latitude.trim() ? Number(form.latitude) : null
    const longitudeValue = form.longitude.trim() ? Number(form.longitude) : null
    if (form.latitude.trim() && !Number.isFinite(latitudeValue)) {
      toast.error('Latitude is invalid')
      return
    }
    if (form.longitude.trim() && !Number.isFinite(longitudeValue)) {
      toast.error('Longitude is invalid')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = mode === 'create' ? '/api/warehouses' : `/api/warehouses/${selectedWarehouse.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          address: form.address.trim(),
          city: form.city.trim(),
          province: form.province.trim(),
          zipCode: form.zipCode.trim(),
          country: form.country.trim() || 'USA',
          latitude: latitudeValue,
          longitude: longitudeValue,
          capacity: form.capacity ? Number(form.capacity) : 1000,
          managerId: form.managerId || null,
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save warehouse')
      }
      toast.success(mode === 'create' ? 'Warehouse added' : 'Warehouse updated')
      setAddOpen(false)
      setManageOpen(false)
      resetForm()
      await fetchWarehouses()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save warehouse')
    } finally {
      setIsSubmitting(false)
    }
  }

  const openManage = (warehouse: any) => {
    setSelectedWarehouse(warehouse)
    setForm({
      name: warehouse.name || '',
      code: warehouse.code || '',
      address: warehouse.address || '',
      city: warehouse.city || '',
      province: warehouse.province || '',
      zipCode: warehouse.zipCode || '',
      country: warehouse.country || 'USA',
      latitude: typeof warehouse.latitude === 'number' ? String(warehouse.latitude) : '',
      longitude: typeof warehouse.longitude === 'number' ? String(warehouse.longitude) : '',
      capacity: warehouse.capacity ? String(warehouse.capacity) : '',
      managerId: warehouse.managerId || '',
      isActive: !!warehouse.isActive,
    })
    setManageOpen(true)
  }

  const getAssignedStaffName = (managerId?: string | null) => {
    if (!managerId) return 'Unassigned'
    const staff = warehouseStaffUsers.find((entry) => entry.id === managerId)
    return staff?.name || 'Assigned'
  }

  const openInsights = async (warehouse: any) => {
    try {
      const [warehouseResponse, stockBatchesResponse] = await Promise.all([
        fetch(`/api/warehouses/${warehouse.id}`),
        fetch('/api/stock-batches?page=1&pageSize=500'),
      ])

      const warehousePayload = await warehouseResponse.json().catch(() => ({}))
      if (!warehouseResponse.ok || warehousePayload?.success === false) {
        throw new Error(warehousePayload?.error || 'Failed to load warehouse insights')
      }

      const warehouseData = warehousePayload?.data || warehouse
      const stockPayload = await stockBatchesResponse.json().catch(() => ({}))
      const allStockBatches = stockBatchesResponse.ok ? getCollection<any>(stockPayload, ['stockBatches']) : []
      const filteredBatches = allStockBatches.filter((batch: any) => {
        const batchWarehouseName = String(batch?.inventory?.warehouse?.name || '').toLowerCase()
        const batchWarehouseCode = String(batch?.inventory?.warehouse?.code || '').toLowerCase()
        const name = String(warehouseData?.name || warehouse?.name || '').toLowerCase()
        const code = String(warehouseData?.code || warehouse?.code || '').toLowerCase()
        return batchWarehouseName === name || batchWarehouseCode === code
      })

      setSelectedWarehouse(warehouseData)
      setWarehouseInventoryItems(toArray<any>(warehouseData?.inventory ?? []))
      setInsightStockBatches(filteredBatches)
      setInsightsOpen(true)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load warehouse insights')
    }
  }

  const totalCapacity = Number(selectedWarehouse?.capacity || 0)
  const estimatedUsage = warehouseInventoryItems.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
  const usagePercent = totalCapacity > 0 ? Math.min(100, Math.round((estimatedUsage / totalCapacity) * 100)) : 0
  const freeCapacity = Math.max(0, totalCapacity - estimatedUsage)
  const stockKeepingUnits = warehouseInventoryItems.length
  const lowStockItems = warehouseInventoryItems.filter((item) => Number(item?.quantity || 0) <= Number(item?.minStock || 0)).length
  const warehouseActivities = [
    {
      id: 'capacity',
      label: 'Capacity update',
      detail: `${estimatedUsage.toLocaleString()} units stored out of ${totalCapacity.toLocaleString()}`,
    },
    {
      id: 'stock-health',
      label: 'Stock health',
      detail: lowStockItems > 0 ? `${lowStockItems} SKU(s) below threshold` : 'All inventory is above threshold',
    },
    {
      id: 'staffing',
      label: 'Assigned staff',
      detail: getAssignedStaffName(selectedWarehouse?.managerId),
    },
  ]
  const utilizationStatus = usagePercent >= 90 ? 'Critical' : usagePercent >= 75 ? 'High' : usagePercent >= 55 ? 'Moderate' : 'Healthy'
  const usageTrend = Array.from({ length: 7 }).map((_, index) => {
    const pointDate = new Date()
    pointDate.setHours(0, 0, 0, 0)
    pointDate.setDate(pointDate.getDate() - (6 - index))

    const endOfDay = new Date(pointDate)
    endOfDay.setHours(23, 59, 59, 999)

    const additionsAfterDay = insightStockBatches
      .filter((entry: any) => {
        const receiptDate = new Date(entry?.receiptDate || entry?.createdAt || 0)
        return !Number.isNaN(receiptDate.getTime()) && receiptDate.getTime() > endOfDay.getTime()
      })
      .reduce((sum: number, entry: any) => sum + Math.max(0, Number(entry?.quantity || 0)), 0)

    const estimatedUsedAtDay = Math.max(0, estimatedUsage - additionsAfterDay)
    const dayUtilization = totalCapacity > 0
      ? Math.min(100, Number(((estimatedUsedAtDay / totalCapacity) * 100).toFixed(1)))
      : 0

    return {
      day: pointDate.toLocaleDateString('en-US', { weekday: 'short' }),
      utilization: dayUtilization,
    }
  })
  const capacityBreakdown = [
    { name: 'Used', value: Math.max(0, estimatedUsage), color: '#3b82f6' },
    { name: 'Free', value: Math.max(0, freeCapacity), color: '#34d399' },
  ]
  const recentActivities = [
    {
      id: 'a1',
      title: 'Capacity snapshot updated',
      detail: `${estimatedUsage.toLocaleString()} of ${totalCapacity.toLocaleString()} units occupied`,
      time: '2 mins ago',
    },
    {
      id: 'a2',
      title: lowStockItems > 0 ? 'Low stock alert detected' : 'Stock levels stable',
      detail: lowStockItems > 0
        ? `${lowStockItems} SKU(s) are at or below threshold`
        : 'No SKU is currently below minimum stock',
      time: '14 mins ago',
    },
    {
      id: 'a3',
      title: 'Inventory coverage',
      detail: `${stockKeepingUnits} SKU(s) tracked in this warehouse`,
      time: '33 mins ago',
    },
    {
      id: 'a4',
      title: 'Warehouse staffing',
      detail: `Assigned staff: ${getAssignedStaffName(selectedWarehouse?.managerId)}`,
      time: '1 hr ago',
    },
  ]
  const skuVelocityData = warehouseInventoryItems
    .map((item: any, index: number) => {
      const qty = Number(item?.quantity || 0)
      const reserved = Number(item?.reservedQuantity || 0)
      const minStock = Number(item?.minStock || 0)
      const available = Math.max(0, qty - reserved)
      const pressure = Math.max(0, minStock - available)
      const velocity = reserved + pressure
      return {
        id: item?.id || `${item?.product?.sku || 'sku'}-${index}`,
        name: item?.product?.name || item?.product?.sku || 'Item',
        sku: item?.product?.sku || 'N/A',
        velocity,
      }
    })
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 10)

  const stockHealthCounts = warehouseInventoryItems.reduce(
    (acc: { healthy: number; low: number; critical: number; overstocked: number }, item: any) => {
      const qty = Number(item?.quantity || 0)
      const reserved = Number(item?.reservedQuantity || 0)
      const minStock = Math.max(0, Number(item?.minStock || 0))
      const maxStock = Math.max(0, Number(item?.maxStock || 0))
      const available = Math.max(0, qty - reserved)

      if (available <= minStock) acc.critical += 1
      else if (available <= Math.ceil(minStock * 1.2)) acc.low += 1
      else if (maxStock > 0 && available >= Math.floor(maxStock * 0.9)) acc.overstocked += 1
      else acc.healthy += 1

      return acc
    },
    { healthy: 0, low: 0, critical: 0, overstocked: 0 }
  )

  const stockHealthDistribution = [
    { name: 'Healthy', value: stockHealthCounts.healthy, color: '#10b981' },
    { name: 'Low', value: stockHealthCounts.low, color: '#f59e0b' },
    { name: 'Critical', value: stockHealthCounts.critical, color: '#ef4444' },
    { name: 'Overstocked', value: stockHealthCounts.overstocked, color: '#3b82f6' },
  ]

  const getStockHealthDotClass = (name: string) => {
    const key = name.toLowerCase()
    if (key === 'healthy') return 'bg-emerald-500'
    if (key === 'low') return 'bg-amber-500'
    if (key === 'critical') return 'bg-red-500'
    if (key === 'overstocked') return 'bg-blue-500'
    return 'bg-gray-400'
  }
  const totalWarehouses = warehouses.length
  const totalWarehouseCapacity = warehouses.reduce((sum, warehouse: any) => sum + Number(warehouse?.capacity || 0), 0)
  const avgEfficiency = totalWarehouses > 0
    ? Math.round((warehouses.filter((warehouse: any) => warehouse?.isActive !== false).length / totalWarehouses) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Warehouses</h1>
          <p className="text-gray-500">Manage storage facilities and locations</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          {/* Warehouse icon removed */}
          Add Warehouse
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-blue-50 p-1.5">
                <Building2 className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Warehouses</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{totalWarehouses}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-emerald-50 p-1.5">
                <Database className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Capacity</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{totalWarehouseCapacity.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-violet-50 p-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Avg Efficiency</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{avgEfficiency}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center h-64">
            {/* Loader2 icon removed */}
          </div>
        ) : warehouses.length === 0 ? (
          <div className="col-span-full text-center py-12">
            {/* Warehouse icon removed */}
            <p className="text-gray-500">No warehouses found</p>
            <Button className="mt-4">Add First Warehouse</Button>
          </div>
        ) : (
          warehouses.map((warehouse: any) => (
            <Card key={warehouse.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{warehouse.name}</h3>
                    <p className="text-sm text-gray-500">{warehouse.code}</p>
                  </div>
                  <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
                    {warehouse.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="mt-4 text-sm">
                  <p className="text-gray-600">{warehouse.address}</p>
                  <p className="text-gray-500">{warehouse.city}, {warehouse.province} {warehouse.zipCode}</p>
                  <p className="text-gray-500">Assigned Staff: {getAssignedStaffName(warehouse.managerId)}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openManage(warehouse)}>Manage</Button>
                  <Button variant="outline" size="sm" onClick={() => openInsights(warehouse)}>Insights</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Warehouse</DialogTitle>
            <DialogDescription>Create a new storage facility.</DialogDescription>
          </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Code</label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
                <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      openMapPicker()
                    }}
                    disabled={isAutofillingLocation || isSubmitting}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    Pin Location
                  </Button>
                </div>
              </div>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">City</label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Province</label>
              <Input value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Zip Code</label>
              <Input value={form.zipCode} onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Latitude</label>
              <Input value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} placeholder="e.g. 10.315699" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Longitude</label>
              <Input value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} placeholder="e.g. 123.885437" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Assign Warehouse Staff</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
                title="Assign Warehouse Staff"
              >
                <option value="">Unassigned</option>
                {warehouseStaffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveWarehouse('create')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Warehouse
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={(open) => !open && setManageOpen(false)}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Warehouse</DialogTitle>
            <DialogDescription>Update warehouse details and status.</DialogDescription>
          </DialogHeader>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Code</label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
                    <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      openMapPicker()
                    }}
                    disabled={isAutofillingLocation || isSubmitting}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    Pin Location
                  </Button>
                </div>
              </div>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">City</label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Province</label>
              <Input value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Zip Code</label>
              <Input value={form.zipCode} onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Latitude</label>
              <Input value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} placeholder="e.g. 10.315699" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Longitude</label>
              <Input value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} placeholder="e.g. 123.885437" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Assign Warehouse Staff</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
                title="Assign Warehouse Staff"
              >
                <option value="">Unassigned</option>
                {warehouseStaffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Warehouse Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Warehouse Status" value={form.isActive ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'ACTIVE' }))}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setManageOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveWarehouse('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
        <DialogContent className="max-w-3xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>Pin Warehouse Location</DialogTitle>
            <DialogDescription>Click on the map to pin manually, or use your current location.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-600">
                {typeof mapPickerLatitude === 'number' && typeof mapPickerLongitude === 'number'
                  ? `Selected: ${mapPickerLatitude.toFixed(6)}, ${mapPickerLongitude.toFixed(6)}`
                  : 'No location selected yet'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void pickCurrentLocationInMap()
                }}
                disabled={isAutofillingLocation}
              >
                {isAutofillingLocation ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MapPin className="mr-1 h-3.5 w-3.5" />}
                Use My Location
              </Button>
            </div>
            <AddressMapPicker
              latitude={mapPickerLatitude}
              longitude={mapPickerLongitude}
              onChange={(latitude, longitude) => {
                setMapPickerLatitude(latitude)
                setMapPickerLongitude(longitude)
              }}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setIsMapPickerOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  void applyPinnedLocationFromMap()
                }}
                disabled={isAutofillingLocation || typeof mapPickerLatitude !== 'number' || typeof mapPickerLongitude !== 'number'}
              >
                {isAutofillingLocation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Apply Pin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className="w-[99vw] max-w-[1700px] sm:max-w-[1700px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedWarehouse?.name || 'Warehouse'} Insights</DialogTitle>
            <DialogDescription>Capacity utilization, warehouse health, and recent happenings.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Capacity Utilization</CardTitle>
                  <Badge className={usagePercent >= 90 ? 'bg-red-100 text-red-800 hover:bg-red-100' : usagePercent >= 70 ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-green-100 text-green-800 hover:bg-green-100'}>
                    {utilizationStatus}
                  </Badge>
                </div>
                <CardDescription>
                  {estimatedUsage.toLocaleString()} / {totalCapacity.toLocaleString()} units used
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-4 shadow-sm">
                    <p className="mb-2 text-sm font-medium text-gray-600">Used vs Free Capacity</p>
                    <ChartContainer
                      config={{ used: { label: 'Used', color: '#3b82f6' }, free: { label: 'Free', color: '#34d399' } }}
                      className="h-[260px] w-full"
                    >
                      <PieChart>
                        <Pie
                          data={capacityBreakdown}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={68}
                          outerRadius={100}
                          paddingAngle={2}
                          strokeWidth={3}
                        >
                          {capacityBreakdown.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                          <Label
                            content={({ viewBox }) => {
                              if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null
                              const cx = typeof viewBox.cx === 'number' ? viewBox.cx : 0
                              const cy = typeof viewBox.cy === 'number' ? viewBox.cy : 0
                              return (
                                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={cx} y={cy - 4} className="fill-slate-900 text-2xl font-bold">
                                    {usagePercent}%
                                  </tspan>
                                  <tspan x={cx} y={cy + 16} className="fill-slate-500 text-xs">
                                    Used
                                  </tspan>
                                </text>
                              )
                            }}
                          />
                        </Pie>
                        <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                      </PieChart>
                    </ChartContainer>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm items-start content-start auto-rows-min self-start">
                    <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                      <p className="text-gray-500">Used</p>
                      <p className="text-lg font-semibold text-blue-700">{usagePercent}%</p>
                    </div>
                    <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                      <p className="text-gray-500">Free Capacity</p>
                      <p className="text-lg font-semibold text-green-700">{freeCapacity.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                      <p className="text-gray-500">Max Capacity</p>
                      <p className="text-lg font-semibold">{totalCapacity.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Capacity Trend (Last 7 Days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{ utilization: { label: 'Utilization', color: '#2563eb' } }}
                    className="h-[300px] w-full"
                  >
                    <LineChart data={usageTrend} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} width={34} domain={[0, 100]} />
                      <Tooltip formatter={(value) => [`${value}%`, 'Utilization']} />
                      <Line type="monotone" dataKey="utilization" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Recent Activities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {recentActivities.map((activity) => (
                      <div key={activity.id} className="rounded-lg border bg-gradient-to-br from-white to-gray-50 px-3 py-3 shadow-sm">
                        <p className="text-sm font-medium text-gray-900">{activity.title}</p>
                        <p className="text-sm text-gray-600">{activity.detail}</p>
                        <p className="mt-1 text-xs text-gray-500">{activity.time}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">SKU Velocity Chart</CardTitle>
                  <CardDescription>Top 10 fastest-moving items for replenishment planning.</CardDescription>
                </CardHeader>
                <CardContent>
                  {skuVelocityData.length === 0 ? (
                    <p className="text-sm text-gray-500">No SKU velocity data available.</p>
                  ) : (
                    <ChartContainer
                      config={{ velocity: { label: 'Velocity', color: '#2563eb' } }}
                      className="h-[320px] w-full"
                    >
                      <BarChart data={skuVelocityData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="sku" axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={65} />
                        <YAxis axisLine={false} tickLine={false} width={34} />
                        <Tooltip
                          formatter={(value) => [value, 'Velocity Score']}
                          labelFormatter={(label) => {
                            const item = skuVelocityData.find((row) => row.sku === label)
                            return `${label} - ${item?.name || ''}`
                          }}
                        />
                        <Bar dataKey="velocity" radius={[6, 6, 0, 0]} fill="#2563eb" />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Stock Health Distribution</CardTitle>
                  <CardDescription>Healthy, low, critical, and overstocked SKU split.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      healthy: { label: 'Healthy', color: '#10b981' },
                      low: { label: 'Low', color: '#f59e0b' },
                      critical: { label: 'Critical', color: '#ef4444' },
                      overstocked: { label: 'Overstocked', color: '#3b82f6' },
                    }}
                    className="h-[260px] w-full"
                  >
                    <PieChart>
                      <Pie
                        data={stockHealthDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={92}
                        paddingAngle={2}
                      >
                        {stockHealthDistribution.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                    </PieChart>
                  </ChartContainer>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {stockHealthDistribution.map((entry) => (
                      <div key={entry.name} className="rounded-md border bg-gray-50 px-2 py-1.5 text-xs">
                        <span className={`inline-block h-2 w-2 rounded-full mr-2 ${getStockHealthDotClass(entry.name)}`} />
                        <span className="text-gray-600">{entry.name}</span>
                        <span className="float-right font-semibold text-gray-900">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Warehouse Happenings</CardTitle>
                <CardDescription>Quick operational signals inside this warehouse.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {warehouseActivities.map((activity) => (
                    <div key={activity.id} className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      <p className="text-sm font-medium text-gray-900">{activity.label}</p>
                      <p className="text-sm text-gray-600">{activity.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Button variant="outline" onClick={() => setInsightsOpen(false)}>Close</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InventoryView() {
  const [inventory, setInventory] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingItem, setEditingItem] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnit, setEditUnit] = useState('piece')
  const [editPrice, setEditPrice] = useState('')
  const [editThreshold, setEditThreshold] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEdit, setIsDeletingEdit] = useState(false)
  const [deleteEditOpen, setDeleteEditOpen] = useState(false)
  const [addStockOpen, setAddStockOpen] = useState(false)
  const [isSubmittingStockIn, setIsSubmittingStockIn] = useState(false)
  const [isNewProduct, setIsNewProduct] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [stockInWarehouseId, setStockInWarehouseId] = useState('')
  const [stockInQty, setStockInQty] = useState('')
  const [stockInExpiryDate, setStockInExpiryDate] = useState('')
  const [stockInThreshold, setStockInThreshold] = useState('')
  const [newProductName, setNewProductName] = useState('')
  const [newProductDescription, setNewProductDescription] = useState('')
  const [newProductPrice, setNewProductPrice] = useState('')
  const [newProductUnit, setNewProductUnit] = useState('piece')
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null)

  const fetchInventory = async () => {
    setIsLoading(true)
    try {
      const result = await safeFetchJson('/api/inventory', { cache: 'no-store' }, { retries: 1 })
      if (!result.ok) {
        setInventory([])
        if (result.status !== 401 && result.status !== 403) {
          toast.error('Failed to load inventory')
        }
        return
      }
      setInventory(getCollection<any>(result.data, ['inventory']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load inventory')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchWarehouses = async () => {
    try {
      const result = await safeFetchJson('/api/warehouses?page=1&pageSize=200', { cache: 'no-store' }, { retries: 1 })
      if (!result.ok) {
        setWarehouses([])
        if (result.status !== 401 && result.status !== 403) {
          toast.error('Failed to load warehouses')
        }
        return
      }
      const list = getCollection<any>(result.data, ['warehouses'])
      setWarehouses(list)
      if (list[0]?.id && !stockInWarehouseId) setStockInWarehouseId(list[0].id)
    } catch (error) {
      console.error(error)
      toast.error('Failed to load warehouses')
    }
  }

  const fetchProducts = async () => {
    try {
      const result = await safeFetchJson('/api/products?page=1&pageSize=500', { cache: 'no-store' }, { retries: 1 })
      if (!result.ok) {
        setProducts([])
        if (result.status !== 401 && result.status !== 403) {
          toast.error('Failed to load products')
        }
        return
      }
      setProducts(getCollection<any>(result.data, ['products']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load products')
    }
  }

  useEffect(() => {
    const refreshSharedData = () => {
      void Promise.all([fetchInventory(), fetchWarehouses(), fetchProducts()])
    }

    refreshSharedData()

    const unsubscribe = subscribeDataSync((message) => {
      const shouldRefresh = message.scopes.some((scope) =>
        ['inventory', 'products', 'stock-batches', 'warehouses'].includes(scope)
      )
      if (shouldRefresh) {
        refreshSharedData()
      }
    })

    const onFocus = () => refreshSharedData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshSharedData()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(refreshSharedData, 30000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [])

  const getAvailableQty = (item: any) => Math.max(0, (item.quantity ?? 0) - (item.reservedQuantity ?? 0))
  const getStockStatus = (item: any) => ((item.quantity ?? 0) <= (item.minStock ?? 0) ? 'restock' : 'healthy')

  const uploadProductImage = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/product-image', { method: 'POST', body: formData })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload image')
    }
    return String(payload.imageUrl)
  }

  const openEditDialog = (item: any) => {
    setEditingItem(item)
    setEditName(item.product?.name || '')
    setEditSku(item.product?.sku || '')
    setEditUnit(item.product?.unit || 'piece')
    setEditPrice(String(item.product?.price ?? 0))
    setEditThreshold(String(item.minStock ?? 0))
    setEditQuantity(String(item.quantity ?? 0))
    setEditImageFile(null)
  }

  const saveInventoryEdit = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }
    const nextPrice = Number(editPrice)
    const nextThreshold = Number(editThreshold)
    const nextQuantity = Number(editQuantity)
    if (!Number.isFinite(nextPrice) || nextPrice < 0) return toast.error('Invalid price')
    if (!Number.isFinite(nextThreshold) || nextThreshold < 0) return toast.error('Invalid threshold')
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) return toast.error('Invalid quantity')
    if (!editName.trim() || !editSku.trim() || !editUnit.trim()) return toast.error('Name, SKU, and unit are required')

    setIsSavingEdit(true)
    try {
      const uploadedImageUrl = editImageFile ? await uploadProductImage(editImageFile) : editingItem.product?.imageUrl || null
      const productResponse = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          sku: editSku.trim(),
          unit: editUnit.trim(),
          imageUrl: uploadedImageUrl,
          price: nextPrice,
        }),
      })
      const productPayload = await productResponse.json().catch(() => ({}))
      if (!productResponse.ok || productPayload?.success === false) throw new Error(productPayload?.error || 'Failed to update product')

      const inventoryResponse = await fetch(`/api/inventory/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: nextQuantity, minStock: nextThreshold }),
      })
      const inventoryPayload = await inventoryResponse.json().catch(() => ({}))
      if (!inventoryResponse.ok || inventoryPayload?.success === false) throw new Error(inventoryPayload?.error || 'Failed to update inventory')

      toast.success('Inventory item updated')
      setEditingItem(null)
      await Promise.all([fetchInventory(), fetchProducts()])
      emitDataSync(['inventory', 'products'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save changes')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const deleteInventoryProduct = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }

    setIsDeletingEdit(true)
    try {
      const response = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to delete product')
      }

      toast.success('Product deleted')
      setEditingItem(null)
      setDeleteEditOpen(false)
      await Promise.all([fetchInventory(), fetchProducts()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete product')
    } finally {
      setIsDeletingEdit(false)
    }
  }

  const resetStockInForm = () => {
    setIsNewProduct(false)
    setSelectedProductId('')
    setStockInQty('')
    setStockInExpiryDate('')
    setStockInThreshold('')
    setNewProductName('')
    setNewProductDescription('')
    setNewProductPrice('')
    setNewProductUnit('piece')
    setNewProductImageFile(null)
  }

  const addStockInBatch = async () => {
    const qty = Number(stockInQty)
    if (!stockInWarehouseId) return toast.error('Please select a warehouse')
    if (!Number.isFinite(qty) || qty <= 0) return toast.error('Quantity should be greater than 0')
    if (isNewProduct && !newProductName.trim()) return toast.error('New product name is required')
    if (!isNewProduct && !selectedProductId) return toast.error('Please select an existing product')

    setIsSubmittingStockIn(true)
    try {
      const uploadedImageUrl = isNewProduct && newProductImageFile ? await uploadProductImage(newProductImageFile) : null
      const response = await fetch('/api/stock-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: stockInWarehouseId,
          quantity: qty,
          expiryDate: stockInExpiryDate || null,
          threshold: isNewProduct && stockInThreshold ? Number(stockInThreshold) : undefined,
          isNewProduct,
          productId: isNewProduct ? undefined : selectedProductId,
          productName: isNewProduct ? newProductName.trim() : undefined,
          description: isNewProduct ? newProductDescription.trim() || null : undefined,
          unit: isNewProduct ? newProductUnit : undefined,
          price: isNewProduct ? Number(newProductPrice || 0) : undefined,
          imageUrl: isNewProduct ? uploadedImageUrl : undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to add stock')

      toast.success('Stock added successfully')
      setAddStockOpen(false)
      resetStockInForm()
      await Promise.all([fetchInventory(), fetchProducts()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add stock')
    } finally {
      setIsSubmittingStockIn(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Inventory</CardTitle>
              <CardDescription>Warehouse staff can edit product details and add stock by batch.</CardDescription>
            </div>
            <Button onClick={() => setAddStockOpen(true)}>
              Add Stock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : inventory.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                    <th className="text-left p-4 font-medium text-gray-600">Product</th>
                    <th className="text-left p-4 font-medium text-gray-600">Unit</th>
                    <th className="text-left p-4 font-medium text-gray-600">Price</th>
                    <th className="text-left p-4 font-medium text-gray-600">Threshold</th>
                    <th className="text-left p-4 font-medium text-gray-600">Available</th>
                    <th className="text-left p-4 font-medium text-gray-600">Location</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => {
                    const status = getStockStatus(item)
                    const availableQty = getAvailableQty(item)
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium text-gray-900">{item.product?.sku ?? 'N/A'}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={item.product?.imageUrl || '/logo.svg'}
                              alt={item.product?.name || 'Product'}
                              className="h-10 w-10 rounded-md object-cover border bg-white"
                              onError={(event) => {
                                const target = event.currentTarget
                                if (target.src.endsWith('/logo.svg')) return
                                target.src = '/logo.svg'
                              }}
                            />
                            <div>
                              <p className="font-semibold text-gray-900">{item.product?.name ?? 'N/A'}</p>
                              <p className="text-xs text-gray-500">{item.product?.category?.name || 'General'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 font-medium text-gray-900">{item.product?.unit || 'piece'}</td>
                        <td className="p-4 font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                        <td className="p-4 font-semibold text-gray-900">{item.minStock ?? 0}</td>
                        <td className="p-4 font-semibold text-gray-900">{availableQty}</td>
                        <td className="p-4 text-gray-600">{item.warehouse?.name || item.warehouse?.code || 'N/A'}</td>
                        <td className="p-4">
                          {status === 'healthy' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>}
                          {status === 'restock' && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Restocking</Badge>}
                        </td>
                        <td className="p-4">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => openEditDialog(item)}
                            title="Edit item"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-4xl w-full">
          {editingItem && (
            <>
              <DialogHeader>
                <DialogTitle>Edit Inventory Item</DialogTitle>
                <DialogDescription>Update product details and stock threshold.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Product Name</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">SKU</label>
                  <Input value={editSku} onChange={(e) => setEditSku(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Photo</label>
                  <Input type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Unit</label>
                  <Input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Price</label>
                  <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Threshold</label>
                  <Input type="number" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">In Stock Quantity</label>
                  <Input type="number" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="destructive"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => setDeleteEditOpen(true)}
                    disabled={isSavingEdit || isDeletingEdit}
                  >
                    {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Delete Product
                  </Button>
                  <Button className="flex-1 bg-black text-white hover:bg-black/90" onClick={saveInventoryEdit} disabled={isSavingEdit || isDeletingEdit}>
                    {isSavingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteEditOpen} onOpenChange={setDeleteEditOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">Delete Product Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete{' '}
              <span className="font-semibold text-foreground">{editingItem?.product?.name || 'this product'}</span>{' '}
              from the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingEdit}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteInventoryProduct}
              disabled={isDeletingEdit}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addStockOpen} onOpenChange={(open) => { setAddStockOpen(open); if (!open) resetStockInForm() }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Add Stock</DialogTitle>
            <DialogDescription>Add stock by batch. Existing product requires expiry date only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Select Warehouse" value={stockInWarehouseId} onChange={(e) => setStockInWarehouseId(e.target.value)}>
                <option value="">Select warehouse</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant={!isNewProduct ? 'default' : 'outline'} className="flex-1" onClick={() => setIsNewProduct(false)}>
                Existing Product
              </Button>
              <Button type="button" variant={isNewProduct ? 'default' : 'outline'} className="flex-1" onClick={() => setIsNewProduct(true)}>
                New Product
              </Button>
            </div>

            {!isNewProduct ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Product</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Select Product" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.sku} - {product.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Product Image</label>
                  <Input type="file" accept="image/*" onChange={(e) => setNewProductImageFile(e.target.files?.[0] || null)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Product Name</label>
                  <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Description</label>
                  <Input
                    value={newProductDescription}
                    onChange={(e) => setNewProductDescription(e.target.value)}
                    placeholder="Product description"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Price</label>
                    <Input type="number" step="0.01" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Unit</label>
                    <Input value={newProductUnit} onChange={(e) => setNewProductUnit(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Threshold</label>
                    <Input type="number" value={stockInThreshold} onChange={(e) => setStockInThreshold(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Quantity</label>
                <Input type="number" value={stockInQty} onChange={(e) => setStockInQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Expiry Date</label>
                <Input type="date" value={stockInExpiryDate} onChange={(e) => setStockInExpiryDate(e.target.value)} />
              </div>
            </div>

            <Button className="w-full" onClick={addStockInBatch} disabled={isSubmittingStockIn}>
              {isSubmittingStockIn ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Add Stock Batch
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StocksView() {
  const [stockBatches, setStockBatches] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchStockBatches() {
      try {
        const response = await fetch('/api/stock-batches?page=1&pageSize=200')
        if (!response.ok) throw new Error('Failed stock batch fetch')
        const data = await response.json()
        setStockBatches(getCollection<any>(data, ['stockBatches']))
      } catch (error) {
        console.error(error)
        toast.error('Failed to load stock-in batches')
      } finally {
        setIsLoading(false)
      }
    }
    fetchStockBatches()
  }, [])

  const getDaysLeft = (expiryDate: string | null) => {
    if (!expiryDate) return null
    const end = new Date(expiryDate).getTime()
    const start = new Date().getTime()
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stocks</CardTitle>
        <CardDescription>Batch-based stock-in records with receipt date, expiry date, and days left.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="h-40 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : stockBatches.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-gray-500">No stock-in batches found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium text-gray-600">Batch #</th>
                  <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                  <th className="text-left p-4 font-medium text-gray-600">Product</th>
                  <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                  <th className="text-left p-4 font-medium text-gray-600">Receipt Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Expiry Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Days Left</th>
                  <th className="text-left p-4 font-medium text-gray-600">Status</th>
                  <th className="text-left p-4 font-medium text-gray-600">Location</th>
                </tr>
              </thead>
              <tbody>
                {stockBatches.map((batch) => {
                  const daysLeft = getDaysLeft(batch.expiryDate)
                  const expiringSoon = typeof daysLeft === 'number' && daysLeft >= 0 && daysLeft <= 14
                  const expired = typeof daysLeft === 'number' && daysLeft < 0
                  return (
                    <tr key={batch.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{batch.batchNumber}</td>
                      <td className="p-4">{batch.inventory?.product?.sku || 'N/A'}</td>
                      <td className="p-4">{batch.inventory?.product?.name || 'N/A'}</td>
                      <td className="p-4 font-semibold">{batch.quantity}</td>
                      <td className="p-4">{new Date(batch.receiptDate).toLocaleDateString()}</td>
                      <td className="p-4">{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : 'N/A'}</td>
                      <td className={`p-4 font-semibold ${expired ? 'text-red-600' : expiringSoon ? 'text-orange-600' : 'text-green-600'}`}>
                        {typeof daysLeft === 'number' ? `${Math.max(daysLeft, 0)} days` : 'N/A'}
                      </td>
                      <td className="p-4">
                        {expired && <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Expired</Badge>}
                        {!expired && expiringSoon && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Expiring Soon</Badge>}
                        {!expired && !expiringSoon && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>}
                      </td>
                      <td className="p-4 text-gray-600">
                        {batch.inventory?.warehouse?.code || batch.inventory?.warehouse?.name || batch.locationLabel || 'N/A'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ReturnsView() {
  const [returns, setReturns] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [updatingReplacementId, setUpdatingReplacementId] = useState<string | null>(null)

  const fetchReturns = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/orders?includeReturns=true&includeOrders=false&includeItems=none&limit=100')
      if (response.ok) {
        const data = await response.json()
        setReturns(getCollection(data, ['returns']))
      }
    } catch (error) {
      console.error('Failed to fetch replacements:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchReturns()
  }, [])

  const parseMeta = (notes: string | null | undefined) => {
    const raw = String(notes || '').trim()
    if (!raw) return {}
    const marker = 'Meta:'
    const markerIndex = raw.lastIndexOf(marker)
    if (markerIndex < 0) return {}
    const jsonText = raw.slice(markerIndex + marker.length).trim()
    if (!jsonText) return {}
    try {
      const parsed = JSON.parse(jsonText)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const formatIssueStatus = (item: any) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    if (rawStatus === 'RESOLVED_ON_DELIVERY') return 'Resolved on Delivery'
    if (rawStatus === 'NEEDS_FOLLOW_UP') return 'Needs Follow-up'
    if (rawStatus === 'COMPLETED') return 'Completed'
    if (rawStatus === 'IN_PROGRESS') return 'In Progress'
    return 'Reported'
  }

  const updateIssueStatus = async (
    replacementId: string,
    status: 'COMPLETED' | 'NEEDS_FOLLOW_UP',
    options?: { notes?: string; createReplacementOrder?: boolean }
  ) => {
    setUpdatingReplacementId(replacementId)
    try {
      const response = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'replacement',
          returnId: replacementId,
          status,
          notes: options?.notes,
          createReplacementOrder: options?.createReplacementOrder,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update replacement')
      }

      setReturns((prev) => prev.map((item) => (item.id === replacementId ? { ...item, status } : item)))
      toast.success(status === 'COMPLETED' ? 'Replacement marked as completed' : 'Replacement marked for follow-up')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update replacement')
    } finally {
      setUpdatingReplacementId(null)
    }
  }

  const totalIssues = returns.length
  const totalReplacedQty = returns.reduce((sum, item) => {
    const meta = parseMeta(item?.notes)
    const qty = Number(item?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0)
  }, 0)
  const resolvedOnDelivery = returns.filter((item) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').toUpperCase()
    const normalizedStatus =
      rawStatus === 'REQUESTED'
        ? 'REPORTED'
        : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
          ? 'IN_PROGRESS'
          : rawStatus === 'REJECTED'
            ? 'NEEDS_FOLLOW_UP'
            : rawStatus === 'PROCESSED'
              ? 'COMPLETED'
              : rawStatus
    const mode = String(item?.replacementMode || meta?.replacementMode || '').toUpperCase()
    return normalizedStatus === 'RESOLVED_ON_DELIVERY' || (normalizedStatus === 'COMPLETED' && mode === 'SPARE_STOCK_IMMEDIATE')
  }).length
  const needsFollowUp = returns.filter((item) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    return rawStatus === 'NEEDS_FOLLOW_UP' || rawStatus === 'REJECTED'
  }).length
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
          <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Total Cases</p>
              <p className="mt-1 text-2xl font-bold leading-none">{totalIssues}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Resolved on Delivery</p>
              <p className="mt-1 text-2xl font-bold leading-none">{resolvedOnDelivery}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Needs Follow-up</p>
              <p className="mt-1 text-2xl font-bold leading-none">{needsFollowUp}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-violet-50 p-2.5 text-violet-600">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Total Replaced Qty</p>
              <p className="mt-1 text-2xl font-bold leading-none">{totalReplacedQty}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : returns.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No replacement cases found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement Details</th>
                    <th className="text-left p-4 font-medium text-gray-600">Evidence</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Reported</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((item: any) => {
                    const meta = parseMeta(item?.notes)
                    const issueReason = String(item?.description || item?.reason || 'No details provided')
                    const replacementQty = Number(item?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
                    const hasEvidence = Boolean(String(item?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim())
                    const replacementMode = String(item?.replacementMode || meta?.replacementMode || '').toUpperCase()
                    const statusLabel = formatIssueStatus(item)

                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium">{item.returnNumber}</td>
                        <td className="p-4">{item.order?.orderNumber || 'N/A'}</td>
                        <td className="p-4">{item.order?.customer?.name || 'N/A'}</td>
                        <td className="p-4">
                          <p className="text-sm text-gray-900">{issueReason}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            {replacementQty > 0 ? <span>Qty replaced: {replacementQty}</span> : null}
                            {replacementMode === 'SPARE_STOCK_IMMEDIATE' ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">On-delivery replacement</Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge variant={hasEvidence ? 'default' : 'secondary'}>
                            {hasEvidence ? 'Photo Attached' : 'No Photo'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            className={
                              statusLabel === 'Needs Follow-up'
                                ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                            }
                          >
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="p-4 text-gray-500">
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            {String(item?.status || '').toUpperCase() !== 'COMPLETED' && String(item?.status || '').toUpperCase() !== 'RESOLVED_ON_DELIVERY' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateIssueStatus(item.id, 'COMPLETED', { notes: 'Marked completed by admin' })}
                                disabled={updatingReplacementId === item.id}
                              >
                                Mark Completed
                              </Button>
                            ) : null}
                            {String(item?.status || '').toUpperCase() !== 'NEEDS_FOLLOW_UP' ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => updateIssueStatus(item.id, 'NEEDS_FOLLOW_UP', { notes: 'Marked for follow-up by admin' })}
                                disabled={updatingReplacementId === item.id}
                              >
                                Needs Follow-up
                              </Button>
                            ) : null}
                            {updatingReplacementId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TrackingView() {
  const [trips, setTrips] = useState<any[]>([])
  const [ordersForMap, setOrdersForMap] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [trackingDate, setTrackingDate] = useState(formatDayKey(new Date()))

  const isDropPointCompleted = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['COMPLETED', 'DELIVERED', 'FULFILLED'].includes(value)
  }

  const isCompletedOrderStatus = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(value)
  }

  const isDateMatch = (value: unknown, dayKey: string) => {
    if (!value || !dayKey) return false
    const raw = String(value).trim()
    if (!raw) return false
    if (/^\d{4}-\d{2}-\d{2}/.test(raw) && raw.slice(0, 10) === dayKey) return true
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return false
    return formatDayKey(parsed) === dayKey
  }

  const orderMatchesTrackingDay = (order: any) => {
    if (!trackingDate) return true
    if (order?.deliveryDate) return isDateMatch(order.deliveryDate, trackingDate)
    return isDateMatch(order?.createdAt, trackingDate)
  }

  const tripMatchesTrackingDay = (trip: any) => {
    if (!trackingDate) return true
    return [trip?.plannedStartAt, trip?.actualStartAt, trip?.actualEndAt, trip?.createdAt].some((value) =>
      isDateMatch(value, trackingDate)
    )
  }

  const fetchTrackingTrips = async () => {
    setIsLoading(true)
    try {
      const query = new URLSearchParams({
        limit: '200',
        includeTracking: '1',
      })
      if (trackingDate) query.set('trackingDate', trackingDate)
      const [tripsResponse, ordersResponse] = await Promise.all([
        fetch(`/api/trips?${query.toString()}`),
        fetch('/api/orders?limit=300&includeItems=none'),
      ])

      if (tripsResponse.ok) {
        const data = await tripsResponse.json()
        setTrips(getCollection(data, ['trips']))
      } else {
        setTrips([])
      }

      if (ordersResponse.ok) {
        const ordersPayload = await ordersResponse.json()
        setOrdersForMap(getCollection(ordersPayload, ['orders']))
      } else {
        setOrdersForMap([])
      }
    } catch (error) {
      console.error('Failed to fetch live tracking data:', error)
      setTrips([])
      setOrdersForMap([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTrackingTrips()
  }, [trackingDate])

  const activeTrips = useMemo(
    () => trips.filter((trip: any) => ['IN_PROGRESS', 'PLANNED'].includes(normalizeTripStatus(trip?.status))),
    [trips]
  )

  const recentLocations = activeTrips
    .flatMap((trip: any) => toArray<any>(trip.locationLogs || []))
    .filter((log) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
    .map((log) => ({
      ...log,
      latitude: Number(log.latitude),
      longitude: Number(log.longitude),
    }))
    .sort((a, b) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime())
    .slice(0, 5)

  const mapData = useMemo(() => {
    const locations: Array<{
      id: string
      driverName: string
      vehiclePlate: string
      lat: number
      lng: number
      status: string
      markerColor?: string
      markerLabel?: string
      markerType?: 'pin' | 'dot' | 'truck' | 'default'
      markerDirection?: 'left' | 'right'
      markerHeading?: number
      markerNumber?: number | string
    }> = []
    const routeLines: Array<{
      id: string
      points: [number, number][]
      color: string
      label?: string
      opacity?: number
      weight?: number
      dashArray?: string
      snapToRoad?: boolean
    }> = []

    const tripsForMap = trips.filter(
      (trip: any) =>
        ['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(normalizeTripStatus(trip?.status)) &&
        tripMatchesTrackingDay(trip)
    )
    const dayOrders = ordersForMap.filter((order: any) => orderMatchesTrackingDay(order))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()

    tripsForMap.forEach((trip: any) => {
      const tripMatchesDay = tripMatchesTrackingDay(trip)
      const toCoordinate = (value: unknown) => {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      }
      const dropPoints = toArray<any>(trip.dropPoints)
        .filter((point) => {
          if (!trackingDate) return true
          if (tripMatchesDay) return true
          const orderId = String(point?.orderId || '').trim()
          if (!orderId) return false
          return dayOrderIds.has(orderId)
        })
        .filter((point) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
        .sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0))
      
      const nextPendingIndex = dropPoints.findIndex((point: any) => {
        const status = String(point?.status || point?.orderStatus || '').toUpperCase()
        return !['COMPLETED', 'DELIVERED'].includes(status)
      })
      const nextDropPoint = nextPendingIndex !== -1 ? dropPoints[nextPendingIndex] : null
      const warehouseStartLat =
        toCoordinate(trip?.warehouseLatitude) ??
        toCoordinate(trip?.warehouse?.latitude) ??
        toCoordinate(trip?.startLatitude)
      const warehouseStartLng =
        toCoordinate(trip?.warehouseLongitude) ??
        toCoordinate(trip?.warehouse?.longitude) ??
        toCoordinate(trip?.startLongitude)
      const warehouseStart =
        warehouseStartLat !== null && warehouseStartLng !== null
          ? ([warehouseStartLat, warehouseStartLng] as [number, number])
          : null

      const logs = toArray<any>(trip.locationLogs)
        .filter((log) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
        .map((log) => ({
          ...log,
          latitude: Number(log.latitude),
          longitude: Number(log.longitude),
        }))
        .sort((a, b) => new Date(a.recordedAt || 0).getTime() - new Date(b.recordedAt || 0).getTime())

      const latestLog = logs[logs.length - 1]
      const latestLocation = trip.latestLocation
      const driverLat = Number(latestLog?.latitude ?? latestLocation?.latitude)
      const driverLng = Number(latestLog?.longitude ?? latestLocation?.longitude)
      const hasDriverPosition = Number.isFinite(driverLat) && Number.isFinite(driverLng)
      const driverName = String(trip?.driver?.user?.name || trip?.driver?.name || 'Driver')
      const vehiclePlate = String(trip?.vehicle?.licensePlate || 'N/A')
      const markerHeading =
        nextDropPoint &&
        Number.isFinite(Number(nextDropPoint?.latitude)) &&
        Number.isFinite(Number(nextDropPoint?.longitude)) &&
        hasDriverPosition
          ? (() => {
              const fromLat = driverLat
              const fromLng = driverLng
              const toLat = Number(nextDropPoint.latitude)
              const toLng = Number(nextDropPoint.longitude)
              const toRad = (value: number) => (value * Math.PI) / 180
              const toDeg = (value: number) => (value * 180) / Math.PI
              const phi1 = toRad(fromLat)
              const phi2 = toRad(toLat)
              const deltaLng = toRad(toLng - fromLng)
              const y = Math.sin(deltaLng) * Math.cos(phi2)
              const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng)
              return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360
            })()
          : null

      if (hasDriverPosition) {
        locations.push({
          id: `driver-${trip.id}`,
          driverName,
          vehiclePlate,
          lat: driverLat,
          lng: driverLng,
          status: String(trip?.status || 'IN_PROGRESS'),
          markerColor: '#1d4ed8',
          markerLabel: 'Current location',
          markerType: 'truck',
          markerHeading: markerHeading ?? undefined,
        })
      } else if (['PLANNED', 'IN_PROGRESS'].includes(normalizeTripStatus(trip?.status))) {
        const fallbackDriverPoint =
          warehouseStart ||
          (nextDropPoint &&
          Number.isFinite(Number(nextDropPoint?.latitude)) &&
          Number.isFinite(Number(nextDropPoint?.longitude))
            ? ([Number(nextDropPoint.latitude), Number(nextDropPoint.longitude)] as [number, number])
            : null)
        if (fallbackDriverPoint) {
          locations.push({
            id: `driver-${trip.id}`,
            driverName,
            vehiclePlate,
            lat: fallbackDriverPoint[0],
            lng: fallbackDriverPoint[1],
            status: String(trip?.status || 'PLANNED'),
            markerColor: '#1d4ed8',
            markerLabel: 'Driver location unavailable',
            markerType: 'truck',
          })
        }
      }

      dropPoints.forEach((dropPoint: any, index: number) => {
        const dropPointOrderId = String(dropPoint?.orderId || '').trim()
        if (dropPointOrderId) tripOrderIds.add(dropPointOrderId)

        const completed = isDropPointCompleted(dropPoint?.status) || isDropPointCompleted(dropPoint?.orderStatus)
        const isNext = index === nextPendingIndex
        const stopSequence = Number.isFinite(Number(dropPoint?.sequence)) ? Number(dropPoint.sequence) : undefined
        
        locations.push({
          id: `order-${trip.id}-${dropPoint.id || dropPoint.sequence}`,
          driverName: String(dropPoint.orderNumber || dropPoint.locationName || dropPoint.address || 'Order Stop'),
          vehiclePlate: String(dropPoint.locationName || trip?.tripNumber || 'Trip'),
          lat: Number(dropPoint.latitude),
          lng: Number(dropPoint.longitude),
          status: String(dropPoint.orderStatus || dropPoint.status || 'PENDING'),
          markerColor: completed ? '#2563eb' : (isNext ? '#ef4444' : '#16a34a'),
          markerType: 'pin',
          markerLabel: completed ? 'Completed' : (isNext ? 'Next Stop' : 'Upcoming'),
          markerNumber: stopSequence,
        })
      })

      if (logs.length > 1) {
        routeLines.push({
          id: `completed-${trip.id}`,
          points: logs.map((log: any) => [Number(log.latitude), Number(log.longitude)] as [number, number]),
          color: '#93c5fd',
          label: `${trip.tripNumber || 'Trip'} - Completed route`,
          opacity: 0.85,
          weight: 6,
          dashArray: '7 9',
        })
      }

      const pendingPoints = dropPoints.filter(
        (point: any) => !isDropPointCompleted(point?.status) && !isDropPointCompleted(point?.orderStatus)
      )
      if (hasDriverPosition && pendingPoints.length > 0) {
        routeLines.push({
          id: `remaining-${trip.id}`,
          points: [
            [driverLat, driverLng],
            ...pendingPoints.map((point: any) => [Number(point.latitude), Number(point.longitude)] as [number, number]),
          ],
          color: '#2563eb',
          label: `${trip.tripNumber || 'Trip'} - Remaining route`,
          opacity: 1,
          weight: 8,
          snapToRoad: true,
        })
      } else if (logs.length <= 1 && dropPoints.length > 0) {
        const plannedWaypoints: [number, number][] = [
          ...(warehouseStart ? [warehouseStart] : []),
          ...dropPoints.map((point: any) => [Number(point.latitude), Number(point.longitude)] as [number, number]),
        ]
        for (let index = 0; index < plannedWaypoints.length - 1; index += 1) {
          const nextPoint = dropPoints[Math.max(0, index - (warehouseStart ? 1 : 0))]
          const completed = isDropPointCompleted(nextPoint?.status) || isDropPointCompleted(nextPoint?.orderStatus)
          routeLines.push({
            id: `planned-${trip.id}-${index}`,
            points: [
              plannedWaypoints[index],
              plannedWaypoints[index + 1],
            ],
            color: completed ? '#93c5fd' : '#2563eb',
            label: `${trip.tripNumber || 'Trip'} route segment`,
            opacity: completed ? 0.85 : 1,
            weight: completed ? 6 : 8,
            dashArray: completed ? '7 9' : undefined,
            snapToRoad: true,
          })
        }
      }
    })

    dayOrders.forEach((order: any) => {
      const orderId = String(order?.id || '').trim()
      if (orderId && tripOrderIds.has(orderId)) return

      const lat = Number(order?.shippingLatitude)
      const lng = Number(order?.shippingLongitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      const completed = isCompletedOrderStatus(order?.status)
      locations.push({
        id: `standalone-order-${order.id}`,
        driverName: String(order?.orderNumber || 'Order'),
        vehiclePlate: String(order?.shippingAddress || 'Customer location'),
        lat,
        lng,
        status: String(order?.status || 'PREPARING'),
        markerColor: completed ? '#2563eb' : '#16a34a',
        markerType: 'pin',
        markerLabel: completed ? 'Completed order location' : 'Not completed order location',
      })
    })

    return { locations, routeLines }
  }, [ordersForMap, trackingDate, trips])

  const mapLocations = mapData.locations
  const routeLines = mapData.routeLines

  const mapCenter = (mapLocations[0]
    ? [mapLocations[0].lat, mapLocations[0].lng]
    : [10.55, 122.95]) as [number, number]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
          <p className="text-gray-500">Monitor active deliveries in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={trackingDate}
            onChange={(event) => setTrackingDate(event.target.value)}
            className="w-[160px]"
          />
          <Button className="gap-2" onClick={fetchTrackingTrips} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Refresh Map
          </Button>
        </div>
      </div>

      <div className="text-sm text-slate-600">
        Route colors: <span className="font-medium text-blue-400">Muted blue dashed = Completed</span> •{' '}
        <span className="font-medium text-blue-700">Bright blue = Upcoming</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="h-[500px]">
            <CardContent className="p-0 h-full">
              <LiveTrackingMap
                locations={mapLocations}
                routeLines={routeLines}
                center={mapCenter}
                zoom={mapLocations.length > 0 ? 12 : 10}
                className="w-full h-full rounded-xl overflow-hidden"
                restrictToNegrosOccidental
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Trips</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : activeTrips.length === 0 ? (
                <p className="text-sm text-gray-500">No active trips right now</p>
              ) : (
                <div className="space-y-3">
                  {activeTrips.slice(0, 5).map((trip: any) => (
                    <div key={trip.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <div className="bg-green-500 h-2 w-2 rounded-full animate-pulse"></div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{trip.tripNumber}</p>
                        <p className="text-xs text-gray-500">Driver: {trip.driver?.user?.name || 'Unassigned'}</p>
                      </div>
                      <Badge variant="outline">
                        {trip.completedDropPoints || 0}/{trip.totalDropPoints || 0}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Locations</CardTitle>
            </CardHeader>
            <CardContent>
              {recentLocations.length === 0 ? (
                <p className="text-sm text-gray-500">No coordinate logs available</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {recentLocations.map((log: any) => (
                    <div key={log.id} className="flex justify-between gap-2">
                      <span className="text-gray-500 truncate">
                        {new Date(log.recordedAt || log.createdAt || Date.now()).toLocaleTimeString()}
                      </span>
                      <span>{Number(log.latitude).toFixed(4)}, {Number(log.longitude).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function FeedbackView() {
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [respondingItem, setRespondingItem] = useState<any | null>(null)
  const [responseText, setResponseText] = useState('')
  const [isResponding, setIsResponding] = useState(false)

  useEffect(() => {
    async function fetchFeedbacks() {
      try {
        const response = await fetch('/api/feedback?limit=200')
        if (response.ok) {
          const data = await response.json()
          setFeedbacks(getCollection(data, ['feedbacks']))
        }
      } catch (error) {
        console.error('Failed to fetch feedback:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchFeedbacks()
  }, [])

  const rated = feedbacks.filter((item) => typeof item.rating === 'number' && item.rating > 0)
  const avgRating = rated.length > 0
    ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length
    : 0
  const resolvedCount = feedbacks.filter((item) => ['RESOLVED', 'CLOSED'].includes(item.status)).length
  const responseRate = feedbacks.length > 0 ? Math.round((resolvedCount / feedbacks.length) * 100) : 0
  const promoters = rated.filter((item) => item.rating >= 4).length
  const detractors = rated.filter((item) => item.rating <= 2).length
  const npsScore = rated.length > 0 ? Math.round(((promoters - detractors) / rated.length) * 100) : 0

  const ratingDistribution = [5, 4, 3, 2, 1].map((score) => ({
    label: `${score} Star${score > 1 ? 's' : ''}`,
    value: rated.filter((item) => item.rating === score).length,
  }))
  const maxDistribution = Math.max(...ratingDistribution.map((item) => item.value), 1)

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
  const trendData = monthNames.map((month, index) => {
    const monthRated = rated.filter((item) => {
      const d = new Date(item.createdAt)
      return !Number.isNaN(d.getTime()) && d.getMonth() === index
    })
    const avg = monthRated.length > 0
      ? monthRated.reduce((sum, item) => sum + item.rating, 0) / monthRated.length
      : null
    return { month, avg: avg ?? null }
  })
  let fallback = 4.2
  const trendWithFallback = trendData.map((item) => {
    if (typeof item.avg === 'number') {
      fallback = item.avg
      return { ...item, avg: Number(item.avg.toFixed(2)) }
    }
    return { ...item, avg: Number(fallback.toFixed(2)) }
  })

  const detectCategory = (item: any) => {
    const text = `${item.subject || ''} ${item.message || ''}`.toLowerCase()
    if (text.includes('price') || text.includes('cost') || text.includes('expensive')) return 'Pricing'
    if (text.includes('service') || text.includes('support') || text.includes('staff')) return 'Customer Service'
    if (text.includes('quality') || text.includes('damaged') || text.includes('dent') || text.includes('broken')) return 'Product Quality'
    return 'Delivery'
  }

  const categoryNames = ['Delivery', 'Product Quality', 'Customer Service', 'Pricing']
  const categoryCards = categoryNames.map((name) => {
    const list = feedbacks.filter((item) => detectCategory(item) === name)
    const ratedList = list.filter((item) => typeof item.rating === 'number' && item.rating > 0)
    const positive = ratedList.length > 0 ? Math.round((ratedList.filter((item) => item.rating >= 4).length / ratedList.length) * 100) : 0
    const negative = ratedList.length > 0 ? Math.round((ratedList.filter((item) => item.rating <= 2).length / ratedList.length) * 100) : 0
    return { name, positive, negative }
  })

  const filteredFeedbacks = feedbacks.filter((item) => {
    const search = searchTerm.trim().toLowerCase()
    const matchesSearch =
      search.length === 0 ||
      String(item.customer?.name || '').toLowerCase().includes(search) ||
      String(item.order?.orderNumber || '').toLowerCase().includes(search)
    const matchesRating = ratingFilter === 'all' || Number(item.rating || 0) === Number(ratingFilter)
    return matchesSearch && matchesRating
  })

  const renderStars = (rating: number) => (
    <span className="text-amber-500">
      {'★'.repeat(Math.max(0, Math.min(5, Math.round(Number(rating || 0)))))}
      <span className="text-gray-300">
        {'★'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, Math.round(Number(rating || 0))))))}
      </span>
    </span>
  )

  const submitResponse = async () => {
    if (!respondingItem?.id) return
    if (!responseText.trim()) {
      toast.error('Response is required')
      return
    }

    setIsResponding(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: respondingItem.id,
          response: responseText.trim(),
          status: 'RESOLVED',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to respond')
      }

      setFeedbacks((prev) =>
        prev.map((item) =>
          item.id === respondingItem.id
            ? { ...item, status: 'RESOLVED', response: responseText.trim(), respondedAt: new Date().toISOString() }
            : item
        )
      )
      toast.success('Response submitted')
      setRespondingItem(null)
      setResponseText('')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit response')
    } finally {
      setIsResponding(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Feedback</h1>
          <p className="text-gray-500">Monitor customer satisfaction and improve service quality</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-amber-50 flex items-center justify-center">
                {/* Star icon removed */}
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg Rating</p>
                <p className="text-3xl font-bold">{avgRating.toFixed(1)}/5.0</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-blue-50 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Feedback</p>
                <p className="text-3xl font-bold">{feedbacks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-green-50 flex items-center justify-center">
                {/* ThumbsUp icon removed */}
              </div>
              <div>
                <p className="text-sm text-gray-500">Response Rate</p>
                <p className="text-3xl font-bold">{responseRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-purple-50 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">NPS Score</p>
                <p className="text-3xl font-bold">{npsScore}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {ratingDistribution.map((row) => (
              <div key={row.label} className="grid grid-cols-[80px_1fr_40px] items-center gap-3">
                <span className="text-gray-600">{row.label}</span>
                <div className="h-3 rounded-md bg-gray-100 overflow-hidden">
                  <div className={`h-full min-w-[4px] bg-blue-500 transition-all ${getWidthClass((row.value / maxDistribution) * 100)}`} />
                </div>
                <span className="text-sm text-gray-600 text-right">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Satisfaction Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {/* Chart removed for missing components */}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Feedback by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {categoryCards.map((category) => (
              <Card key={category.name}>
                <CardContent className="pt-5 space-y-2">
                  <p className="font-semibold">{category.name}</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-gray-700">Positive</span>
                    <span className="text-green-600 font-semibold">{category.positive}%</span>
                  </div>
                  <div className="h-2 rounded-md bg-gray-100 overflow-hidden">
                    <div className={`h-full min-w-[2px] bg-green-500 transition-all ${getWidthClass(category.positive)}`} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-gray-700">Negative</span>
                    <span className="text-red-600 font-semibold">{category.negative}%</span>
                  </div>
                  <div className="h-2 rounded-md bg-gray-100 overflow-hidden">
                    <div className={`h-full min-w-[2px] bg-red-500 transition-all ${getWidthClass(category.negative)}`} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <label className="text-sm font-medium text-gray-700">Feedback Search and Filter</label>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              {/* Search icon removed */}
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by customer or order ID..."
                className="pl-10"
              />
            </div>
            <Button variant="outline" size="icon">
              {/* <Filter className="h-4 w-4" /> */}
            </Button>
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter Rating"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4 Stars</option>
              <option value="3">3 Stars</option>
              <option value="2">2 Stars</option>
              <option value="1">1 Star</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredFeedbacks.length === 0 ? (
            <div className="py-12 text-center">
              <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No customer feedback found</p>
            </div>
          ) : (
            filteredFeedbacks.map((item: any) => {
              const isResolved = ['RESOLVED', 'CLOSED'].includes(item.status)
              const category = detectCategory(item)
              return (
                <div key={item.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <MessageSquare className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-xl">{item.customer?.name || 'Customer'} <span className="text-base font-normal text-gray-500">� {item.order?.orderNumber || 'No Order'}</span></p>
                        <div className="mt-2 flex items-center gap-2">
                          {renderStars(Number(item.rating || 0))}
                          <span className="text-sm text-gray-500">� {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                    <Badge className={isResolved ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100'}>
                      {isResolved ? 'Resolved' : 'Pending'}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Badge variant="outline">{category}</Badge>
                  </div>
                  <p className="mt-3 text-xl leading-normal">{item.message || item.subject || 'No message'}</p>
                  {item.response ? (
                    <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm">
                      <span className="font-semibold">Response:</span> {item.response}
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Button onClick={() => { setRespondingItem(item); setResponseText('') }}>Respond</Button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={!!respondingItem} onOpenChange={(open) => !open && setRespondingItem(null)}>
        <DialogContent>
          {respondingItem && (
            <>
              <DialogHeader>
                <DialogTitle>Respond to Feedback</DialogTitle>
                <DialogDescription>Customer: {respondingItem.customer?.name || 'N/A'} � {respondingItem.order?.orderNumber || 'N/A'}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Response</label>
                <textarea
                  className="w-full min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Type your response..."
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setRespondingItem(null)}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={submitResponse} disabled={isResponding}>
                    {isResponding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Send Response
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReportsView() {
  const { user } = useAuth()
  const [activeReportTab, setActiveReportTab] = useState('orders')
  const [rangeDays, setRangeDays] = useState<'7' | '30' | '90'>('30')
  const [selectedWarehouse, setSelectedWarehouse] = useState('all')
  const [selectedDriver, setSelectedDriver] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [presetName, setPresetName] = useState('')
  const [savedPresets, setSavedPresets] = useState<Array<{ name: string; filters: { rangeDays: '7' | '30' | '90'; selectedWarehouse: string; selectedDriver: string; selectedStatus: string; activeReportTab: string } }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [orders, setOrders] = useState<any[]>([])
  const [trips, setTrips] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [inventory, setInventory] = useState<any[]>([])
  const [inventoryTransactions, setInventoryTransactions] = useState<any[]>([])
  const [returnsData, setReturnsData] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const reportBranding = {
    companyName: "Ann Ann's Beverages Trading",
    subtitle: 'Logistics Management System - Report Pack',
    preparedBy: String(user?.name || user?.email || 'System Administrator'),
  }
  const presetStorageKey = 'admin-reports-filter-presets-v1'

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(presetStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      setSavedPresets(parsed)
    } catch {
      setSavedPresets([])
    }
  }, [])

  const persistPresets = (next: Array<{ name: string; filters: { rangeDays: '7' | '30' | '90'; selectedWarehouse: string; selectedDriver: string; selectedStatus: string; activeReportTab: string } }>) => {
    setSavedPresets(next)
    window.localStorage.setItem(presetStorageKey, JSON.stringify(next))
  }

  useEffect(() => {
    let isMounted = true

    async function fetchReportsPack() {
      setIsLoading(true)
      try {
        const [ordersRes, tripsRes, driversRes, warehousesRes, inventoryRes, transactionsRes, feedbackRes] = await Promise.all([
          safeFetchJson('/api/orders?limit=1000&includeItems=none&includeReturns=true', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/trips?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/drivers?limit=500', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/warehouses?limit=200', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/inventory?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/inventory-transactions?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/feedback?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
        ])

        if (!isMounted) return

        setOrders(ordersRes.ok ? getCollection<any>(ordersRes.data, ['orders']) : [])
        setTrips(tripsRes.ok ? getCollection<any>(tripsRes.data, ['trips']) : [])
        setDrivers(driversRes.ok ? getCollection<any>(driversRes.data, ['drivers']) : [])
        setWarehouses(warehousesRes.ok ? getCollection<any>(warehousesRes.data, ['warehouses']) : [])
        setInventory(inventoryRes.ok ? getCollection<any>(inventoryRes.data, ['inventory']) : [])
        setInventoryTransactions(transactionsRes.ok ? getCollection<any>(transactionsRes.data, ['transactions']) : [])
        setReturnsData(ordersRes.ok ? getCollection<any>(ordersRes.data, ['returns']) : [])
        setFeedback(feedbackRes.ok ? getCollection<any>(feedbackRes.data, ['feedback']) : [])
      } catch (error) {
        console.error('Failed to load reports pack:', error)
        if (isMounted) {
          setOrders([])
          setTrips([])
          setDrivers([])
          setWarehouses([])
          setInventory([])
          setInventoryTransactions([])
          setReturnsData([])
          setFeedback([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchReportsPack()

    const unsubscribe = subscribeDataSync((message) => {
      if (
        message.scopes.includes('orders') ||
        message.scopes.includes('trips') ||
        message.scopes.includes('inventory') ||
        message.scopes.includes('stocks') ||
        message.scopes.includes('feedback') ||
        message.scopes.includes('returns')
      ) {
        void fetchReportsPack()
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const rangeStart = useMemo(() => {
    const days = Number(rangeDays)
    const start = new Date()
    start.setDate(start.getDate() - days)
    return start
  }, [rangeDays])

  const orderRows = useMemo(() => {
    return orders
      .filter((order) => withinRange(order.createdAt, rangeStart))
      .filter((order) => selectedWarehouse === 'all' || String(order.warehouseId || '') === selectedWarehouse)
      .filter((order) => selectedStatus === 'all' || String(order.status || '').toUpperCase() === selectedStatus)
      .map((order) => {
        const checklistComplete = Boolean(
          order.checklistItemsVerified &&
          order.checklistQuantityVerified &&
          order.checklistPackagingVerified &&
          order.checklistVehicleAssigned &&
          order.checklistDriverAssigned
        )
        const shortLoadQty = Number(order.exceptionShortLoadQty || 0)
        const damagedOnLoadingQty = Number(order.exceptionDamagedOnLoadingQty || 0)
        const holdReason = String(order.exceptionHoldReason || '').trim()
        return {
          orderNumber: order.orderNumber,
          customer: order.customer?.name || 'N/A',
          status: String(order.status || ''),
          warehouseStage: String(order.warehouseStage || 'READY_TO_LOAD'),
          checklistComplete,
          dispatchSignedOffBy: order.dispatchSignedOffBy || 'N/A',
          dispatchSignedOffAt: order.dispatchSignedOffAt || null,
          shortLoadQty,
          damagedOnLoadingQty,
          holdReason: holdReason || 'N/A',
          hasExceptions: shortLoadQty > 0 || damagedOnLoadingQty > 0 || holdReason.length > 0,
          amount: Number(order.totalAmount || 0),
          createdAt: order.createdAt,
          deliveredAt: order.timeline?.deliveredAt || order.deliveredAt,
        }
      })
  }, [orders, rangeStart, selectedWarehouse, selectedStatus])

  const warehouseDispatchRows = useMemo(() => {
    return orderRows
      .map((row) => {
        const rawStatus = String(row.status || '').toUpperCase()
        const normalizedOrderStatus =
          ['PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'UNAPPROVED'].includes(rawStatus)
            ? 'PREPARING'
            : ['DISPATCHED', 'IN_TRANSIT'].includes(rawStatus)
              ? 'OUT_FOR_DELIVERY'
              : rawStatus === 'FAILED_DELIVERY'
                ? 'CANCELLED'
                : rawStatus
        return {
          ...row,
          normalizedOrderStatus,
        }
      })
      .filter(
        (row) =>
          ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(String(row.normalizedOrderStatus || '')) ||
          ['LOADED', 'DISPATCHED'].includes(String(row.warehouseStage || '').toUpperCase())
      )
      .map((row) => ({
        orderNumber: row.orderNumber,
        customer: row.customer,
        createdAt: row.createdAt,
        warehouseStage: row.warehouseStage,
        orderStatus: row.normalizedOrderStatus,
        checklistComplete: row.checklistComplete ? 'YES' : 'NO',
        dispatchSignedOffBy: row.dispatchSignedOffBy,
        dispatchSignedOffAt: row.dispatchSignedOffAt ? formatDateTime(row.dispatchSignedOffAt) : 'N/A',
        shortLoadQty: row.shortLoadQty,
        damagedOnLoadingQty: row.damagedOnLoadingQty,
        holdReason: row.holdReason,
        hasExceptions: row.hasExceptions ? 'YES' : 'NO',
      }))
  }, [orderRows])

  const transportRows = useMemo(() => {
    return trips
      .filter((trip) => withinRange(trip.createdAt || trip.plannedStartAt, rangeStart))
      .filter((trip) => selectedWarehouse === 'all' || String(trip.warehouseId || '') === selectedWarehouse)
      .filter((trip) => selectedDriver === 'all' || String(trip.driver?.id || '') === selectedDriver)
      .filter((trip) => selectedStatus === 'all' || normalizeTripStatus(trip.status) === selectedStatus)
      .map((trip) => {
        const dropPointsTotal = Number(trip.totalDropPoints || toArray<any>(trip.dropPoints).length)
        const dropPointsCompleted = Number(trip.completedDropPoints || 0)
        const completionRate = dropPointsTotal > 0 ? Math.round((dropPointsCompleted / dropPointsTotal) * 100) : 0

        return {
          tripNumber: trip.tripNumber,
          status: normalizeTripStatus(trip.status),
          driver: trip.driver?.user?.name || 'Unassigned',
          vehicle: trip.vehicle?.licensePlate || 'Unassigned',
          dropPointsTotal,
          dropPointsCompleted,
          completionRate,
          plannedStartAt: trip.plannedStartAt,
          actualEndAt: trip.actualEndAt,
        }
      })
  }, [trips, rangeStart, selectedWarehouse, selectedDriver, selectedStatus])

  const inventoryMovementRows = useMemo(() => {
    return inventoryTransactions
      .filter((transaction) => withinRange(transaction.createdAt, rangeStart))
      .filter((transaction) => selectedWarehouse === 'all' || String(transaction.warehouse?.id || '') === selectedWarehouse)
      .filter((transaction) => selectedStatus === 'all' || String(transaction.type || '').toUpperCase() === selectedStatus)
      .map((transaction) => ({
        createdAt: transaction.createdAt,
        warehouse: transaction.warehouse?.name || 'N/A',
        product: transaction.product?.name || 'N/A',
        type: String(transaction.type || '').toUpperCase(),
        quantity: Number(transaction.quantity || 0),
        referenceType: transaction.referenceType || 'N/A',
        referenceId: transaction.referenceId || 'N/A',
      }))
  }, [inventoryTransactions, rangeStart, selectedWarehouse, selectedStatus])

  const replacementRows = useMemo(() => {
    return returnsData
      .filter((item) => withinRange(item.createdAt, rangeStart))
      .map((item) => {
        const relatedOrder = orders.find((order) => order.id === item.order)
        const rawStatus = String(item.status || '').toUpperCase()
        const normalizedStatus =
          rawStatus === 'REQUESTED'
            ? 'REPORTED'
            : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
              ? 'IN_PROGRESS'
              : rawStatus === 'REJECTED'
                ? 'NEEDS_FOLLOW_UP'
                : rawStatus === 'PROCESSED'
                  ? 'COMPLETED'
                  : rawStatus
        return {
          returnNumber: item.returnNumber,
          orderNumber: relatedOrder?.orderNumber || 'N/A',
          customer: relatedOrder?.customer?.name || 'N/A',
          status: normalizedStatus,
          replacementMode: item.replacementMode || 'N/A',
          reason: item.reason || 'N/A',
          createdAt: item.createdAt,
        }
      })
      .filter((item) => selectedStatus === 'all' || String(item.status || '').toUpperCase() === selectedStatus)
  }, [orders, returnsData, rangeStart, selectedStatus])

  const feedbackRows = useMemo(() => {
    return feedback
      .filter((item) => withinRange(item.createdAt, rangeStart))
      .filter((item) => selectedStatus === 'all' || String(item.status || '').toUpperCase() === selectedStatus)
      .map((item) => ({
        createdAt: item.createdAt,
        customer: item.customer?.name || 'N/A',
        orderId: item.order || 'N/A',
        type: item.type || 'N/A',
        rating: item.rating === null || item.rating === undefined ? 'N/A' : Number(item.rating),
        status: item.status || 'N/A',
        subject: item.subject || 'N/A',
      }))
  }, [feedback, rangeStart, selectedStatus])

  const statusOptions = useMemo(() => {
    const values = new Set<string>()
    orders.forEach((row) => values.add(String(row.status || '').toUpperCase()))
    trips.forEach((row) => values.add(String(normalizeTripStatus(row.status) || '').toUpperCase()))
    inventoryTransactions.forEach((row) => values.add(String(row.type || '').toUpperCase()))
    returnsData.forEach((row) => values.add(String(row.status || '').toUpperCase()))
    feedback.forEach((row) => values.add(String(row.status || '').toUpperCase()))
    return Array.from(values).filter(Boolean).sort()
  }, [feedback, inventoryTransactions, orders, returnsData, trips])

  const activeStatusOptions = useMemo(() => {
    if (activeReportTab === 'orders') {
      return Array.from(new Set(orderRows.map((row) => String(row.status || '').toUpperCase()))).filter(Boolean).sort()
    }
    if (activeReportTab === 'transport') {
      return Array.from(new Set(transportRows.map((row) => String(row.status || '').toUpperCase()))).filter(Boolean).sort()
    }
    if (activeReportTab === 'warehouse') {
      return Array.from(new Set(inventoryMovementRows.map((row) => String(row.type || '').toUpperCase()))).filter(Boolean).sort()
    }
    if (activeReportTab === 'replacement') {
      return Array.from(new Set(replacementRows.map((row) => String(row.status || '').toUpperCase()))).filter(Boolean).sort()
    }
    return Array.from(new Set(feedbackRows.map((row) => String(row.status || '').toUpperCase()))).filter(Boolean).sort()
  }, [activeReportTab, feedbackRows, inventoryMovementRows, orderRows, replacementRows, transportRows])

  const orderStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    orderRows.forEach((row) => {
      const key = String(row.status || 'UNKNOWN')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  }, [orderRows])

  const orderStatusTotal = useMemo(() => {
    return orderStatusChart.reduce((sum, row) => sum + Number(row.count || 0), 0)
  }, [orderStatusChart])

  const transportStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    transportRows.forEach((row) => {
      const key = String(row.status || 'UNKNOWN')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  }, [transportRows])

  const inventoryMovementChart = useMemo(() => {
    const grouped = new Map<string, { day: string; inQty: number; outQty: number }>()
    inventoryMovementRows.forEach((row) => {
      const day = formatDayLabel(row.createdAt)
      const current = grouped.get(day) || { day, inQty: 0, outQty: 0 }
      if (String(row.type || '').toUpperCase() === 'IN') current.inQty += Number(row.quantity || 0)
      if (String(row.type || '').toUpperCase() === 'OUT') current.outQty += Number(row.quantity || 0)
      grouped.set(day, current)
    })
    return Array.from(grouped.values()).slice(-12)
  }, [inventoryMovementRows])

  const replacementStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    replacementRows.forEach((row) => {
      const key = String(row.status || 'UNKNOWN')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  }, [replacementRows])

  const feedbackRatingChart = useMemo(() => {
    const counts = new Map<string, number>()
    feedbackRows.forEach((row) => {
      const rating = Number(row.rating)
      if (!Number.isFinite(rating)) return
      const key = `${Math.max(1, Math.min(5, Math.round(rating)))}`
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return ['1', '2', '3', '4', '5'].map((rating) => ({ rating, count: counts.get(rating) || 0 }))
  }, [feedbackRows])

  const orderKpi = useMemo(() => {
    const delivered = orderRows.filter((row) => row.status === 'DELIVERED').length
    const total = orderRows.length
    const deliveredRevenue = orderRows
      .filter((row) => row.status === 'DELIVERED')
      .reduce((acc, row) => acc + Number(row.amount || 0), 0)

    return {
      total,
      delivered,
      pending: total - delivered,
      fulfillmentRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      deliveredRevenue,
    }
  }, [orderRows])

  const transportKpi = useMemo(() => {
    const total = transportRows.length
    const completed = transportRows.filter((row) => row.status === 'COMPLETED').length
    const inProgress = transportRows.filter((row) => row.status === 'IN_PROGRESS').length
    const averageCompletion =
      total > 0 ? Math.round(transportRows.reduce((acc, row) => acc + Number(row.completionRate || 0), 0) / total) : 0

    return { total, completed, inProgress, averageCompletion }
  }, [transportRows])

  const inventoryKpi = useMemo(() => {
    const totalSkus = inventory.length
    const lowStock = inventory.filter((item) => Number(item.quantity || 0) <= Number(item.minStock || 0)).length
    const totalQuantity = inventory.reduce((acc, item) => acc + Number(item.quantity || 0), 0)
    const stockIn = inventoryMovementRows
      .filter((row) => row.type === 'IN')
      .reduce((acc, row) => acc + Number(row.quantity || 0), 0)
    const stockOut = inventoryMovementRows
      .filter((row) => row.type === 'OUT')
      .reduce((acc, row) => acc + Number(row.quantity || 0), 0)

    return { totalSkus, lowStock, totalQuantity, stockIn, stockOut }
  }, [inventory, inventoryMovementRows])

  const warehouseComplianceKpi = useMemo(() => {
    const total = warehouseDispatchRows.length
    const checklistComplete = warehouseDispatchRows.filter((row) => row.checklistComplete === 'YES').length
    const withSignoff = warehouseDispatchRows.filter((row) => row.dispatchSignedOffAt !== 'N/A' && row.dispatchSignedOffBy !== 'N/A').length
    const exceptions = warehouseDispatchRows.filter((row) => row.hasExceptions === 'YES').length
    const compliant = warehouseDispatchRows.filter(
      (row) => row.checklistComplete === 'YES' && row.dispatchSignedOffAt !== 'N/A' && row.dispatchSignedOffBy !== 'N/A' && row.hasExceptions === 'NO'
    ).length
    const complianceRate = total > 0 ? Math.round((compliant / total) * 100) : 0
    return { total, checklistComplete, withSignoff, exceptions, complianceRate }
  }, [warehouseDispatchRows])

  const warehouseComplianceTrend = useMemo(() => {
    const grouped = new Map<string, { day: string; compliant: number; nonCompliant: number }>()
    warehouseDispatchRows.forEach((row) => {
      const key = formatDayLabel(row.createdAt)
      const current = grouped.get(key) || { day: key, compliant: 0, nonCompliant: 0 }
      const isCompliant =
        row.checklistComplete === 'YES' &&
        row.dispatchSignedOffAt !== 'N/A' &&
        row.dispatchSignedOffBy !== 'N/A' &&
        row.hasExceptions === 'NO'
      if (isCompliant) {
        current.compliant += 1
      } else {
        current.nonCompliant += 1
      }
      grouped.set(key, current)
    })
    return Array.from(grouped.values()).slice(-14)
  }, [warehouseDispatchRows])

  const replacementKpi = useMemo(() => {
    const total = replacementRows.length
    const completed = replacementRows.filter((row) => row.status === 'COMPLETED' || row.status === 'RESOLVED_ON_DELIVERY').length
    const open = replacementRows.filter((row) => row.status === 'REPORTED' || row.status === 'IN_PROGRESS' || row.status === 'NEEDS_FOLLOW_UP').length
    return { total, completed, open }
  }, [replacementRows])

  const feedbackKpi = useMemo(() => {
    const total = feedbackRows.length
    const ratings = feedbackRows
      .map((row) => Number(row.rating))
      .filter((rating) => Number.isFinite(rating))
    const avgRating = ratings.length > 0 ? ratings.reduce((acc, rating) => acc + rating, 0) / ratings.length : 0
    const open = feedbackRows.filter((row) => String(row.status).toUpperCase() === 'OPEN').length
    return { total, avgRating, open }
  }, [feedbackRows])

  const exportAll = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`orders-report-${stamp}.csv`, orderRows)
    downloadCsv(`transport-report-${stamp}.csv`, transportRows)
    downloadCsv(`warehouse-inventory-report-${stamp}.csv`, inventoryMovementRows)
    downloadCsv(`warehouse-dispatch-compliance-report-${stamp}.csv`, warehouseDispatchRows)
    downloadCsv(`replacement-report-${stamp}.csv`, replacementRows)
    downloadCsv(`feedback-report-${stamp}.csv`, feedbackRows)
    toast.success('Reports exported')
  }

  const exportAllPdf = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Fulfillment Report', orderRows, reportBranding)
    await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation & Delivery Status Report', transportRows, reportBranding)
    await downloadPdf(`warehouse-inventory-report-${stamp}.pdf`, 'Warehouse & Inventory Movement Report', inventoryMovementRows, reportBranding)
    await downloadPdf(`warehouse-dispatch-compliance-report-${stamp}.pdf`, 'Warehouse Dispatch Compliance Report', warehouseDispatchRows, reportBranding)
    await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, reportBranding)
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackRows, reportBranding)
    toast.success('All PDF reports exported')
  }

  const resetFilters = () => {
    setRangeDays('30')
    setSelectedWarehouse('all')
    setSelectedDriver('all')
    setSelectedStatus('all')
  }

  const saveCurrentPreset = () => {
    const name = presetName.trim()
    if (!name) {
      toast.error('Enter a preset name')
      return
    }
    const next = savedPresets.filter((preset) => preset.name !== name)
    next.unshift({
      name,
      filters: {
        rangeDays,
        selectedWarehouse,
        selectedDriver,
        selectedStatus,
        activeReportTab,
      },
    })
    persistPresets(next.slice(0, 10))
    setPresetName('')
    toast.success('Filter preset saved')
  }

  const applyPreset = (name: string) => {
    const preset = savedPresets.find((item) => item.name === name)
    if (!preset) return
    setRangeDays(preset.filters.rangeDays)
    setSelectedWarehouse(preset.filters.selectedWarehouse)
    setSelectedDriver(preset.filters.selectedDriver)
    setSelectedStatus(preset.filters.selectedStatus)
    setActiveReportTab(preset.filters.activeReportTab)
    toast.success(`Preset applied: ${name}`)
  }

  const deletePreset = (name: string) => {
    const next = savedPresets.filter((preset) => preset.name !== name)
    persistPresets(next)
    toast.success('Preset deleted')
  }

  const exportCurrentPdf = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (activeReportTab === 'orders') {
      await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Fulfillment Report', orderRows, reportBranding)
      return
    }
    if (activeReportTab === 'transport') {
      await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation & Delivery Status Report', transportRows, reportBranding)
      return
    }
    if (activeReportTab === 'warehouse') {
      await downloadPdf(
        `warehouse-inventory-report-${stamp}.pdf`,
        'Warehouse & Inventory Movement Report',
        inventoryMovementRows,
        reportBranding
      )
      return
    }
    if (activeReportTab === 'replacement') {
      await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, reportBranding)
      return
    }
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackRows, reportBranding)
  }

  const printCurrentReport = () => {
    const reportMap: Record<string, { title: string; rows: Array<Record<string, unknown>> }> = {
      orders: { title: 'Order Fulfillment Report', rows: orderRows },
      transport: { title: 'Transportation & Delivery Status Report', rows: transportRows },
      warehouse: { title: 'Warehouse & Inventory Movement Report', rows: inventoryMovementRows },
      replacement: { title: 'Replacement Handling Report', rows: replacementRows },
      feedback: { title: 'Client Feedback & Service Evaluation Report', rows: feedbackRows },
    }

    const report = reportMap[activeReportTab]
    if (!report || report.rows.length === 0) {
      toast.error('No report data to print')
      return
    }

    const columns = Object.keys(report.rows[0])
    const bodyRows = report.rows
      .slice(0, 300)
      .map((row) => `<tr>${columns.map((column) => `<td>${String(row[column] ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`)
      .join('')

    const html = `
      <html>
        <head>
          <title>${report.title}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            h1 { margin: 0 0 2px 0; font-size: 20px; }
            h2 { margin: 0 0 12px 0; font-size: 12px; color: #4b5563; font-weight: 500; }
            p { margin: 0 0 12px 0; color: #444; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
            th { background: #f5f5f5; }
            .signatures { margin-top: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
            .signature-line { margin-top: 32px; border-top: 1px solid #111; padding-top: 6px; font-size: 11px; }
          </style>
        </head>
        <body>
          <h1>${reportBranding.companyName}</h1>
          <h2>${reportBranding.subtitle}</h2>
          <p><strong>${report.title}</strong></p>
          <p>Generated at ${new Date().toLocaleString()} | Date range: last ${rangeDays} days | Prepared by: ${reportBranding.preparedBy}</p>
          <table>
            <thead>
              <tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
          <div class="signatures">
            <div>
              <div class="signature-line">Prepared by</div>
            </div>
            <div>
              <div class="signature-line">Reviewed by</div>
            </div>
            <div>
              <div class="signature-line">Approved by</div>
            </div>
          </div>
        </body>
      </html>
    `

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Unable to open print window')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const previewRows = <T extends Record<string, unknown>>(rows: T[]) => rows.slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-500">Order, transport, warehouse, replacement, and feedback reports</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={rangeDays}
            onChange={(event) => setRangeDays(event.target.value as '7' | '30' | '90')}
            title="Select report date range"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedWarehouse}
            onChange={(event) => setSelectedWarehouse(event.target.value)}
            title="Filter by warehouse"
          >
            <option value="all">All Warehouses</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name || warehouse.code || warehouse.id}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedDriver}
            onChange={(event) => setSelectedDriver(event.target.value)}
            title="Filter by driver"
          >
            <option value="all">All Drivers</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver?.user?.name || driver.name || driver.id}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
            title="Filter by status"
          >
            <option value="all">All Statuses</option>
            {(activeStatusOptions.length ? activeStatusOptions : statusOptions).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <Input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Preset name"
            className="h-10 w-36"
          />
          <Button variant="outline" className="gap-2" onClick={saveCurrentPreset}>
            Save Preset
          </Button>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => {
              if (!event.target.value) return
              applyPreset(event.target.value)
              event.target.value = ''
            }}
            title="Apply saved preset"
            defaultValue=""
          >
            <option value="">Apply Preset</option>
            {savedPresets.map((preset) => (
              <option key={preset.name} value={preset.name}>{preset.name}</option>
            ))}
          </select>
          <Button variant="outline" className="gap-2" onClick={resetFilters}>
            Reset Filters
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              const latest = savedPresets[0]
              if (!latest) {
                toast.error('No saved presets to delete')
                return
              }
              deletePreset(latest.name)
            }}
          >
            Delete Latest Preset
          </Button>
          <Button variant="outline" className="gap-2" onClick={printCurrentReport} disabled={isLoading}>
            <FileText className="h-4 w-4" />
            Print Current
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => void exportCurrentPdf()} disabled={isLoading}>
            <Download className="h-4 w-4" />
            Export Current PDF
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => void exportAllPdf()} disabled={isLoading}>
            <Download className="h-4 w-4" />
            Export All PDF
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportAll} disabled={isLoading}>
            <Download className="h-4 w-4" />
            Export All CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="h-52 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeReportTab} onValueChange={setActiveReportTab} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 p-1 md:grid-cols-5">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="transport">Transport</TabsTrigger>
            <TabsTrigger value="warehouse">Warehouse/Inventory</TabsTrigger>
            <TabsTrigger value="replacement">Replacement</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card><CardHeader><CardDescription>Total Orders</CardDescription><CardTitle>{orderKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Delivered</CardDescription><CardTitle>{orderKpi.delivered}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Fulfillment Rate</CardDescription><CardTitle>{orderKpi.fulfillmentRate}%</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Delivered Revenue</CardDescription><CardTitle>{formatPeso(orderKpi.deliveredRevenue)}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Orders by Status</CardTitle>
                <CardDescription>Status distribution for selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {orderStatusChart.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No order status data for this range</p>
                  ) : (
                    orderStatusChart
                      .slice()
                      .sort((a, b) => Number(b.count) - Number(a.count))
                      .map((item) => {
                        const count = Number(item.count || 0)
                        const percent = orderStatusTotal > 0 ? Math.round((count / orderStatusTotal) * 100) : 0
                        return (
                          <div key={item.status} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-gray-800">{item.status}</span>
                              <span className="text-gray-600">{count} ({percent}%)</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                              <div className={`h-full rounded-full bg-blue-600 ${getWidthClass(percent)}`} />
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Order Fulfillment Report</CardTitle>
                  <CardDescription>Latest orders within selected date range</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadCsv('orders-report.csv', orderRows)}>Export CSV</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Order</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Amount</th>
                        <th className="p-3 text-left">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(orderRows).map((row, index) => (
                        <tr key={`${row.orderNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3">{formatPeso(Number(row.amount || 0))}</td>
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {orderRows.length === 0 ? <p className="py-8 text-center text-gray-500">No orders found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transport" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card><CardHeader><CardDescription>Total Trips</CardDescription><CardTitle>{transportKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Completed Trips</CardDescription><CardTitle>{transportKpi.completed}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>In Progress</CardDescription><CardTitle>{transportKpi.inProgress}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Average Completion</CardDescription><CardTitle>{transportKpi.averageCompletion}%</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Transport Status Distribution</CardTitle>
                <CardDescription>Trips by current status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={transportStatusChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="status" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#059669" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Transportation & Delivery Status Report</CardTitle>
                  <CardDescription>Trip assignment and completion details</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadCsv('transport-report.csv', transportRows)}>Export CSV</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Trip</th>
                        <th className="p-3 text-left">Driver</th>
                        <th className="p-3 text-left">Vehicle</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(transportRows).map((row, index) => (
                        <tr key={`${row.tripNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.tripNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.driver || 'N/A')}</td>
                          <td className="p-3">{String(row.vehicle || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3">{String(row.dropPointsCompleted || 0)}/{String(row.dropPointsTotal || 0)} ({String(row.completionRate || 0)}%)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {transportRows.length === 0 ? <p className="py-8 text-center text-gray-500">No trips found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="warehouse" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <Card><CardHeader><CardDescription>Total SKUs</CardDescription><CardTitle>{inventoryKpi.totalSkus}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Low Stock SKUs</CardDescription><CardTitle>{inventoryKpi.lowStock}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Total On Hand</CardDescription><CardTitle>{inventoryKpi.totalQuantity}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Stock In</CardDescription><CardTitle>{inventoryKpi.stockIn}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Stock Out</CardDescription><CardTitle>{inventoryKpi.stockOut}</CardTitle></CardHeader></Card>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <Card><CardHeader><CardDescription>Dispatch Candidates</CardDescription><CardTitle>{warehouseComplianceKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Checklist Complete</CardDescription><CardTitle>{warehouseComplianceKpi.checklistComplete}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>With Signoff</CardDescription><CardTitle>{warehouseComplianceKpi.withSignoff}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Exceptions</CardDescription><CardTitle>{warehouseComplianceKpi.exceptions}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Compliance Rate</CardDescription><CardTitle>{warehouseComplianceKpi.complianceRate}%</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Stock In vs Stock Out Trend</CardTitle>
                <CardDescription>Movement by day</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={inventoryMovementChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="inQty" stroke="#0284c7" fill="#bae6fd" />
                      <Area type="monotone" dataKey="outQty" stroke="#b91c1c" fill="#fecaca" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Warehouse & Inventory Movement Report</CardTitle>
                  <CardDescription>Stock transactions and movement history</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadCsv('warehouse-inventory-report.csv', inventoryMovementRows)}>Export CSV</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-left">Warehouse</th>
                        <th className="p-3 text-left">Product</th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(inventoryMovementRows).map((row, index) => (
                        <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                          <td className="p-3">{String(row.warehouse || 'N/A')}</td>
                          <td className="p-3">{String(row.product || 'N/A')}</td>
                          <td className="p-3">{String(row.type || 'N/A')}</td>
                          <td className="p-3">{String(row.quantity || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {inventoryMovementRows.length === 0 ? <p className="py-8 text-center text-gray-500">No inventory movement found for this range</p> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Warehouse Dispatch Compliance Report</CardTitle>
                  <CardDescription>Checklist, signoff, and exception visibility for load/dispatch</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadCsv('warehouse-dispatch-compliance-report.csv', warehouseDispatchRows)}>Export CSV</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void downloadPdf('warehouse-dispatch-compliance-report.pdf', 'Warehouse Dispatch Compliance Report', warehouseDispatchRows, reportBranding)}
                  >
                    Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Order</th>
                        <th className="p-3 text-left">Stage</th>
                        <th className="p-3 text-left">Checklist</th>
                        <th className="p-3 text-left">Signoff</th>
                        <th className="p-3 text-left">Exceptions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(warehouseDispatchRows).map((row, index) => (
                        <tr key={`${row.orderNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.warehouseStage || 'N/A')}</td>
                          <td className="p-3">{String(row.checklistComplete || 'NO')}</td>
                          <td className="p-3">{String(row.dispatchSignedOffBy || 'N/A')}</td>
                          <td className="p-3">{String(row.hasExceptions || 'NO')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {warehouseDispatchRows.length === 0 ? <p className="py-8 text-center text-gray-500">No warehouse dispatch compliance records for this range</p> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dispatch Compliance Trend</CardTitle>
                <CardDescription>Daily compliant vs non-compliant dispatch records</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={warehouseComplianceTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="compliant" fill="#059669" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="nonCompliant" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="replacement" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card><CardHeader><CardDescription>Total Cases</CardDescription><CardTitle>{replacementKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Processed</CardDescription><CardTitle>{replacementKpi.completed}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Open Cases</CardDescription><CardTitle>{replacementKpi.open}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Replacement Case Status</CardTitle>
                <CardDescription>Status distribution of replacement cases</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={replacementStatusChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="status" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Returned or Damaged Products Report</CardTitle>
                  <CardDescription>Replacement handling and case tracking</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadCsv('replacement-report.csv', replacementRows)}>Export CSV</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Replacement #</th>
                        <th className="p-3 text-left">Order #</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Mode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(replacementRows).map((row, index) => (
                        <tr key={`${row.returnNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.returnNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3">{String(row.replacementMode || 'N/A')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {replacementRows.length === 0 ? <p className="py-8 text-center text-gray-500">No replacement records found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="feedback" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card><CardHeader><CardDescription>Total Feedback</CardDescription><CardTitle>{feedbackKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Average Rating</CardDescription><CardTitle>{feedbackKpi.avgRating.toFixed(2)}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Open Items</CardDescription><CardTitle>{feedbackKpi.open}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Ratings Distribution</CardTitle>
                <CardDescription>Client rating spread from 1 to 5</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={feedbackRatingChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="rating" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Client Feedback & Service Evaluation Report</CardTitle>
                  <CardDescription>Customer ratings and evaluation records</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadCsv('feedback-report.csv', feedbackRows)}>Export CSV</Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Rating</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(feedbackRows).map((row, index) => (
                        <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.type || 'N/A')}</td>
                          <td className="p-3">{String(row.rating || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {feedbackRows.length === 0 ? <p className="py-8 text-center text-gray-500">No feedback records found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function UsersView() {
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerificationSending, setIsVerificationSending] = useState(false)
  const [isVerificationConfirming, setIsVerificationConfirming] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [emailVerificationRequested, setEmailVerificationRequested] = useState(false)
  const [emailVerificationCode, setEmailVerificationCode] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    roleId: '',
    password: '',
    confirmPassword: '',
    isActive: true,
  })

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const [usersResponse, rolesResponse] = await Promise.all([fetch('/api/users?pageSize=200'), fetch('/api/roles')])
      if (usersResponse.ok) {
        const data = await usersResponse.json()
        setUsers(toArray(data?.data ?? data?.users ?? data))
      }
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        setRoles(toArray(rolesData?.data ?? rolesData?.roles ?? rolesData))
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const resetForm = () => {
    setForm({
      name: '',
      email: '',
      phone: '',
      roleId: '',
      password: '',
      confirmPassword: '',
      isActive: true,
    })
    setEmailVerificationRequested(false)
    setEmailVerificationCode('')
    setEmailVerified(false)
    setShowPassword(false)
    setEditingUser(null)
  }

  const openEdit = (user: any) => {
    setEditingUser(user)
    setForm({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      roleId: user.roleId || '',
      password: '',
      confirmPassword: '',
      isActive: !!user.isActive,
    })
    setEditOpen(true)
  }

  const saveUser = async (mode: 'create' | 'edit') => {
    if (!form.name.trim() || !form.email.trim() || !form.roleId) {
      toast.error('Name, email and role are required')
      return
    }
    if (mode === 'create' && !form.password) {
      toast.error('Password is required for new user')
      return
    }
    if (mode === 'create' && form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }
    if (mode === 'create' && !emailVerified) {
      toast.error('Verify the Gmail address before creating the user')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = mode === 'create' ? '/api/users' : `/api/users/${editingUser.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          roleId: form.roleId,
          password: form.password || undefined,
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save user')
      }
      toast.success(mode === 'create' ? 'User added' : 'User updated')
      setAddOpen(false)
      setEditOpen(false)
      resetForm()
      await fetchUsers()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save user')
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestEmailVerification = async () => {
    const email = form.email.trim().toLowerCase()
    if (!email) {
      toast.error('Enter an email address first')
      return
    }
    setIsVerificationSending(true)
    try {
      const response = await fetch('/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send verification code')
      }
      setEmailVerificationRequested(true)
      setEmailVerificationCode('')
      setEmailVerified(false)
      toast.success('Verification code sent to the Gmail address')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send verification code')
    } finally {
      setIsVerificationSending(false)
    }
  }

  const confirmEmailVerification = async () => {
    const email = form.email.trim().toLowerCase()
    if (!emailVerificationCode.trim()) {
      toast.error('Enter the verification code first')
      return
    }
    setIsVerificationConfirming(true)
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff', otp: emailVerificationCode.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify email')
      }
      setEmailVerified(true)
      toast.success('Email verified successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify email')
    } finally {
      setIsVerificationConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500">Manage staff accounts and permissions</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          {/* <Users className="h-4 w-4" /> */}
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12">
              {/* <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" /> */}
              <p className="text-gray-500">No users found</p>
              <Button className="mt-4">Add First User</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">User</th>
                    <th className="text-left p-4 font-medium text-gray-600">Email</th>
                    <th className="text-left p-4 font-medium text-gray-600">Role</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-blue-600 text-white text-sm">
                              {user.name?.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{user.name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-gray-500">{user.email}</td>
                      <td className="p-4">
                        <Badge variant="outline">{formatRoleLabel(user.role?.name)}</Badge>
                      </td>
                      <td className="p-4">
                        <Badge variant={user.isActive ? 'default' : 'secondary'}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <Button variant="outline" size="sm" onClick={() => openEdit(user)}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>Create a new staff account.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => {
                    const nextEmail = e.target.value
                    setForm((f) => ({ ...f, email: nextEmail }))
                    setEmailVerificationRequested(false)
                    setEmailVerificationCode('')
                    setEmailVerified(false)
                  }}
                />
                <Button type="button" variant="outline" onClick={requestEmailVerification} disabled={isVerificationSending || !form.email.trim()}>
                  {isVerificationSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Send Code
                </Button>
              </div>
              <div className="text-xs text-gray-500">
                {emailVerified ? 'Gmail address verified.' : 'Send a code to the Gmail address, then enter it below.'}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="User Role" value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Confirm Password</label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                placeholder="Confirm Password"
              />
              {form.confirmPassword && form.password !== form.confirmPassword ? (
                <p className="text-sm text-red-600">Passwords do not match</p>
              ) : null}
            </div>
            {emailVerificationRequested && !emailVerified ? (
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Verification Code</label>
                <div className="flex gap-2">
                  <Input
                    value={emailVerificationCode}
                    onChange={(e) => setEmailVerificationCode(e.target.value)}
                    placeholder="Enter the code sent to the Gmail address"
                  />
                  <Button type="button" onClick={confirmEmailVerification} disabled={isVerificationConfirming || !emailVerificationCode.trim()}>
                    {isVerificationConfirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Confirm
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveUser('create')} disabled={isSubmitting || !emailVerified}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !open && setEditOpen(false)}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update account profile, role and status.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="User Role" value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Warehouse Status" value={form.isActive ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'ACTIVE' }))}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveUser('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CustomersView() {
  const [customers, setCustomers] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ratingFilter, setRatingFilter] = useState('all')

  const fetchCustomers = async () => {
    setIsLoading(true)
    try {
      const [customersResponse, ordersResponse, feedbackResponse] = await Promise.all([
        fetch('/api/customers?page=1&pageSize=500'),
        fetch('/api/orders?limit=1000&includeItems=none'),
        fetch('/api/feedback?page=1&pageSize=1000'),
      ])

      const customersData = customersResponse.ok ? await customersResponse.json().catch(() => ({})) : {}
      const ordersData = ordersResponse.ok ? await ordersResponse.json().catch(() => ({})) : {}
      const feedbackData = feedbackResponse.ok ? await feedbackResponse.json().catch(() => ({})) : {}

      setCustomers(toArray<any>(customersData?.data ?? customersData?.customers ?? customersData))
      setOrders(getCollection<any>(ordersData, ['orders']))
      setFeedback(getCollection<any>(feedbackData, ['feedbacks']))
    } catch (error) {
      console.error('Failed to fetch customers:', error)
      toast.error('Failed to load customers')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCustomers()
  }, [])

  const customerRows = useMemo(() => {
    const statsByCustomer = new Map<string, { orderCount: number; totalSpend: number; lastOrderNumber: string | null; lastOrderDate: string | null }>()
    const ratingByCustomer = new Map<string, { sum: number; count: number }>()

    for (const order of orders) {
      const customerId = String(order?.customerId || '')
      if (!customerId) continue
      const prev = statsByCustomer.get(customerId) || { orderCount: 0, totalSpend: 0, lastOrderNumber: null, lastOrderDate: null }
      const createdAt = order?.createdAt ? new Date(order.createdAt) : null
      const prevDate = prev.lastOrderDate ? new Date(prev.lastOrderDate) : null
      const isNewer = createdAt && !Number.isNaN(createdAt.getTime()) && (!prevDate || createdAt.getTime() > prevDate.getTime())

      statsByCustomer.set(customerId, {
        orderCount: prev.orderCount + 1,
        totalSpend: prev.totalSpend + Number(order?.totalAmount || 0),
        lastOrderNumber: isNewer ? (order?.orderNumber || prev.lastOrderNumber) : prev.lastOrderNumber,
        lastOrderDate: isNewer ? (order?.createdAt || prev.lastOrderDate) : prev.lastOrderDate,
      })
    }

    for (const item of feedback) {
      const customerId = String(item?.customerId || '')
      if (!customerId) continue
      const rating = Number(item?.rating || 0)
      if (!Number.isFinite(rating) || rating <= 0) continue
      const prev = ratingByCustomer.get(customerId) || { sum: 0, count: 0 }
      ratingByCustomer.set(customerId, { sum: prev.sum + rating, count: prev.count + 1 })
    }

    return customers.map((customer) => {
      const orderStats = statsByCustomer.get(customer.id) || { orderCount: 0, totalSpend: 0, lastOrderNumber: null, lastOrderDate: null }
      const feedbackStats = ratingByCustomer.get(customer.id) || { sum: 0, count: 0 }
      const rating = feedbackStats.count > 0 ? Number((feedbackStats.sum / feedbackStats.count).toFixed(1)) : 0
      return {
        ...customer,
        orderCount: orderStats.orderCount,
        totalSpend: orderStats.totalSpend,
        lastOrderNumber: orderStats.lastOrderNumber,
        lastOrderDate: orderStats.lastOrderDate,
        rating,
      }
    })
  }, [customers, orders, feedback])

  const filteredRows = useMemo(() => {
    return customerRows.filter((row) => {
      const matchesSearch = !search.trim()
        || row.name?.toLowerCase().includes(search.toLowerCase())
        || row.email?.toLowerCase().includes(search.toLowerCase())
        || String(row.phone || '').toLowerCase().includes(search.toLowerCase())

      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? row.isActive
            : !row.isActive

      const matchesRating =
        ratingFilter === 'all'
          ? true
          : row.rating >= Number(ratingFilter)

      return matchesSearch && matchesStatus && matchesRating
    })
  }, [customerRows, search, statusFilter, ratingFilter])

  const totalClients = customerRows.length
  const activeClients = customerRows.filter((row) => row.isActive).length
  const currentMonth = new Date().getMonth()
  const currentYear = new Date().getFullYear()
  const newClients = customerRows.filter((row) => {
    const date = row.createdAt ? new Date(row.createdAt) : null
    return date && !Number.isNaN(date.getTime()) && date.getMonth() === currentMonth && date.getFullYear() === currentYear
  }).length
  const avgSatisfaction = customerRows.length > 0
    ? Number((customerRows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / customerRows.length).toFixed(1))
    : 0

  const exportCsv = () => {
    const headers = ['Name', 'Email', 'Phone', 'Address', 'Status', 'Orders', 'TotalSpend', 'LastOrder', 'LastOrderDate', 'Rating']
    const lines = filteredRows.map((row) => [
      row.name || '',
      row.email || '',
      row.phone || '',
      [row.address, row.city, row.province, row.zipCode].filter(Boolean).join(', '),
      row.isActive ? 'Active' : 'Inactive',
      row.orderCount,
      row.totalSpend,
      row.lastOrderNumber || '',
      row.lastOrderDate ? new Date(row.lastOrderDate).toISOString() : '',
      row.rating,
    ])
    const csv = [headers, ...lines]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'registered-customers.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const renderStars = (rating: number) => {
    const rounded = Math.round(rating)
    return (
      <span className="text-amber-500">
        {'★'.repeat(Math.max(0, Math.min(5, rounded)))}
        <span className="text-gray-300">{'★'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, rounded))))}</span>
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registered Customers</h1>
        <p className="text-gray-500">Customer insights, activity, and profile information</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-blue-50 p-1.5"><Users className="h-3.5 w-3.5 text-blue-600" /></div>
              <div>
                <p className="text-xs text-gray-500">Total Clients</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{totalClients}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-emerald-50 p-1.5"><CheckCircle className="h-3.5 w-3.5 text-emerald-600" /></div>
              <div>
                <p className="text-xs text-gray-500">Active Clients</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{activeClients}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-violet-50 p-1.5"><TrendingUp className="h-3.5 w-3.5 text-violet-600" /></div>
              <div>
                <p className="text-xs text-gray-500">New Clients</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{newClients}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-amber-50 p-1.5"><Star className="h-3.5 w-3.5 text-amber-600" /></div>
              <div>
                <p className="text-xs text-gray-500">Avg Satisfaction</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{avgSatisfaction}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              placeholder="Search by client name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="lg:flex-1"
            />
            <select
              title="Customer status filter"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              title="Customer rating filter"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">All Ratings</option>
              <option value="5">5.0</option>
              <option value="4">4.0+</option>
              <option value="3">3.0+</option>
            </select>
            <Button className="gap-2" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-52">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No registered customers found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Client</th>
                    <th className="text-left p-4 font-medium text-gray-600">Contact</th>
                    <th className="text-left p-4 font-medium text-gray-600">Location</th>
                    <th className="text-left p-4 font-medium text-gray-600">Orders (Total)</th>
                    <th className="text-left p-4 font-medium text-gray-600">Last Order</th>
                    <th className="text-left p-4 font-medium text-gray-600">Satisfaction</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <p className="font-semibold text-gray-900">{row.name || 'N/A'}</p>
                        <p className="text-sm text-gray-500">Retail Customer</p>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-gray-700">{row.email || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{row.phone || 'No phone'}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-xs text-gray-500">
                          {typeof row.latitude === 'number' && typeof row.longitude === 'number'
                            ? `${Number(row.latitude).toFixed(6)} ${Number(row.longitude).toFixed(6)}`
                            : 'No coordinates'}
                        </p>
                        <p className="text-sm text-gray-700">
                          {[row.city, row.province].filter(Boolean).join(', ') || 'No city/province'}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold text-gray-900">{row.orderCount}</p>
                        <p className="text-sm text-gray-500">{formatPeso(row.totalSpend || 0)}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-sm font-medium text-gray-900">{row.lastOrderNumber || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{row.lastOrderDate ? new Date(row.lastOrderDate).toLocaleDateString() : 'N/A'}</p>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1 text-sm">
                          {renderStars(row.rating || 0)}
                          <span className="font-semibold text-emerald-600">{Number(row.rating || 0).toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge className={row.isActive ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-100'}>
                          {row.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SettingsView() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

  const userId = (user as any)?.userId || (user as any)?.id

  const handleProfileSave = async () => {
    if (!userId) {
      toast.error('Unable to resolve user ID')
      return
    }

    setIsSavingProfile(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to save profile')
      }
      toast.success('Profile updated successfully')
    } catch (error) {
      console.error('Profile update failed:', error)
      toast.error('Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handlePasswordUpdate = async () => {
    if (!userId) {
      toast.error('Unable to resolve user ID')
      return
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Fill all password fields')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match')
      return
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to update password')
      }
      toast.success('Password updated successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error('Password update failed:', error)
      toast.error('Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name</label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button onClick={handleProfileSave} disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Change your password</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="current-password" className="text-sm font-medium text-gray-700">Current Password</label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="new-password" className="text-sm font-medium text-gray-700">New Password</label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">Confirm Password</label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button onClick={handlePasswordUpdate} disabled={isUpdatingPassword}>
                {isUpdatingPassword ? 'Updating...' : 'Update Password'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Role</p>
                  <p className="font-medium">{formatRoleLabel(user?.role)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Account Type</p>
                  <p className="font-medium capitalize">{user?.type}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">User ID</p>
                  <p className="font-medium font-mono text-sm">{user?.id}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Email Notifications</span>
                  <span className="text-xs text-gray-500">Configured by system admin</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Two-Factor Auth</span>
                  <span className="text-xs text-gray-500">Not enabled</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
