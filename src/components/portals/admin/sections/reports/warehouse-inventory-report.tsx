'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Package,
  Boxes,
  Building2,
  DollarSign,
  Search,
  ArrowUpDown,
  Calendar,
  AlertTriangle,
  Clock,
  Download,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Zap,
  Activity,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ComposedChart,
  Area,
  Line,
} from 'recharts'
import { formatPeso, formatDateTime, formatDayKey, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface WarehouseInventoryReportProps {
  inventory: any[]
  inventoryTransactions?: any[]
  orders?: any[]
  retailSales?: any[]
  warehouses?: any[]
  stockBatches?: any[]
}

type PeriodPreset = '7' | '30' | '90' | '365' | 'all' | 'custom'

function getItemSize(item: any): string {
  if (Array.isArray(item?.sizes) && item.sizes.length > 0) {
    return item.sizes.map((s: any) => String(s || '').trim()).filter(Boolean).join(' ')
  }
  if (Array.isArray(item?.product?.sizes) && item.product.sizes.length > 0) {
    return item.product.sizes.map((s: any) => String(s || '').trim()).filter(Boolean).join(' ')
  }
  const explicit = String(item?.sizeLabel || item?.productSize || item?.product?.sizeLabel || item?.product?.size || '').trim()
  if (explicit) return explicit
  const unit = String(item?.product?.unit || item?.productUnit || '').trim()
  return /\d\s*(ml|l|liter|litre|oz|cl|g|kg)\b/i.test(unit) ? unit : ''
}

function getProductUnitLabel(item: any, categoryName?: string): string {
  const explicitUnit = String(
    item?.unitLabel ||
    item?.unit ||
    item?.product?.unit ||
    item?.productUnit ||
    item?.packagingType ||
    item?.product?.packagingType ||
    item?.packaging ||
    ''
  ).trim().toLowerCase()

  if (explicitUnit.includes('case')) return 'cases'
  if (explicitUnit.includes('pack')) return 'packs'
  if (explicitUnit.includes('can')) return 'cans'
  if (explicitUnit.includes('glass')) return 'glass bottles'
  if (explicitUnit.includes('plastic') || explicitUnit.includes('pet')) return 'plastic bottles'
  if (explicitUnit.includes('bottle')) return 'bottles'

  const catStr = String(categoryName || item?.category || item?.product?.category?.name || item?.product?.category || '').toLowerCase()
  if (catStr.includes('glass')) return 'glass bottles'
  if (catStr.includes('can')) return 'cans'
  if (catStr.includes('plastic') || catStr.includes('pet')) return 'plastic bottles'
  if (catStr.includes('pack')) return 'packs'
  if (catStr.includes('water')) return 'plastic bottles'
  if (catStr.includes('alcohol') || catStr.includes('beer')) return 'glass bottles'

  return 'cases'
}

function getLooseUnitLabel(item: any, categoryName?: string): string {
  const explicitUnit = String(
    item?.unitLabel ||
    item?.unit ||
    item?.packagingType ||
    item?.product?.packagingType ||
    item?.packaging ||
    ''
  ).toLowerCase()

  if (explicitUnit.includes('glass')) return 'glass bottles'
  if (explicitUnit.includes('can')) return 'cans'
  if (explicitUnit.includes('plastic') || explicitUnit.includes('pet')) return 'plastic bottles'
  if (explicitUnit.includes('bottle')) return 'bottles'

  const catStr = String(categoryName || item?.category || item?.product?.category?.name || item?.product?.category || '').toLowerCase()
  if (catStr.includes('glass')) return 'glass bottles'
  if (catStr.includes('can')) return 'cans'
  if (catStr.includes('plastic') || catStr.includes('pet') || catStr.includes('water') || catStr.includes('sport')) return 'plastic bottles'
  if (catStr.includes('alcohol') || catStr.includes('beer')) return 'glass bottles'

  return 'glass bottles'
}

function formatProductNameWithSize(name: string, size?: string): string {
  const cleanName = String(name || 'Product').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  const cleanSize = String(size || '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  return cleanSize && !cleanName.toLowerCase().includes(cleanSize.toLowerCase())
    ? `${cleanName} ${cleanSize}`
    : cleanName
}

export function WarehouseInventoryReport({
  inventory,
  inventoryTransactions = [],
  orders = [],
  retailSales = [],
  stockBatches = [],
}: WarehouseInventoryReportProps) {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<'velocity' | 'units' | 'revenue' | 'stock'>('velocity')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 12

  // Number of days in the active period for daily velocity calculation
  const periodDays = useMemo(() => {
    if (periodPreset === '7') return 7
    if (periodPreset === '30') return 30
    if (periodPreset === '90') return 90
    if (periodPreset === '365') return 365
    if (periodPreset === 'custom' && dateFrom && dateTo) {
      const start = new Date(dateFrom).getTime()
      const end = new Date(dateTo).getTime()
      const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24))
      return Math.max(1, diff)
    }
    return 30
  }, [periodPreset, dateFrom, dateTo])

  // Date filtering helper
  const isDateInPeriod = useMemo(() => {
    return (dateStr: string) => {
      if (!dateStr) return false
      const itemTime = new Date(dateStr).getTime()
      if (periodPreset === 'all') return true
      if (periodPreset === 'custom') {
        if (dateFrom && itemTime < new Date(`${dateFrom}T00:00:00`).getTime()) return false
        if (dateTo && itemTime > new Date(`${dateTo}T23:59:59.999`).getTime()) return false
        return true
      }
      const days = Number(periodPreset)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      cutoff.setHours(0, 0, 0, 0)
      return itemTime >= cutoff.getTime()
    }
  }, [periodPreset, dateFrom, dateTo])

  // Aggregate current inventory by product & warehouse
  const inventoryStockMap = useMemo(() => {
    const map = new Map<
      string,
      {
        currentStock: number
        reservedStock: number
        threshold: number
        sku: string
        category: string
        price: number
        imageUrl: string
        size: string
        unitLabel: string
      }
    >()
    inventory.forEach((inv) => {
      const prod = inv.product || {}
      const prodId = String(inv.productId || prod.id || '').trim()
      const pName = String(prod.name || inv.productName || '').trim()
      const key = prodId || pName.toLowerCase()
      if (!key) return

      const available = Math.max(0, Number(inv.quantityAvailable ?? inv.quantity ?? inv.available ?? 0))
      const reserved = Math.max(0, Number(inv.reservedQuantity ?? inv.reserved ?? 0))
      const threshold = Math.max(0, Number(inv.minStock ?? inv.threshold ?? 10))
      const sku = String(prod.sku || inv.sku || 'N/A').trim()
      const category = String(prod.category?.name || prod.category || inv.category || 'General Beverage').trim()
      const price = Number(prod.price ?? inv.price ?? 0)
      const imageUrl = String(prod.imageUrl || inv.imageUrl || '').trim()
      const size = getItemSize(inv)
      const unitLabel = getProductUnitLabel(inv, category)

      const existing = map.get(key)
      if (existing) {
        existing.currentStock += available
        existing.reservedStock += reserved
      } else {
        map.set(key, {
          currentStock: available,
          reservedStock: reserved,
          threshold,
          sku,
          category,
          price,
          imageUrl,
          size,
          unitLabel,
        })
      }
    })
    return map
  }, [inventory])

  // Extract all distinct categories for filter dropdown
  const distinctCategories = useMemo(() => {
    const set = new Set<string>()
    inventory.forEach((inv) => {
      const cat = String(inv.product?.category?.name || inv.product?.category || inv.category || '').trim()
      if (cat) set.add(cat)
    })
    return Array.from(set)
  }, [inventory])

  // Consolidate dispatches/sales across Orders, Retail Sales, and Inventory Transactions
  const productMovements = useMemo(() => {
    const map = new Map<
      string,
      {
        productId: string
        productName: string
        rawName: string
        size: string
        sku: string
        category: string
        imageUrl: string
        unitPrice: number
        totalUnitsSold: number
        totalComparableUnits: number
        totalRevenue: number
        orderCount: number
        warehouseId: string
        warehouseName: string
        unitLabel: string
        unitsMap: Map<string, number>
      }
    >()

    const registerMovement = (
      pId: string,
      pName: string,
      pSize: string,
      pSku: string,
      pCat: string,
      pImg: string,
      pPrice: number,
      qty: number,
      revenue: number,
      wId: string,
      wName: string,
      uLabel?: string,
      comparableQty: number = qty
    ) => {
      const rawName = String(pName || 'Product').trim()
      const key = (pId || rawName).toLowerCase().trim()
      if (!key) return

      const formattedName = formatProductNameWithSize(rawName, pSize)
      const unit = uLabel || 'cases'
      const existing = map.get(key)
      if (existing) {
        existing.totalUnitsSold += qty
        existing.totalComparableUnits += comparableQty
        existing.totalRevenue += revenue
        existing.orderCount += 1
        existing.unitsMap.set(unit, (existing.unitsMap.get(unit) || 0) + qty)
      } else {
        const unitsMap = new Map<string, number>()
        unitsMap.set(unit, qty)
        map.set(key, {
          productId: pId,
          productName: formattedName,
          rawName,
          size: pSize,
          sku: pSku || 'N/A',
          category: pCat || 'Beverage',
          imageUrl: pImg || '',
          unitPrice: pPrice,
          totalUnitsSold: qty,
          totalComparableUnits: comparableQty,
          totalRevenue: revenue,
          orderCount: 1,
          warehouseId: wId,
          warehouseName: wName,
          unitLabel: unit,
          unitsMap,
        })
      }
    }

    // 1. Process Wholesale / Online Orders
    orders.forEach((order) => {
      const status = String(order.status || '').toUpperCase()
      if (status === 'CANCELLED' || status === 'REJECTED') return
      const orderDate = order.createdAt || order.date || ''
      if (!isDateInPeriod(orderDate)) return

      // Keep warehouse metadata on aggregated rows without using it as a filter.
      const orderWarehouseId = String(order.warehouseId || order.warehouse_id || order.warehouse?.id || '').trim()
      const wName = String(order.warehouseName || order.warehouse?.name || 'Central Warehouse').trim()

      const items = Array.isArray(order.items) ? order.items : []
      items.forEach((item: any) => {
        const isMixed =
          String(item.itemType || item.item_type || '').toUpperCase() === 'MIXED_CASE' ||
          (Array.isArray(item.components) && item.components.length > 0)

        if (isMixed && Array.isArray(item.components) && item.components.length > 0) {
          const caseQty = Math.max(1, Number(item.quantity || 1))
          item.components.forEach((comp: any) => {
            const cProd = comp.product || {}
            const cId = String(comp.productId || cProd.id || '').trim()
            const cName = String(comp.productName || cProd.name || 'Component').trim()
            const cSize = getItemSize(comp)
            const cSku = String(comp.productSku || cProd.sku || '').trim()
            const cCat = String(cProd.category?.name || cProd.category || 'Mixed Component').trim()
            const cImg = String(cProd.imageUrl || comp.imageUrl || '').trim()
            const cPrice = Number(comp.unitPrice || 0)
            const perCaseQty = Math.max(1, Number(comp.quantityPerCase || comp.quantityBaseUnits || comp.quantity || 1))
            const totalBottles = perCaseQty * caseQty
            const rev = totalBottles * cPrice
            const uLabel = getLooseUnitLabel(comp, cCat)
            // Bottle components are converted back to their case count for fair velocity ranking.
            registerMovement(cId, cName, cSize, cSku, cCat, cImg, cPrice, totalBottles, rev, orderWarehouseId, wName, uLabel, caseQty)
          })
        } else {
          const prod = item.product || {}
          const pId = String(item.productId || prod.id || '').trim()
          const pName = String(item.productName || prod.name || item.name || 'Product').trim()
          const pSize = getItemSize(item)
          const pSku = String(prod.sku || item.sku || '').trim()
          const pCat = String(prod.category?.name || prod.category || item.category || '').trim()
          const pImg = String(prod.imageUrl || item.imageUrl || '').trim()
          const pPrice = Number(item.unitPrice || item.price || prod.price || 0)
          const qty = Math.max(1, Number(item.quantity || 1))
          const rev = Number(item.subtotal || qty * pPrice)
          const explicitUnit = String(item?.unit || item?.product?.unit || '').toLowerCase()
          const uLabel = explicitUnit.includes('pack') ? 'packs' : 'cases'
          registerMovement(pId, pName, pSize, pSku, pCat, pImg, pPrice, qty, rev, orderWarehouseId, wName, uLabel)
        }
      })
    })

    // 2. Process Retail POS Sales
    retailSales.forEach((sale) => {
      const saleDate = sale.createdAt || sale.date || ''
      if (!isDateInPeriod(saleDate)) return

      const saleWarehouseId = String(sale.warehouseId || sale.warehouse?.id || '').trim()
      const wName = String(sale.warehouseName || sale.warehouse?.name || 'Retail Warehouse').trim()

      const items = Array.isArray(sale.items) ? sale.items : []
      items.forEach((item: any) => {
        const isMixed =
          String(item.mode || item.itemType || '').toUpperCase() === 'MIXED_CASE' ||
          (Array.isArray(item.components) && item.components.length > 0)

        if (isMixed && Array.isArray(item.components) && item.components.length > 0) {
          const caseQty = Math.max(1, Number(item.quantity || 1))
          item.components.forEach((comp: any) => {
            const cId = String(comp.productId || '').trim()
            const cName = String(comp.productName || 'Component').trim()
            const cSize = getItemSize(comp)
            const cSku = String(comp.productSku || '').trim()
            const cCat = String(comp.category || 'Retail Mixed Component').trim()
            const cImg = String(comp.imageUrl || '').trim()
            const cPrice = Number(comp.unitPrice || 0)
            const totalBottles = Math.max(1, Number(comp.quantityBaseUnits || comp.quantityPerCase || 1)) * caseQty
            const rev = totalBottles * cPrice
            const uLabel = getLooseUnitLabel(comp, cCat)
            // Compare the movement as cases while retaining bottle quantity in the display breakdown.
            registerMovement(cId, cName, cSize, cSku, cCat, cImg, cPrice, totalBottles, rev, saleWarehouseId, wName, uLabel, caseQty)
          })
        } else {
          const pId = String(item.productId || '').trim()
          const pName = String(item.productName || item.name || 'Product').trim()
          const pSize = getItemSize(item)
          const pSku = String(item.productSku || item.sku || '').trim()
          const pCat = String(item.category || '').trim()
          const pImg = String(item.imageUrl || '').trim()
          const pPrice = Number(item.unitPrice || 0)
          const qty = Math.max(1, Number(item.quantity || 1))
          const rev = Number(item.productSubtotal || qty * pPrice)
          const explicitUnit = String(item?.unit || '').toLowerCase()
          const isLoose = item.mode === 'BOTTLE' || explicitUnit.includes('bottle') || explicitUnit.includes('can')
          const uLabel = isLoose ? getLooseUnitLabel(item, pCat) : (explicitUnit.includes('pack') ? 'packs' : 'cases')
          const quantityPerCase = Math.max(1, Number(item.quantityPerCase || item.product?.quantityPerCase || 1))
          const comparableQty = isLoose ? qty / quantityPerCase : qty
          registerMovement(pId, pName, pSize, pSku, pCat, pImg, pPrice, qty, rev, saleWarehouseId, wName, uLabel, comparableQty)
        }
      })
    })

    // 3. Process Stock-Out Inventory Transactions if available
    inventoryTransactions.forEach((tx) => {
      const txType = String(tx.type || tx.transactionType || '').toUpperCase()
      const isStockOut = ['STOCK_OUT', 'DISPATCH', 'SALE', 'OUT', 'ORDER_OUT'].includes(txType)
      if (!isStockOut) return

      const txDate = tx.createdAt || tx.date || ''
      if (!isDateInPeriod(txDate)) return

      const txWarehouseId = String(tx.warehouseId || tx.warehouse?.id || '').trim()
      const wName = String(tx.warehouseName || tx.warehouse?.name || 'Warehouse Hub').trim()

      const pId = String(tx.productId || tx.product?.id || '').trim()
      const pName = String(tx.productName || tx.product?.name || tx.product || '').trim()
      if (!pName && !pId) return
      const key = (pId || pName).toLowerCase().trim()

      // Only add transaction if not already heavily captured from order lines
      if (!map.has(key)) {
        const pSize = getItemSize(tx)
        const pSku = String(tx.product?.sku || tx.sku || '').trim()
        const pCat = String(tx.product?.category?.name || tx.category || '').trim()
        const pImg = String(tx.product?.imageUrl || tx.imageUrl || '').trim()
        const pPrice = Number(tx.unitPrice || tx.price || tx.product?.price || 0)
        const qty = Math.max(1, Math.abs(Number(tx.quantity || 1)))
        const rev = qty * pPrice
        const explicitUnit = String(tx.unit || '').toLowerCase()
        const isLoose = tx.mode === 'BOTTLE' || explicitUnit.includes('bottle') || explicitUnit.includes('can')
        const uLabel = isLoose ? getLooseUnitLabel(tx, pCat) : (explicitUnit.includes('pack') ? 'packs' : 'cases')
        const quantityPerCase = Math.max(1, Number(tx.quantityPerCase || tx.product?.quantityPerCase || 1))
        const comparableQty = isLoose ? qty / quantityPerCase : qty
        registerMovement(pId, pName, pSize, pSku, pCat, pImg, pPrice, qty, rev, txWarehouseId, wName, uLabel, comparableQty)
      }
    })

    return Array.from(map.values())
  }, [orders, retailSales, inventoryTransactions, isDateInPeriod])

  // Build fully ranked fastest moving product list with on-hand stock and velocity
  const rankedProducts = useMemo(() => {
    let list = productMovements.map((item) => {
      const stockInfo = inventoryStockMap.get(item.productId.toLowerCase()) ||
        inventoryStockMap.get(item.rawName.toLowerCase()) || {
          currentStock: 0,
          reservedStock: 0,
          threshold: 10,
          sku: item.sku,
          category: item.category,
          price: item.unitPrice,
          imageUrl: item.imageUrl,
          size: item.size,
          unitLabel: item.unitLabel,
        }

      const currentStock = stockInfo.currentStock
      // Rank velocity using normalized case/pack equivalents instead of adding bottles to cases.
      const dailyVelocity = Number((item.totalComparableUnits / Math.max(1, periodDays)).toFixed(1))
      const stockRunwayDays = dailyVelocity > 0 ? Math.round(currentStock / dailyVelocity) : (currentStock > 0 ? 999 : 0)

      let stockStatus = 'HEALTHY'
      if (currentStock <= 0) {
        stockStatus = 'OUT_OF_STOCK'
      } else if (currentStock <= Math.max(1, Math.floor(stockInfo.threshold / 2))) {
        stockStatus = 'CRITICAL'
      } else if (currentStock <= stockInfo.threshold) {
        stockStatus = 'LOW_STOCK'
      }

      const unitBreakdown: { unit: string; qty: number }[] = []
      if (item.unitsMap && item.unitsMap.size > 0) {
        item.unitsMap.forEach((qty, unit) => {
          if (qty > 0) {
            unitBreakdown.push({ unit, qty })
          }
        })
        unitBreakdown.sort((a, b) => {
          const orderScore = (u: string) => {
            if (u.includes('case')) return 1
            if (u.includes('pack')) return 2
            if (u.includes('glass')) return 3
            if (u.includes('plastic') || u.includes('pet')) return 4
            if (u.includes('can')) return 5
            return 6
          }
          return orderScore(a.unit) - orderScore(b.unit)
        })
      } else {
        unitBreakdown.push({ unit: item.unitLabel || 'cases', qty: item.totalUnitsSold })
      }

      return {
        ...item,
        sku: item.sku !== 'N/A' ? item.sku : stockInfo.sku,
        category: item.category || stockInfo.category || 'Beverage',
        imageUrl: item.imageUrl || stockInfo.imageUrl,
        unitLabel: item.unitLabel || stockInfo.unitLabel || 'cases',
        stockUnitLabel: stockInfo.unitLabel || 'cases',
        unitBreakdown,
        currentStock,
        dailyVelocity,
        stockRunwayDays,
        stockStatus,
      }
    })

    // Category filtering
    if (categoryFilter !== 'all') {
      list = list.filter((item) => item.category.toLowerCase() === categoryFilter.toLowerCase())
    }

    // Search term filtering
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.productName.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
      )
    }

    // Sorting
    list = [...list].sort((a, b) => {
      let valA = 0
      let valB = 0
      if (sortField === 'velocity') {
        valA = a.dailyVelocity
        valB = b.dailyVelocity
      } else if (sortField === 'units') {
        valA = a.totalComparableUnits
        valB = b.totalComparableUnits
      } else if (sortField === 'revenue') {
        valA = a.totalRevenue
        valB = b.totalRevenue
      } else {
        valA = a.currentStock
        valB = b.currentStock
      }
      return sortOrder === 'desc' ? valB - valA : valA - valB
    })

    // Assign Rank Numbers
    return list.map((item, index) => ({
      ...item,
      rank: index + 1,
    }))
  }, [productMovements, inventoryStockMap, periodDays, categoryFilter, searchTerm, sortField, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const totalMovingSkus = rankedProducts.length
    const totalUnitsDispatched = rankedProducts.reduce((sum, p) => sum + p.totalUnitsSold, 0)
    const totalComparableUnits = rankedProducts.reduce((sum, p) => sum + p.totalComparableUnits, 0)
    const totalOutflowRevenue = rankedProducts.reduce((sum, p) => sum + p.totalRevenue, 0)
    const avgDailyTurnover = Number((totalComparableUnits / Math.max(1, periodDays)).toFixed(1))
    const topFastestProduct = rankedProducts[0] || null

    return {
      totalMovingSkus,
      totalUnitsDispatched,
      totalOutflowRevenue,
      avgDailyTurnover,
      topFastestProduct,
    }
  }, [rankedProducts, periodDays])

  // Top 10 Chart Data
  const top10ChartData = useMemo(() => {
    return rankedProducts.slice(0, 8).map((p) => ({
      name: p.productName.length > 18 ? `${p.productName.slice(0, 16)}...` : p.productName,
      fullName: p.productName,
      // The chart uses the same normalized quantity as the ranking and velocity calculation.
      units: Number(p.totalComparableUnits.toFixed(1)),
      velocity: p.dailyVelocity,
      revenue: p.totalRevenue,
      rank: p.rank,
    }))
  }, [rankedProducts])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(rankedProducts.length / pageSize))
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return rankedProducts.slice(start, start + pageSize)
  }, [rankedProducts, currentPage])

  // Stock Status Badge Helper
  const getStockStatusBadge = (status: string) => {
    switch (status) {
      case 'OUT_OF_STOCK':
        return <Badge className="bg-rose-50 text-rose-700 border-rose-200">Out of Stock</Badge>
      case 'CRITICAL':
        return <Badge className="bg-red-50 text-red-700 border-red-200">Critical Low</Badge>
      case 'LOW_STOCK':
        return <Badge className="bg-amber-50 text-amber-700 border-amber-200">Needs Restock</Badge>
      default:
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Healthy</Badge>
    }
  }

  // Export Columns for CSV & PDF
  const exportColumns: ExportColumn[] = [
    { header: 'Rank', accessor: (r) => `#${r.rank}` },
    { header: 'Product & Size', key: 'productName' },
    { header: 'SKU', key: 'sku' },
    { header: 'Category', key: 'category' },
    {
      header: 'QTY',
      accessor: (r) =>
        r.unitBreakdown && r.unitBreakdown.length > 0
          ? r.unitBreakdown.map((b: any) => `${b.qty.toLocaleString()} ${b.unit}`).join(' / ')
          : `${Number(r.totalUnitsSold || 0).toLocaleString()} ${r.unitLabel || 'cases'}`,
    },
    { header: 'Daily Velocity (Equivalent Units/Day)', accessor: (r) => `${r.dailyVelocity}/day` },
    { header: 'Revenue Generated (PHP)', accessor: (r) => Number(r.totalRevenue || 0).toFixed(2) },
    { header: 'Current Stock', accessor: (r) => `${Number(r.currentStock || 0).toLocaleString()} ${r.stockUnitLabel || r.unitLabel || 'cases'}` },
    { header: 'Stock Status', key: 'stockStatus' },
  ]

  const periodLabel = useMemo(() => {
    if (periodPreset === '7') return 'Past 7 Days'
    if (periodPreset === '30') return 'Past 30 Days'
    if (periodPreset === '90') return 'Past 90 Days'
    if (periodPreset === '365') return 'Past 1 Year'
    if (periodPreset === 'custom' && dateFrom && dateTo) return `${dateFrom} to ${dateTo}`
    return 'All Time'
  }, [periodPreset, dateFrom, dateTo])

  const handleExportCsv = () => {
    exportToCsv(
      `fastest-moving-products-${periodPreset}-${new Date().toISOString().slice(0, 10)}.csv`,
      exportColumns,
      rankedProducts
    )
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `fastest-moving-products-${periodPreset}-${new Date().toISOString().slice(0, 10)}.pdf`,
      `Fastest-Moving Products Velocity Ranking (${periodLabel})`,
      exportColumns,
      rankedProducts,
      [
        `#1 Best Seller: ${kpis.topFastestProduct?.productName || 'N/A'} (${kpis.topFastestProduct?.totalUnitsSold.toLocaleString() || 0} ${kpis.topFastestProduct?.unitLabel || 'cases'} moved)`,
        `Total Volume Dispatched: ${kpis.totalUnitsDispatched.toLocaleString()} units | Velocity: ${kpis.avgDailyTurnover} units/day`,
        `Total Movement Value: ${formatPeso(kpis.totalOutflowRevenue)} across ${kpis.totalMovingSkus} active SKUs`,
      ],
      periodLabel
    )
  }

  const handlePrint = () => {
    printReportTable(
      `Fastest-Moving Products Velocity Ranking (${periodLabel})`,
      exportColumns,
      rankedProducts,
      [
        `#1 Best Seller: ${kpis.topFastestProduct?.productName || 'N/A'} (${kpis.topFastestProduct?.totalUnitsSold.toLocaleString() || 0} ${kpis.topFastestProduct?.unitLabel || 'cases'} moved)`,
        `Total Volume Dispatched: ${kpis.totalUnitsDispatched.toLocaleString()} units | Velocity: ${kpis.avgDailyTurnover} units/day`,
        `Total Movement Value: ${formatPeso(kpis.totalOutflowRevenue)} across ${kpis.totalMovingSkus} active SKUs`,
      ],
      periodLabel
    )
  }

  return (
    <div className="report-design-system space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">Fastest-Moving Products & Velocity Ranking</h2>
            <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1 text-xs">
              <Zap className="h-3 w-3 text-amber-600" /> Fast-Movers
            </Badge>
          </div>
          <p className="text-sm text-slate-500">
            Product turnover velocity, stock outflow rate, revenue contribution, and days of inventory remaining.
          </p>
        </div>

        {/* Action Controls & Exports */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Export Buttons */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-slate-700" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            className="h-11 gap-2 rounded-xl border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-100"
          >
            <Download className="h-4 w-4 text-blue-600" />
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <Printer className="h-4 w-4 text-slate-600" />
            Print
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Top Product */}
        <Card className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/50 to-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-semibold tracking-wide text-amber-700 flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5 text-amber-500" /> #1 Best Seller
            </CardDescription>
            <CardTitle className="text-lg font-bold text-slate-900 truncate">
              {kpis.topFastestProduct?.productName || 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-700">
                {kpis.topFastestProduct?.unitBreakdown && kpis.topFastestProduct.unitBreakdown.length > 0
                  ? kpis.topFastestProduct.unitBreakdown.map((b: any) => `${b.qty.toLocaleString()} ${b.unit}`).join(', ')
                  : `${kpis.topFastestProduct?.totalUnitsSold.toLocaleString() || 0} cases`}
              </span>
              <span className="text-slate-400">
                {kpis.topFastestProduct ? `${kpis.topFastestProduct.dailyVelocity}/day` : ''}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Total QTY Dispatched */}
        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Total Dispatched QTY</CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-700">{kpis.totalUnitsDispatched.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Cumulative items sold in period</CardContent>
        </Card>

        {/* Outflow Revenue */}
        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Gross Movement Value</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{formatPeso(kpis.totalOutflowRevenue)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Total sales volume valuation</CardContent>
        </Card>

        {/* Daily Velocity */}
        <Card className="rounded-2xl border border-purple-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-purple-600">Avg Daily Velocity</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-700">{kpis.avgDailyTurnover} <span className="text-sm font-normal text-slate-500">units/day</span></CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Stock outflow rate</CardContent>
        </Card>

        {/* Active SKUs */}
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-slate-500">Moving SKUs</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-800">{kpis.totalMovingSkus}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-400">Products with active movement</CardContent>
        </Card>
      </div>

      {/* Top 8 Fast-Moving Product Velocity Chart */}
      {top10ChartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800">
                Top Fast-Moving Products by Normalized Volume
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Case/pack-equivalent movement used for fair ranking ({periodLabel})
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs text-slate-600">Top {top10ChartData.length} Ranked</Badge>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top10ChartData} margin={{ top: 15, right: 15, left: -10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => [
                      `${Number(value).toLocaleString()} equivalent units`,
                      'Normalized QTY Dispatched',
                    ]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#64748b', paddingTop: '4px' }} />
                  <Bar dataKey="units" name="Normalized QTY Dispatched" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {top10ChartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === 0 ? '#f59e0b' : index === 1 ? '#94a3b8' : index === 2 ? '#d97706' : '#3b82f6'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters Bar */}
      <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search product / SKU / category..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 text-xs"
            />
          </div>

          {/* Time Preset */}
          <div>
            <select
              value={periodPreset}
              onChange={(e) => {
                setPeriodPreset(e.target.value as any)
                setCurrentPage(1)
              }}
              aria-label="Filter by time preset"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Time</option>
              <option value="7">Past 7 Days</option>
              <option value="30">Past 30 Days</option>
              <option value="90">Past 90 Days</option>
              <option value="365">Past 1 Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by beverage category"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Categories</option>
              {distinctCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Control */}
          <div className="flex gap-1.5">
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as any)}
              aria-label="Sort by field"
              className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="velocity">Sort by Velocity</option>
              <option value="units">Sort by Units Moved</option>
              <option value="revenue">Sort by Revenue</option>
              <option value="stock">Sort by Available Stock</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="h-9 px-2 text-xs font-medium shrink-0"
              title="Toggle sort order"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Custom Date Pickers */}
        {periodPreset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <span className="text-xs font-medium text-slate-500">Date Range:</span>
            <input
              type="date"
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter from date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Fastest Moving Items Ranking Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4 text-center w-16">Rank</th>
                <th className="p-3.5">Product & Size</th>
                <th className="p-3.5">SKU / Category</th>
                <th className="p-3.5 text-right">QTY</th>
                <th className="p-3.5 text-center">Daily Velocity</th>
                <th className="p-3.5 text-right">Revenue (₱)</th>
                <th className="p-3.5 text-right">Current Stock</th>
                <th className="p-3.5 pr-4 text-center">Stock Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedProducts.length > 0 ? (
                paginatedProducts.map((row) => (
                  <tr key={`${row.productId}-${row.rank}`} className="hover:bg-slate-50/80 transition-colors">
                    {/* Rank Badge */}
                    <td className="p-3.5 pl-4 text-center">
                      {row.rank === 1 ? (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-100 text-amber-800 font-bold text-xs shadow-xs">
                          🥇
                        </span>
                      ) : row.rank === 2 ? (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200 text-slate-800 font-bold text-xs shadow-xs">
                          🥈
                        </span>
                      ) : row.rank === 3 ? (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-50 text-amber-900 border border-amber-300 font-bold text-xs shadow-xs">
                          🥉
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-100 text-slate-600 font-semibold text-[11px]">
                          #{row.rank}
                        </span>
                      )}
                    </td>

                    {/* Product Name & Size */}
                    <td className="p-3.5 font-medium text-slate-900">
                      <div className="flex items-center gap-2.5">
                        {row.imageUrl ? (
                          <img
                            src={row.imageUrl}
                            alt={row.productName}
                            className="h-8 w-8 rounded-md object-cover border border-slate-200 bg-white shrink-0"
                            onError={(e) => {
                              ;(e.currentTarget as HTMLElement).style.display = 'none'
                            }}
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                            <Package className="h-4 w-4 text-slate-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-slate-900 leading-snug">{row.productName}</p>
                          <p className="text-[11px] text-slate-400">{row.orderCount} transaction(s)</p>
                        </div>
                      </div>
                    </td>

                    {/* SKU & Category */}
                    <td className="p-3.5">
                      <div className="font-medium text-slate-700">{row.sku}</div>
                      <div className="text-[11px] text-slate-400">{row.category}</div>
                    </td>

                    {/* QTY */}
                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end justify-center gap-0.5">
                        {row.unitBreakdown && row.unitBreakdown.length > 0 ? (
                          row.unitBreakdown.map((b: { unit: string; qty: number }, bIdx: number) => (
                            <div key={bIdx} className="flex items-baseline justify-end gap-1">
                              <span className="font-bold text-blue-700 text-sm leading-tight">{b.qty.toLocaleString()}</span>
                              <span className="text-[11px] text-slate-500 font-medium leading-tight">{b.unit}</span>
                            </div>
                          ))
                        ) : (
                          <div className="flex items-baseline justify-end gap-1">
                            <span className="font-bold text-blue-700 text-sm leading-tight">{row.totalUnitsSold.toLocaleString()}</span>
                            <span className="text-[11px] text-slate-500 font-medium leading-tight">{row.unitLabel}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Daily Velocity */}
                    <td className="p-3.5 text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 border border-purple-100">
                        <TrendingUp className="h-3 w-3" />
                        {row.dailyVelocity}/day
                      </span>
                    </td>

                    {/* Revenue Generated */}
                    <td className="p-3.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                      {formatPeso(row.totalRevenue)}
                    </td>

                    {/* Current Stock */}
                    <td className="p-3.5 text-right whitespace-nowrap font-medium text-slate-700">
                      <span>{row.currentStock.toLocaleString()}</span>
                      <span className="ml-1 text-[11px] text-slate-400 font-normal">{row.stockUnitLabel || row.unitLabel}</span>
                    </td>

                    {/* Stock Status Badge */}
                    <td className="p-3.5 pr-4 text-center">
                      {getStockStatusBadge(row.stockStatus)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Package className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No product movement records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/50">
            <span className="text-xs text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, rankedProducts.length)} of {rankedProducts.length} ranked products
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-7 text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-7 text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
