import { getOrderSalesAmount, getRetailSaleStatus, isPrimaryOrderForReporting, isRevenueRecognized, normalizeOrderReportStatus } from './report-metrics.ts'

/**
 * Product sales for the Fastest-Moving / #1 Best Seller report.
 *
 * Products are ranked on `totalComparableUnits`: full cases (or packs) count as
 * one each, while loose bottles and mixed-case bottles count as the share of a
 * case they fill. A 24-bottle mixed case split 12 + 12 is half a case of each
 * product, not a whole case of both.
 */
export type ProductMovement = {
  productId: string
  productName: string
  rawName: string
  size: string
  sku: string
  category: string
  imageUrl: string
  unitPrice: number
  /** Quantities in mixed units (cases + bottles); for display, never for ranking. */
  totalUnitsSold: number
  totalComparableUnits: number
  totalRevenue: number
  orderCount: number
  warehouseId: string
  warehouseName: string
  unitLabel: string
  unitsMap: Map<string, number>
}

export type VelocityPeriodPreset = 'today' | '7' | '30' | '90' | '365' | 'all' | 'custom'

const DAY_MS = 86400000

function positive(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function getItemSize(item: any): string {
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

function getLooseUnitLabel(item: any, categoryName?: string): string {
  // The container decides a loose unit, so it is read before `unit`, which names
  // the whole selling unit (case or pack) on counter lines.
  const explicitUnit = String(
    item?.packagingType ||
    item?.looseUnit ||
    item?.containerTypeName ||
    item?.product?.packagingType ||
    item?.packaging ||
    item?.unitLabel ||
    item?.unit ||
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

// A product's selling unit (Product.unit: case, pack or bottle) as the report labels it.
function wholeUnitLabel(unit: unknown): string {
  const value = String(unit || '').trim().toLowerCase()
  if (value.includes('pack') || value.includes('bundle')) return 'packs'
  if (value.includes('bottle')) return 'bottles'
  if (value.includes('case') && !value.includes('mixed')) return 'cases'
  return ''
}

function formatProductNameWithSize(name: string, size?: string): string {
  const cleanName = String(name || 'Product').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  const cleanSize = String(size || '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  return cleanSize && !cleanName.toLowerCase().includes(cleanSize.toLowerCase())
    ? `${cleanName} ${cleanSize}`
    : cleanName
}

type MovementInput = {
  productId: string
  productName: string
  size: string
  sku: string
  category: string
  imageUrl: string
  unitPrice: number
  quantity: number
  comparableQuantity: number
  revenue: number
  warehouseId: string
  warehouseName: string
  unitLabel: string
}

type Location = { warehouseId: string; warehouseName: string }

/**
 * Delivered online orders and completed counter sales inside the window, one row per product.
 *
 * Stock-out transactions are deliberately not a source: every sales stock-out
 * belongs to an order or counter sale already read here, and the rest are
 * expired-stock disposals and replacement remainders, which are not sales.
 */
export function buildProductMovements(
  orders: any[],
  retailSales: any[],
  isInWindow: (date: unknown) => boolean,
  options: {
    /** The product's unit now (Product.unit), as the report's stock column shows it. */
    currentProductUnit?: (productId: string) => unknown
  } = {},
): ProductMovement[] {
  const map = new Map<string, ProductMovement>()

  // Case and pack are only the order format of one bundle, so whole units are
  // labelled in the product's current format, matching its stock. A line's
  // recorded unit is the fallback for a product that no longer has stock.
  const wholeUnits = (productId: string, ...recorded: unknown[]) =>
    wholeUnitLabel(options.currentProductUnit?.(productId)) ||
    recorded.map(wholeUnitLabel).find(Boolean) ||
    'cases'

  const register = (input: MovementInput) => {
    const rawName = String(input.productName || 'Product').trim()
    const key = (input.productId || rawName).toLowerCase().trim()
    if (!key || input.quantity <= 0) return
    const unit = input.unitLabel || 'cases'
    const existing = map.get(key)
    if (existing) {
      existing.totalUnitsSold += input.quantity
      existing.totalComparableUnits += input.comparableQuantity
      existing.totalRevenue += input.revenue
      existing.orderCount += 1
      existing.unitsMap.set(unit, (existing.unitsMap.get(unit) || 0) + input.quantity)
      return
    }
    map.set(key, {
      productId: input.productId,
      productName: formatProductNameWithSize(rawName, input.size),
      rawName,
      size: input.size,
      sku: input.sku || 'N/A',
      category: input.category || 'Beverage',
      imageUrl: input.imageUrl || '',
      unitPrice: input.unitPrice,
      totalUnitsSold: input.quantity,
      totalComparableUnits: input.comparableQuantity,
      totalRevenue: input.revenue,
      orderCount: 1,
      warehouseId: input.warehouseId,
      warehouseName: input.warehouseName,
      unitLabel: unit,
      unitsMap: new Map([[unit, input.quantity]]),
    })
  }

  // Online and counter mixed cases share one shape: `quantity` is the case count,
  // `caseCapacity` the bottles per case, and each component its bottles per case.
  const registerMixedCase = (item: any, location: Location, defaultCategory: string, revenueShare = 1) => {
    const components = Array.isArray(item.components) ? item.components : []
    const caseCount = positive(item.quantity) || 1
    // Counter sales send the total as quantityBaseUnits, online orders as totalBaseUnits.
    const bottles = components.map((comp: any) =>
      positive(comp.totalBaseUnits) || positive(comp.quantityBaseUnits) || positive(comp.quantityPerCase) * caseCount
    )
    const caseCapacity = positive(item.caseCapacity) || bottles.reduce((sum: number, n: number) => sum + n, 0) / caseCount
    components.forEach((comp: any, index: number) => {
      const product = comp.product || {}
      const category = String(product.category?.name || product.category || comp.category || defaultCategory).trim()
      const unitPrice = Number(comp.unitPrice || 0)
      register({
        productId: String(comp.productId || product.id || '').trim(),
        productName: String(comp.productName || product.name || 'Component').trim(),
        size: getItemSize(comp),
        sku: String(comp.productSku || product.sku || '').trim(),
        category,
        imageUrl: String(product.imageUrl || comp.imageUrl || '').trim(),
        unitPrice,
        quantity: bottles[index],
        comparableQuantity: caseCapacity > 0 ? bottles[index] / caseCapacity : 0,
        revenue: (positive(comp.componentSubtotal) || positive(comp.productSubtotal) || bottles[index] * unitPrice) * revenueShare,
        ...location,
        unitLabel: getLooseUnitLabel(comp, category),
      })
    })
  }

  const isMixedCase = (item: any) =>
    String(item.itemType || item.item_type || item.mode || '').toUpperCase() === 'MIXED_CASE' ||
    (Array.isArray(item.components) && item.components.length > 0)

  orders.forEach((order) => {
    // Goods move when delivered, the same point revenue is recognized. Replacement
    // deliveries make good an earlier sale, so they are not sales of their own.
    if (!isRevenueRecognized(order) || !isPrimaryOrderForReporting(order)) return
    if (!isInWindow(order.deliveredAt || order.timeline?.deliveredAt || order.createdAt || order.date)) return

    const location = {
      warehouseId: String(order.warehouseId || order.warehouse_id || order.warehouse?.id || '').trim(),
      warehouseName: String(order.warehouseName || order.warehouse?.name || 'Central Warehouse').trim(),
    }
    // A bulk discount is taken off the whole order; spread it over the lines so
    // product revenue adds up to the order's sales, as the Orders report counts it.
    const goods = Number(order.subtotal)
    const revenueShare = goods > 0 ? getOrderSalesAmount(order) / goods : 1
    const items = Array.isArray(order.items) ? order.items : []
    items.forEach((item: any) => {
      if (isMixedCase(item)) {
        registerMixedCase(item, location, 'Mixed Component', revenueShare)
        return
      }
      const product = item.product || {}
      const unitPrice = Number(item.unitPrice || item.price || product.price || 0)
      const quantity = positive(item.quantity)
      const productId = String(item.productId || product.id || '').trim()
      register({
        productId,
        productName: String(item.productName || product.name || item.name || 'Product').trim(),
        size: getItemSize(item),
        sku: String(product.sku || item.sku || '').trim(),
        category: String(product.category?.name || product.category || item.category || '').trim(),
        imageUrl: String(product.imageUrl || item.imageUrl || '').trim(),
        unitPrice,
        quantity,
        // Online lines are whole cases or packs.
        comparableQuantity: quantity,
        revenue: Number(item.subtotal || quantity * unitPrice) * revenueShare,
        ...location,
        // product.unit is the format now; productUnit is the one recorded at checkout.
        unitLabel: wholeUnits(productId, product.unit, item.productUnit, item.unit),
      })
    })
  })

  retailSales.forEach((sale) => {
    // Only completed counter sales left the shelf; a cancelled one was restocked.
    if (normalizeOrderReportStatus(getRetailSaleStatus(sale)) !== 'DELIVERED') return
    if (!isInWindow(sale.createdAt || sale.date)) return

    const location = {
      warehouseId: String(sale.warehouseId || sale.warehouse?.id || '').trim(),
      warehouseName: String(sale.warehouseName || sale.warehouse?.name || 'Retail Warehouse').trim(),
    }
    const items = Array.isArray(sale.items) ? sale.items : []
    items.forEach((item: any) => {
      if (isMixedCase(item)) {
        registerMixedCase(item, location, 'Retail Mixed Component')
        return
      }
      const category = String(item.category || '').trim()
      const unitPrice = Number(item.unitPrice || 0)
      const quantity = positive(item.quantity)
      // LOOSE lines count bottles; caseCapacity is that product's bottles per case.
      const isLoose = String(item.mode || '').toUpperCase() === 'LOOSE'
      const caseCapacity = positive(item.caseCapacity) || positive(item.quantityPerCase) || positive(item.product?.quantityPerCase)
      const productId = String(item.productId || '').trim()
      register({
        productId,
        productName: String(item.productName || item.name || 'Product').trim(),
        size: getItemSize(item),
        sku: String(item.productSku || item.sku || '').trim(),
        category,
        imageUrl: String(item.imageUrl || '').trim(),
        unitPrice,
        quantity,
        comparableQuantity: isLoose ? (caseCapacity > 0 ? quantity / caseCapacity : 0) : quantity,
        revenue: positive(item.productSubtotal) || quantity * unitPrice,
        ...location,
        // A CASE-mode line sells one of the product's own units: a pack product's is a pack.
        unitLabel: isLoose ? getLooseUnitLabel(item, category) : wholeUnits(productId, item.unit),
      })
    })
  })

  return Array.from(map.values())
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

/** Calendar days, both ends included. */
function inclusiveDays(start: Date, end: Date): number {
  return Math.max(1, Math.round((startOfLocalDay(end) - startOfLocalDay(start)) / DAY_MS) + 1)
}

/**
 * The divisor for daily velocity: how many calendar days the report window
 * covers, matching buildReportDateWindow. An open end of a custom range runs to
 * today; an open start (and All Time) runs from the earliest record.
 */
export function resolveVelocityDays(
  preset: VelocityPeriodPreset,
  dateFrom: string,
  dateTo: string,
  recordDates: unknown[],
  now: Date = new Date(),
): number {
  if (preset === 'today') return 1
  if (preset === '7' || preset === '30' || preset === '90' || preset === '365') return Number(preset)

  const earliestRecord = () => {
    const earliest = recordDates
      .map((value) => new Date(String(value || '')).getTime())
      .filter(Number.isFinite)
      .reduce((min, time) => Math.min(min, time), now.getTime())
    return new Date(earliest)
  }
  if (preset === 'custom') {
    // Days after today have no sales yet, so they must not dilute the average.
    const requestedEnd = parseLocalDate(dateTo)
    const end = requestedEnd && requestedEnd.getTime() < now.getTime() ? requestedEnd : now
    return inclusiveDays(parseLocalDate(dateFrom) || earliestRecord(), end)
  }
  return inclusiveDays(earliestRecord(), now)
}

/**
 * Velocities are ranked unrounded and shown at a fixed precision, so 2.96 reads
 * 3.0 beside 3.4 rather than a bare 3; small ones keep two decimals.
 */
export function formatDailyVelocity(value: number): string {
  if (!(value > 0)) return '0'
  if (value < 0.01) return '<0.01'
  const digits = value < 1 ? 2 : 1
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
