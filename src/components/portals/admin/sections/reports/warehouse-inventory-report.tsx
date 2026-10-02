'use client'

import React, { useMemo, useState, type ReactNode } from 'react'
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
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeRanking, toPoints } from '@/lib/chart-interpretation'
import { formatPeso, formatDayKey } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'
import { ReportKpiRow } from './report-kpi'
import { InventoryReportHeader } from './inventory-report-header'
import { buildReportDateWindow, matchesReportDateWindow } from '@/components/portals/admin/sections/report-date-utils'
import { formatReportProductNameForExport } from '@/lib/report-metrics'
import {
  buildProductMovements,
  formatDailyVelocity,
  getItemSize,
  resolveVelocityDays,
  type VelocityPeriodPreset,
} from '@/lib/product-movement'

interface WarehouseInventoryReportProps {
  inventory: any[]
  inventoryTransactions?: any[]
  orders?: any[]
  retailSales?: any[]
  warehouses?: any[]
  stockBatches?: any[]
  /** The Inventory tab's report picker, shown in this report's header. */
  reportTypeSelect?: ReactNode
}

type PeriodPreset = VelocityPeriodPreset

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

export function WarehouseInventoryReport({
  inventory,
  inventoryTransactions = [],
  orders = [],
  retailSales = [],
  stockBatches = [],
  reportTypeSelect,
}: WarehouseInventoryReportProps) {
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<'velocity' | 'units' | 'revenue' | 'stock'>('velocity')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 12

  // Number of days in the active period for daily velocity calculation.
  // All Time and an open-started custom range run from the earliest record.
  const periodDays = useMemo(() => {
    const recordDates = [...inventoryTransactions, ...orders, ...retailSales]
      .map((item) => item?.createdAt || item?.created_at)
    return resolveVelocityDays(periodPreset, dateFrom, dateTo, recordDates)
  }, [periodPreset, dateFrom, dateTo, inventoryTransactions, orders, retailSales])

  // Date filtering helper
  const isDateInPeriod = useMemo(() => {
    // Fix: invalid timestamps cannot pass a custom range, and presets end today.
    const window = buildReportDateWindow(periodPreset, dateFrom, dateTo)
    return (dateStr: unknown) => matchesReportDateWindow(dateStr, window)
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

  // Delivered orders and completed counter sales, in case-equivalents for ranking.
  // Whole units are labelled in each product's current order format, as the stock column is.
  const productMovements = useMemo(() => {
    const currentUnits = new Map<string, unknown>()
    inventory.forEach((inv) => {
      const productId = String(inv.productId || inv.product?.id || '').trim()
      if (productId && inv.product?.unit) currentUnits.set(productId, inv.product.unit)
    })
    return buildProductMovements(orders, retailSales, isDateInPeriod, {
      currentProductUnit: (productId) => currentUnits.get(productId),
    })
  }, [orders, retailSales, isDateInPeriod, inventory])

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
      // Kept unrounded: rounding to 0.1 tied every slow mover at 0.0 and shuffled their ranks.
      const dailyVelocity = item.totalComparableUnits / Math.max(1, periodDays)
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

    // Rank is the product's place by volume. The sort control below only reorders
    // rows, so sorting by stock or ascending no longer hands the gold medal to
    // whichever product lands first.
    const rankOf = new Map(
      [...list]
        .sort((a, b) => b.totalComparableUnits - a.totalComparableUnits)
        .map((item, index) => [item, index + 1] as const)
    )

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

    return list.map((item) => ({
      ...item,
      rank: rankOf.get(item) ?? 0,
    }))
  }, [productMovements, inventoryStockMap, periodDays, categoryFilter, searchTerm, sortField, sortOrder])

  // The table's sort control reorders rankedProducts, so anything labelled "top"
  // or "#1" reads this copy instead. Sorting the table ascending used to chart the
  // slowest products as "Top Fast-Moving" and crown the slowest one.
  const productsByVolume = useMemo(
    () => [...rankedProducts].sort((a, b) => a.rank - b.rank),
    [rankedProducts]
  )

  // KPIs
  const kpis = useMemo(() => {
    const totalMovingSkus = rankedProducts.length
    // Case-equivalents, the same unit as the velocity: raw totals added bottles to cases.
    const totalUnitsDispatched = rankedProducts.reduce((sum, p) => sum + p.totalComparableUnits, 0)
    const totalOutflowRevenue = rankedProducts.reduce((sum, p) => sum + p.totalRevenue, 0)
    const avgDailyTurnover = totalUnitsDispatched / Math.max(1, periodDays)
    const topFastestProduct = productsByVolume[0] || null

    return {
      totalMovingSkus,
      totalUnitsDispatched,
      totalOutflowRevenue,
      avgDailyTurnover,
      topFastestProduct,
    }
  }, [rankedProducts, productsByVolume, periodDays])

  // Top 10 Chart Data
  const top10ChartData = useMemo(() => {
    return productsByVolume.slice(0, 8).map((p, index) => ({
      name: p.productName.length > 18 ? `${p.productName.slice(0, 16)}...` : p.productName,
      fullName: p.productName,
      // The chart uses the same normalized quantity as the ranking and velocity calculation.
      units: Number(p.totalComparableUnits.toFixed(1)),
      velocity: p.dailyVelocity,
      revenue: p.totalRevenue,
      rank: index + 1,
    }))
  }, [productsByVolume])

  // Units here are the normalized comparable quantity the ranking itself uses.
  const chartInterpretation = useMemo(() => {
    const fastest = top10ChartData[0]
    const perDay = formatDailyVelocity(Number(fastest?.velocity || 0))
    const velocity = fastest && Number(fastest.velocity) >= 0.01
      ? ` That works out to about ${perDay} ${perDay === '1' ? 'unit' : 'units'} a day for ${fastest.fullName}, the fastest mover.`
      : ''
    return `${describeRanking(toPoints(top10ChartData, (row: any) => row.fullName, (row: any) => row.units), {
      noun: 'dispatched units',
      entityNoun: 'charted product',
    })}${velocity}`
  }, [top10ChartData])

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

  // Export product labels always include a recorded size or an explicit data-gap marker.
  const getExportProductName = (row: any) =>
    formatReportProductNameForExport({ name: row?.rawName || row?.productName, sizeLabel: row?.size })

  // Each unit stays separate: adding loose bottles to cases made "34 cases" out of 10 cases and 24 bottles.
  const formatUnitBreakdown = (row: any, separator: string) =>
    (row?.unitBreakdown || []).map((b: { unit: string; qty: number }) => `${b.qty.toLocaleString()} ${b.unit}`).join(separator)

  const formatEquivalentUnits = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })

  // Export Columns for CSV & PDF
  const exportColumns: ExportColumn[] = [
    { header: 'Rank', accessor: (r) => `#${r.rank}` },
    {
      header: 'Product & Size',
      accessor: (r) => getExportProductName(r),
    },
    { header: 'SKU', key: 'sku' },
    { header: 'Category', key: 'category' },
    {
      header: 'QTY',
      accessor: (r) =>
        r.unitBreakdown && r.unitBreakdown.length > 0
          ? formatUnitBreakdown(r, ' / ')
          : `${Number(r.totalUnitsSold || 0).toLocaleString()} ${r.unitLabel || 'cases'}`,
    },
    { header: 'Daily Velocity (Equivalent Units/Day)', accessor: (r) => `${formatDailyVelocity(r.dailyVelocity)}/day` },
    { header: 'Revenue Generated (₱)', accessor: (r) => Number(r.totalRevenue || 0).toFixed(2) },
    { header: 'Current Stock', accessor: (r) => `${Number(r.currentStock || 0).toLocaleString()} ${r.stockUnitLabel || r.unitLabel || 'cases'}` },
    { header: 'Stock Status', key: 'stockStatus' },
  ]

  const periodLabel = useMemo(() => {
    if (periodPreset === 'today') return 'Today'
    if (periodPreset === '7') return 'Past 7 Days'
    if (periodPreset === '30') return 'Past 30 Days'
    if (periodPreset === '90') return 'Past 90 Days'
    if (periodPreset === '365') return 'Past 1 Year'
    // Fix: an open-ended custom filter must not be labelled All Time in exports.
    if (periodPreset === 'custom') return buildReportDateWindow(periodPreset, dateFrom, dateTo).label
    return 'All Time'
  }, [periodPreset, dateFrom, dateTo])

  const exportSummaryLines = () => [
    `#1 Best Seller: ${kpis.topFastestProduct ? `${getExportProductName(kpis.topFastestProduct)} (${formatUnitBreakdown(kpis.topFastestProduct, ', ')} moved)` : 'N/A'}`,
    `Total Volume Dispatched: ${formatEquivalentUnits(kpis.totalUnitsDispatched)} case-equivalent units | Velocity: ${formatDailyVelocity(kpis.avgDailyTurnover)} units/day`,
    `Total Movement Value: ${formatPeso(kpis.totalOutflowRevenue)} across ${kpis.totalMovingSkus} active SKUs`,
  ]

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
      exportSummaryLines(),
      periodLabel
    )
  }

  const handlePrint = () => {
    printReportTable(
      `Fastest-Moving Products Velocity Ranking (${periodLabel})`,
      exportColumns,
      rankedProducts,
      exportSummaryLines(),
      periodLabel
    )
  }

  return (
    <div className="report-design-system flex flex-col gap-6">
      <InventoryReportHeader
        title="Fastest-Moving Products & Velocity Ranking"
        badge={{
          icon: <Zap className="h-3 w-3 text-amber-600" />,
          label: 'Fast-Movers',
          className: 'bg-amber-50 text-amber-700 border-amber-200',
        }}
        description="Product turnover velocity, stock outflow rate, revenue contribution, and days of inventory remaining."
        reportTypeSelect={reportTypeSelect}
        onExportCsv={handleExportCsv}
        onExportPdf={handleExportPdf}
        onPrint={handlePrint}
      />

      {/* The fastest mover is what a warehouse plans around, so it leads; the
          volume and value figures underneath say how much movement that is. */}
      <ReportKpiRow
        headline={{
          id: 'best-seller',
          label: (<><Trophy className="h-3.5 w-3.5 text-amber-500" /> #1 Best Seller</>),
          value: <span className="block truncate">{kpis.topFastestProduct?.productName || 'No movement yet'}</span>,
          valueKind: 'text',
          tone: 'amber',
          hint: kpis.topFastestProduct ? (
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-amber-700">
                {kpis.topFastestProduct.unitBreakdown && kpis.topFastestProduct.unitBreakdown.length > 0
                  ? formatUnitBreakdown(kpis.topFastestProduct, ', ')
                  : `${kpis.topFastestProduct.totalUnitsSold.toLocaleString()} cases`}
              </span>
              <span className="text-slate-400">{formatDailyVelocity(kpis.topFastestProduct.dailyVelocity)}/day</span>
            </span>
          ) : undefined,
        }}
        items={[
          { label: 'Dispatched QTY', value: formatEquivalentUnits(kpis.totalUnitsDispatched), hint: 'Case-equivalents sold in period', tone: 'blue' },
          { label: 'Movement Value', value: formatPeso(kpis.totalOutflowRevenue), hint: 'Outflow valuation', tone: 'emerald' },
          { label: 'Avg Daily Velocity', value: <>{formatDailyVelocity(kpis.avgDailyTurnover)} <span className="text-sm font-normal text-slate-500">units/day</span></>, hint: 'Stock outflow rate', tone: 'purple' },
          { label: 'Moving SKUs', value: kpis.totalMovingSkus, hint: 'With active movement', tone: 'slate' },
        ]}
      />

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
            <ChartInterpretation text={chartInterpretation} />
          </CardContent>
        </Card>
      )}

      {/* Filters Bar */}
      <Card className="order-[-1] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <option value="today">Today</option>
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
              max={dateTo || undefined} value={dateFrom}
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
              min={dateFrom || undefined} value={dateTo}
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
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="stack-table w-full min-w-[900px] text-left text-xs">
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
                        {formatDailyVelocity(row.dailyVelocity)}/day
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-slate-100 px-4 py-3 bg-slate-50/50">
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
