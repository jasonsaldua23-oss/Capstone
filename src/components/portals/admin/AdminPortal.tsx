
"use client";


import React, { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { useAuth } from '@/app/page';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, FileText, Users, Star, Download, Pencil, Trash2, ClipboardList, Recycle, Store } from 'lucide-react';
import { WarehouseEmptyBottlesView } from '../warehouse/sections/inventory/empty-bottles-view';
import { RetailTransactionsView } from './sections/retail-transactions-view';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts';
import type { DashboardStats } from '@/types';
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync';
import { clearTabAuthToken, getTabAuthToken } from '@/lib/client-auth'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'
import { portalFont } from '../portal-font'
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
import { InventoryTransactionsView } from './sections/inventory-transactions-view'

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
  { value: 'pack', label: 'pack' },
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
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
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
      const nonRetriable =
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 405 ||
        response.status === 409 ||
        response.status === 410 ||
        response.status === 422
      if (nonRetriable) {
        return { ok: false as const, data, status: response.status, error: lastError }
      }
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
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState<Array<{ view: string; label: string; sublabel: string }>>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inventorySubView, setInventorySubView] = useState<'inventory' | 'stocks' | 'empties'>('inventory')
  const [inventoryMenuExpanded, setInventoryMenuExpanded] = useState(true)
  const [ordersMenuExpanded, setOrdersMenuExpanded] = useState(true)
  const [adminOrders, setAdminOrders] = useState<any[]>([])
  const [adminOrdersLoading, setAdminOrdersLoading] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [initialNotificationsLoaded, setInitialNotificationsLoaded] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [warehouseReady, setWarehouseReady] = useState<boolean | null>(null)

  const fetchAdminOrders = useCallback(async () => {
    setAdminOrdersLoading(true)
    try {
      const res = await fetch('/api/orders?pageSize=500&includeItems=full', { cache: 'no-store' })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) {
        setAdminOrders(getCollection<any>(payload, ['orders']))
      }
    } catch {
      // ignore
    } finally {
      setAdminOrdersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (inventorySubView === 'empties' && adminOrders.length === 0) {
      void fetchAdminOrders()
    }
  }, [inventorySubView, adminOrders.length, fetchAdminOrders])

  useEffect(() => {
    let cancelled = false
    const checkWarehouseSetup = async () => {
      try {
        const result = await safeFetchJson(
          '/api/warehouses?page=1&pageSize=2',
          { cache: 'no-store', credentials: 'include' },
          { retries: 3, timeoutMs: 15000 }
        )
        if (!cancelled) {
          const ready = result.ok && getCollection<any>(result.data, ['warehouses']).length === 1
          setWarehouseReady(ready)
          if (!ready) setActiveView('warehouses')
        }
      } catch {
        if (!cancelled) {
          setWarehouseReady(false)
          setActiveView('warehouses')
        }
      }
    }
    void checkWarehouseSetup()
    return () => {
      cancelled = true
    }
  }, [])

  const isPriorityNotification = (item: PortalNotification) => {
    const title = String(item?.title || '').toLowerCase()
    const message = String(item?.message || '').toLowerCase()
    const refType = String(item?.type || '').toLowerCase()
    const text = `${title} ${message} ${refType}`
    const isOrderOps =
      text.includes('new order') ||
      text.includes('order created') ||
      text.includes('placed order') ||
      text.includes('order status updated') ||
      text.includes('warehouse stage updated') ||
      refType === 'order'
    const isTripOps =
      text.includes('trip created') ||
      text.includes('trip started') ||
      text.includes('started trip') ||
      text.includes('trip in progress') ||
      text.includes('active trip') ||
      refType === 'trip'
    const isInventory =
      text.includes('inventory') ||
      text.includes('stock') ||
      text.includes('restock') ||
      text.includes('low stock') ||
      refType === 'inventory' ||
      refType === 'stock_batch'
    return isOrderOps || isTripOps || isInventory
  }

  const filteredNotifications = useMemo(
    () => notifications.filter(isPriorityNotification),
    [notifications]
  )
  const unreadFilteredNotifications = useMemo(
    () => filteredNotifications.filter((item) => !item.isRead).length,
    [filteredNotifications]
  )

  const runGlobalKeywordSearch = async () => {
    const keyword = globalSearchQuery.trim().toLowerCase()
    if (!keyword) return
    setGlobalSearchLoading(true)
    setGlobalSearchOpen(true)
    try {
      const endpoints = [
        '/api/orders?page=1&pageSize=200&includeItems=preview',
        '/api/customers?page=1&pageSize=200',
        '/api/trips?page=1&pageSize=200',
        '/api/warehouses?page=1&pageSize=200',
        '/api/inventory?page=1&pageSize=200',
        '/api/products?page=1&pageSize=200',
        '/api/drivers?page=1&pageSize=200',
        '/api/vehicles?page=1&pageSize=200',
        '/api/replacements?page=1&pageSize=200',
        '/api/feedback?page=1&pageSize=200',
        '/api/users?page=1&pageSize=200',
      ]
      const responses = await Promise.all(endpoints.map((url) => safeFetchJson(url, { cache: 'no-store' }, { retries: 2, timeoutMs: 12000 })))
      const [
        ordersRes,
        customersRes,
        tripsRes,
        warehousesRes,
        inventoryRes,
        productsRes,
        driversRes,
        vehiclesRes,
        replacementsRes,
        feedbackRes,
        usersRes,
      ] = responses

      const include = (parts: unknown[]) => parts.map((part) => String(part || '').toLowerCase()).join(' ').includes(keyword)
      const nextResults: Array<{ view: string; label: string; sublabel: string }> = []

      if (ordersRes.ok) {
        const rows = getCollection<any>(ordersRes.data, ['orders'])
        rows.forEach((row) => {
          if (!include([row?.orderNumber, row?.customer?.name, row?.customer?.email, row?.shippingName, row?.shippingCity, row?.status])) return
          nextResults.push({
            view: 'orders',
            label: `Order ${String(row?.orderNumber || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.customer?.name || row?.shippingName || 'N/A')} | ${String(row?.status || 'N/A')}`,
          })
        })
      }

      if (customersRes.ok) {
        const rows = getCollection<any>(customersRes.data, ['customers'])
        rows.forEach((row) => {
          if (!include([row?.name, row?.email, row?.phone, row?.city, row?.province])) return
          nextResults.push({
            view: 'customers',
            label: `Client ${String(row?.name || row?.email || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.email || 'N/A')} | ${String(row?.city || '')} ${String(row?.province || '')}`.trim(),
          })
        })
      }

      if (tripsRes.ok) {
        const rows = getCollection<any>(tripsRes.data, ['trips'])
        rows.forEach((row) => {
          if (!include([row?.tripNumber, row?.driver?.name, row?.status, row?.warehouse?.name])) return
          nextResults.push({
            view: 'trips',
            label: `Trip ${String(row?.tripNumber || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.driver?.name || 'No driver')} | ${String(row?.status || 'N/A')}`,
          })
        })
      }

      if (warehousesRes.ok) {
        const rows = getCollection<any>(warehousesRes.data, ['warehouses'])
        rows.forEach((row) => {
          if (!include([row?.name, row?.code, row?.city, row?.province])) return
          nextResults.push({
            view: 'warehouses',
            label: `Warehouse ${String(row?.name || row?.code || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.code || 'N/A')} | ${String(row?.city || '')} ${String(row?.province || '')}`.trim(),
          })
        })
      }

      if (inventoryRes.ok) {
        const rows = getCollection<any>(inventoryRes.data, ['inventory'])
        rows.forEach((row) => {
          if (!include([row?.productName, row?.sku, row?.warehouse?.name, row?.status])) return
          nextResults.push({
            view: 'inventory',
            label: `Inventory ${String(row?.productName || row?.sku || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.sku || 'N/A')} | ${String(row?.status || 'N/A')}`,
          })
        })
      }

      if (productsRes.ok) {
        const rows = getCollection<any>(productsRes.data, ['products'])
        rows.forEach((row) => {
          if (!include([row?.name, row?.sku, row?.category, row?.description])) return
          nextResults.push({
            view: 'inventory',
            label: `Product ${String(row?.name || row?.sku || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.sku || 'N/A')} | ${String(row?.category || 'N/A')}`,
          })
        })
      }

      if (driversRes.ok) {
        const rows = getCollection<any>(driversRes.data, ['drivers'])
        rows.forEach((row) => {
          if (!include([row?.name, row?.email, row?.phone, row?.licenseNumber])) return
          nextResults.push({
            view: 'transportation',
            label: `Driver ${String(row?.name || row?.email || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.email || 'N/A')} | ${String(row?.licenseNumber || 'No license')}`,
          })
        })
      }

      if (vehiclesRes.ok) {
        const rows = getCollection<any>(vehiclesRes.data, ['vehicles'])
        rows.forEach((row) => {
          if (!include([row?.plateNumber, row?.model, row?.type, row?.status])) return
          nextResults.push({
            view: 'transportation',
            label: `Vehicle ${String(row?.plateNumber || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.model || 'N/A')} | ${String(row?.status || 'N/A')}`,
          })
        })
      }

      if (replacementsRes.ok) {
        const rows = getCollection<any>(replacementsRes.data, ['replacements'])
        rows.forEach((row) => {
          if (!include([row?.replacementNumber, row?.orderNumber, row?.status, row?.customerName])) return
          nextResults.push({
            view: 'replacements',
            label: `Replacement ${String(row?.replacementNumber || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.orderNumber || 'N/A')} | ${String(row?.status || 'N/A')}`,
          })
        })
      }

      if (feedbackRes.ok) {
        const rows = getCollection<any>(feedbackRes.data, ['feedbacks'])
        rows.forEach((row) => {
          if (!include([row?.subject, row?.message, row?.customer?.name, row?.rating])) return
          nextResults.push({
            view: 'feedback',
            label: `Feedback ${String(row?.subject || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.customer?.name || 'N/A')} | Rating ${String(row?.rating || 'N/A')}`,
          })
        })
      }

      if (usersRes.ok) {
        const rows = getCollection<any>(usersRes.data, ['users'])
        rows.forEach((row) => {
          if (!include([row?.name, row?.email, row?.role, row?.phone])) return
          nextResults.push({
            view: 'users',
            label: `User ${String(row?.name || row?.email || row?.id || '').trim() || 'N/A'}`,
            sublabel: `${String(row?.role || 'N/A')} | ${String(row?.email || 'N/A')}`,
          })
        })
      }

      setGlobalSearchResults(nextResults.slice(0, 120))
    } catch {
      setGlobalSearchResults([])
      toast.error('Global search failed')
    } finally {
      setGlobalSearchLoading(false)
    }
  }

  useEffect(() => {
    async function fetchDashboardStats() {
      try {
        const result = await safeFetchJson('/api/dashboard/stats', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 })
        if (result.ok) {
          const data = result.data
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
      const result = await safeFetchJson('/api/notifications', { cache: 'no-store' })
      if (!result.ok) return

      const payload = result.data as any
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
      const result = await safeFetchJson('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      })
      if (!result.ok) return
      setUnreadNotifications(0)
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })))
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }

  const clearAllNotifications = async () => {
    try {
      const result = await safeFetchJson('/api/notifications', {
        method: 'DELETE',
      })
      if (!result.ok) return
      setUnreadNotifications(0)
      setNotifications([])
    } catch (error) {
      console.error('Failed to clear notifications:', error)
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
    // Keep the portal initialization screen active until notification data settles.
    void fetchNotifications({ silent: true }).finally(() => setInitialNotificationsLoaded(true))
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeDataSync((message) => {
      const shouldRefreshNotifications = message.scopes.some((scope) =>
        ['inventory', 'products', 'stock-batches', 'orders', 'trips', 'replacements', 'warehouses'].includes(scope)
      )
      if (shouldRefreshNotifications) {
        void fetchNotifications({ silent: true })
      }
    })

    return () => unsubscribe()
  }, [])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
  }

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const openLogoutConfirm = () => setLogoutConfirmOpen(true)

  const SidebarContent = () => {
    const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
      { id: 'purchaseRequests', label: 'Purchase Requests', icon: ClipboardList },
      { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart },
      { id: 'transportation', label: 'Transportation', icon: Truck },
      { id: 'replacements', label: 'Replacements', icon: AlertTriangle },
      { id: 'tracking', label: 'Live Tracking', icon: MapPin },
      { id: 'inventory', label: 'Inventory', icon: Archive },
      { id: 'warehouses', label: 'Warehouse', icon: Building2 },
      { id: 'feedback', label: 'Feedback', icon: MessageSquare },
      { id: 'reports', label: 'Reports', icon: FileText },
      { id: 'customers', label: 'Clients', icon: Users },
      { id: 'users', label: 'Users', icon: Users },
      { id: 'settings', label: 'Settings', icon: Settings },
    ]
    const primaryNavItems = navItems.filter((item) =>
      item.id !== 'settings' && (warehouseReady !== false || item.id === 'warehouses')
    )
    const settingsItem = warehouseReady === false ? undefined : navItems.find((item) => item.id === 'settings')

    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-white/20 bg-white/10 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <img
              src="/ann-anns-logo.png"
              alt="Ann Ann's Beverages Trading logo"
              className="h-16 w-16 rounded-xl border border-white/40 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
            />
            <div>
              <h2 className="font-bold text-slate-950">Ann Ann's Beverages Trading</h2>
              <p className="text-xs text-slate-600">Admin Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {primaryNavItems.map((item) => {
            const IconComponent = item.icon
            const isActive = activeView === item.id
            return (
              <motion.div key={item.id} layout transition={{ type: 'spring', stiffness: 440, damping: 32 }}>
                <Button
                  variant="ghost"
                  className={`relative w-full justify-start gap-3 overflow-hidden transition-all duration-300 ${isActive
                      ? 'text-white'
                      : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
                    }`}
                  onClick={() => {
                    if (item.id === 'inventory') {
                      if (activeView === 'inventory') {
                        setInventoryMenuExpanded((prev) => !prev)
                      } else {
                        setActiveView('inventory')
                        setInventoryMenuExpanded(true)
                      }
                    } else if (item.id === 'orders') {
                      if (activeView === 'orders') {
                        setOrdersMenuExpanded((prev) => !prev)
                      } else {
                        setActiveView('orders')
                        setOrdersMenuExpanded(true)
                      }
                    } else {
                      setActiveView(item.id)
                    }
                    setSidebarOpen(false)
                  }}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="admin-sidebar-active-pill"
                      className="absolute inset-0 rounded-md border border-white/50 bg-linear-to-r from-sky-600/95 via-blue-600/95 to-cyan-500/95 shadow-[0_14px_30px_rgba(37,99,235,0.28)]"
                      transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                    />
                  ) : null}
                  <IconComponent className="relative z-[1] h-4 w-4" />
                  <span className="relative z-[1]">{item.label}</span>
                  {item.id === 'inventory' ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={inventoryMenuExpanded ? 'Retract Inventory Menu' : 'Expand Inventory Menu'}
                      className="relative z-[1] ml-auto p-1 rounded hover:bg-white/20 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setInventoryMenuExpanded((prev) => !prev)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setInventoryMenuExpanded((prev) => !prev)
                        }
                      }}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${inventoryMenuExpanded ? 'rotate-180' : 'rotate-0'}`}
                        aria-hidden="true"
                      />
                    </span>
                  ) : null}
                  {item.id === 'orders' ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={ordersMenuExpanded ? 'Retract Purchase Orders Menu' : 'Expand Purchase Orders Menu'}
                      className="relative z-[1] ml-auto p-1 rounded hover:bg-white/20 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOrdersMenuExpanded((prev) => !prev)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setOrdersMenuExpanded((prev) => !prev)
                        }
                      }}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${ordersMenuExpanded ? 'rotate-180' : 'rotate-0'}`}
                        aria-hidden="true"
                      />
                    </span>
                  ) : null}
                </Button>
                <AnimatePresence initial={false}>
                  {item.id === 'inventory' && inventoryMenuExpanded ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <Button
                        variant="ghost"
                        className={`relative ml-4 mt-1 w-[calc(100%-1rem)] justify-start gap-3 overflow-hidden pl-9 transition-all duration-300 ${activeView === 'inventoryTransactions'
                            ? 'text-white'
                            : 'text-slate-600 hover:bg-white/45 hover:text-slate-950'
                          }`}
                        onClick={() => {
                          setActiveView('inventoryTransactions')
                          setSidebarOpen(false)
                        }}
                      >
                        {activeView === 'inventoryTransactions' ? (
                          <motion.span
                            layoutId="admin-sidebar-active-pill"
                            className="absolute inset-0 rounded-md border border-white/50 bg-linear-to-r from-sky-600/95 via-blue-600/95 to-cyan-500/95 shadow-[0_14px_30px_rgba(37,99,235,0.28)]"
                            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                          />
                        ) : null}
                        <ClipboardList className="relative z-[1] h-4 w-4" />
                        <span className="relative z-[1]">Inventory Transactions</span>
                      </Button>
                    </motion.div>
                  ) : null}
                  {item.id === 'orders' && ordersMenuExpanded ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <Button
                        variant="ghost"
                        className={`relative ml-4 mt-1 w-[calc(100%-1rem)] justify-start gap-3 overflow-hidden pl-9 transition-all duration-300 ${activeView === 'retailTransactions'
                            ? 'text-white'
                            : 'text-slate-600 hover:bg-white/45 hover:text-slate-950'
                          }`}
                        onClick={() => {
                          setActiveView('retailTransactions')
                          setSidebarOpen(false)
                        }}
                      >
                        {activeView === 'retailTransactions' ? (
                          <motion.span
                            layoutId="admin-sidebar-active-pill"
                            className="absolute inset-0 rounded-md border border-white/50 bg-linear-to-r from-sky-600/95 via-blue-600/95 to-cyan-500/95 shadow-[0_14px_30px_rgba(37,99,235,0.28)]"
                            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                          />
                        ) : null}
                        <Store className="relative z-[1] h-4 w-4" />
                        <span className="relative z-[1]">Retail Transactions</span>
                      </Button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </nav>

        <div className="space-y-2 border-t p-4">
          {settingsItem ? (
            <Button
              variant="ghost"
              className={`relative w-full justify-start gap-3 overflow-hidden transition-all duration-300 ${activeView === settingsItem.id
                  ? 'text-white'
                  : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
                }`}
              onClick={() => {
                setActiveView(settingsItem.id)
                setSidebarOpen(false)
              }}
            >
              {activeView === settingsItem.id ? (
                <motion.span
                  layoutId="admin-sidebar-active-pill"
                  className="absolute inset-0 rounded-md border border-white/50 bg-linear-to-r from-sky-600/95 via-blue-600/95 to-cyan-500/95 shadow-[0_14px_30px_rgba(37,99,235,0.28)]"
                  transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                />
              ) : null}
              <settingsItem.icon className="relative z-[1] h-4 w-4" />
              <span className="relative z-[1]">{settingsItem.label}</span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-slate-700 hover:bg-white/45 hover:text-red-600"
            onClick={openLogoutConfirm}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    )
  }

  const renderActiveView = () => {
    if (warehouseReady === null) {
      return <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking warehouse setup...</div>
    }
    if (warehouseReady === false) {
      return <WarehousesView onWarehouseChanged={setWarehouseReady} />
    }
    switch (activeView) {
      case 'dashboard':
        return <DashboardView stats={stats} isLoading={isLoading} />
      case 'orders':
        return <OrdersView mode="orders" onOpenTransportation={() => setActiveView('transportation')} globalSearchQuery={globalSearchQuery} />
      case 'retailTransactions':
        return <RetailTransactionsView />
      case 'purchaseRequests':
        return <OrdersView mode="requests" onOpenTransportation={() => setActiveView('transportation')} globalSearchQuery={globalSearchQuery} />
      case 'trips':
        return <TripsView />
      case 'transportation':
        return <TransportationView />
      case 'warehouses':
        return <WarehousesView onWarehouseChanged={setWarehouseReady} />
      case 'inventoryTransactions':
        return <InventoryTransactionsView userRole={user?.role} />
      case 'inventory':
        return (
          <Tabs value={inventorySubView} onValueChange={(value) => setInventorySubView(value as 'inventory' | 'stocks' | 'empties')} className="space-y-4">
            <TabsList className="h-auto w-full flex-nowrap gap-2 overflow-x-auto rounded-2xl border border-white/40 bg-white/65 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl">
              <TabsTrigger
                value="inventory"
                className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
              >
                <Package className="h-4 w-4" />
                Inventory
              </TabsTrigger>
              <TabsTrigger
                value="stocks"
                className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
              >
                <Archive className="h-4 w-4" />
                Stock batches
              </TabsTrigger>
              <TabsTrigger
                value="empties"
                className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
              >
                <Recycle className="h-4 w-4" />
                Empty Bottles
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inventory" className="mt-0">
              <InventoryView />
            </TabsContent>
            <TabsContent value="stocks" className="mt-0">
              <StocksView />
            </TabsContent>
            <TabsContent value="empties" className="mt-0">
              <WarehouseEmptyBottlesView
                orders={adminOrders}
                formatPeso={(val) =>
                  new Intl.NumberFormat('en-PH', {
                    style: 'currency',
                    currency: 'PHP',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(val || 0)
                }
                loadingOrders={adminOrdersLoading}
              />
            </TabsContent>
          </Tabs>
        )
      case 'replacements':
        return <ReplacementsView />
      case 'tracking':
        return <TrackingView />
      case 'feedback':
        return <FeedbackView />
      case 'reports':
        return <ReportsView />
      case 'customers':
        return <CustomersView globalSearchQuery={globalSearchQuery} />
      case 'users':
        return <UsersView />
      case 'settings':
        return <SettingsView />
      default:
        return <DashboardView stats={stats} isLoading={isLoading} />
    }
  }

  // Do not reveal partially initialized admin content after authentication completes.
  const isPortalInitializing = isLoading || warehouseReady === null || !initialNotificationsLoaded
  if (isPortalInitializing) {
    return (
      <div className={`${portalFont.className} flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-cyan-50 to-emerald-50`}>
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-600" />
          <p className="font-medium text-slate-700">Loading admin information...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${portalFont.className} relative flex min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.34),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(129,140,248,0.22),_transparent_32%),linear-gradient(145deg,_#e8f4ff_0%,_#eefbf4_52%,_#f6fbff_100%)]`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 top-8 h-64 w-64 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="absolute right-[-4rem] top-24 h-72 w-72 rounded-full bg-cyan-200/20 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-1/3 h-72 w-72 rounded-full bg-emerald-200/20 blur-3xl" />
      </div>
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-[20] hidden w-64 flex-col border-r border-white/25 bg-white/38 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-2xl lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 border-white/30 bg-white/44 p-0 shadow-[0_24px_60px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      {/* Fix: match the Warehouse Portal's display scale while containing wide admin tables. */}
      <div className="relative z-[1] flex min-h-screen min-w-0 flex-1 flex-col lg:pl-64">
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
                  placeholder="Search all by keyword..."
                  value={globalSearchQuery}
                  onChange={(event) => setGlobalSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    void runGlobalKeywordSearch()
                  }}
                  className="w-64 border-white/40 bg-white/50 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DropdownMenu onOpenChange={(open) => { void handleNotificationsOpen(open) }}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative text-slate-700 hover:bg-white/45 hover:text-slate-950">
                    <Bell className="h-5 w-5" />
                    {unreadFilteredNotifications > 0 && <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[min(26rem,calc(100vw-1rem))] p-0">
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="text-sm font-medium">Notifications</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                      onClick={() => { void clearAllNotifications() }}
                      disabled={notificationsLoading || filteredNotifications.length === 0}
                    >
                      Clear All
                    </Button>
                  </div>
                  <DropdownMenuSeparator />
                  <div className="max-h-[26rem] overflow-y-auto">
                    {notificationsLoading ? (
                      <div className="px-3 py-3 text-sm text-gray-500">Loading notifications...</div>
                    ) : filteredNotifications.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-gray-500">No notifications yet.</div>
                    ) : (
                      filteredNotifications.map((item) => (
                        <div key={item.id} className="px-3 py-2 border-b last:border-b-0">
                          <p className="text-sm font-medium text-gray-900">{item.title}</p>
                          <p className="text-xs text-gray-600">{item.message}</p>
                          <p className="text-[11px] text-gray-500 mt-1">{formatNotificationTime(item.createdAt)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 text-slate-700 hover:bg-white/45 hover:text-slate-950">
                    <Avatar className="h-8 w-8">
                      {user?.avatar ? <AvatarImage src={String(user.avatar)} alt={`${user?.name || 'User'} avatar`} className="object-cover" /> : null}
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
                  <DropdownMenuItem onClick={openLogoutConfirm} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="w-full"
            >
              {renderActiveView()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Dialog open={globalSearchOpen} onOpenChange={setGlobalSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Global Search</DialogTitle>
            <DialogDescription>
              Keyword: {globalSearchQuery.trim() || 'N/A'}
            </DialogDescription>
          </DialogHeader>
          {globalSearchLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching across all sections...
            </div>
          ) : globalSearchResults.length === 0 ? (
            <p className="py-2 text-sm text-gray-500">No matches found.</p>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {globalSearchResults.map((item, index) => (
                <button
                  key={`${item.view}-${item.label}-${index}`}
                  type="button"
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:bg-gray-50"
                  onClick={() => {
                    setActiveView(item.view)
                    setGlobalSearchOpen(false)
                  }}
                >
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.sublabel}</p>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out of the Admin Portal?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleLogout()}
              className="bg-red-600 hover:bg-red-700"
            >
              Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Dashboard View Component

// Placeholder views for other sections
