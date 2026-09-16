import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { InventoryMovementSummary } from '@/lib/report-metrics'
import { formatDateTime, formatPeso } from '../shared'

/**
 * PDF export for the admin reports screen.
 *
 * `downloadReportPdf` renders one report to a paginated pdf-lib document. It only
 * needs a few of the screen's derived datasets (the KPI summaries and rows it
 * draws as extra sections), so the screen hands those over as an explicit context
 * instead of the builder closing over the whole component.
 */

export const formatPesoCompact = (value: number) => formatPeso(value).replace(/\.00\b/, '')

// Inventory batch aging is easier to scan with calendar dates only, so time-of-day is intentionally suppressed here.
export function formatReportDateOnly(value: unknown) {
  if (!value) return 'N/A'
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  return parsed.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
}

// Helper to sanitize text for PDF (WinAnsi encoding only supports Latin-1)
const sanitizeForPdf = (text: string): string => {
  return text
    .replace(/\u20B1/g, 'P')
    .replace(/[\u20AC\u00A3\u00A5]/g, '')
}

export type ReportPdfOptions = {
  companyName?: string
  summaryLines?: string[]
  rangeLabel?: string
  extraSections?: Array<{
    title: string
    lines?: string[]
    rows?: Array<Record<string, unknown>>
  }>
}

export type ReportPdfContext = {
  driverPerformanceKpi: { total: number; active: number; avgRating: string; totalTrips: number }
  feedbackExportRows: any[]
  inventoryMovementSummary: InventoryMovementSummary
  replacementRows: any[]
  stockExpiryKpi: { total: number; critical: number; warning: number; expired: number }
  stockExpiryRows: any[]
  transportDriverRows: any[]
  warehouses: any[]
}

export async function downloadReportPdf(
  context: ReportPdfContext,
  filename: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  options?: ReportPdfOptions
) {
  const {
    driverPerformanceKpi,
    feedbackExportRows,
    inventoryMovementSummary,
    replacementRows,
    stockExpiryKpi,
    stockExpiryRows,
    transportDriverRows,
    warehouses,
  } = context
  if (!rows.length) {
    toast.error(`No data to export for ${filename}`)
    return
  }

  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([595, 842])
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
  const companyName = options?.companyName || "Ann Ann's Beverages Trading"
  const pageWidth = 595
  const pageHeight = 842
  const margin = 28
  const usableWidth = pageWidth - margin * 2
  const sanitizedRows = title === 'Inventory Movement Report'
    ? rows.map((row) => {
        const record = row as Record<string, unknown>
        return Object.fromEntries(
          Object.entries(record).filter(([key]) => !/reference/i.test(key))
        )
      })
    : rows
  const lineHeight = 18
  const maxRows = Math.min(sanitizedRows.length, 120)
  const headers = (
    title === 'Inventory Movement Report'
      ? Object.keys(sanitizedRows[0]).filter((header) => !/reference/i.test(header))
      : Object.keys(sanitizedRows[0])
  ).slice(0, 8)
  const colWidth = usableWidth / Math.max(1, headers.length)
  const compactTable = headers.length > 6
  const tableHeaderFontSize = compactTable ? 9 : 10
  const tableBodyFontSize = compactTable ? 8 : 9
  const sectionBodyFontSize = 9
  const summaryFontSize = 10
  const ellipsize = (value: string, maxChars: number) => {
    const sanitized = String(value ?? '').replace(/\u20B1/g, 'PHP ').replace(/\s+/g, ' ').trim()
    if (sanitized.length <= maxChars) return sanitized
    return `${sanitized.slice(0, Math.max(0, maxChars - 3))}...`
  }
  const wrapTextLines = (value: string, maxCharsPerLine: number, maxLines = 2): string[] => {
    const clean = sanitizeForPdf(String(value ?? '').replace(/\s+/g, ' ').trim())
    if (!clean) return ['']
    const words = clean.split(' ')
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (next.length <= maxCharsPerLine) {
        current = next
        continue
      }
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines - 1) break
    }
    if (lines.length < maxLines && current) lines.push(current)
    if (lines.length === 0) lines.push(clean.slice(0, maxCharsPerLine))
    return lines.slice(0, maxLines)
  }
  const drawWrappedCellText = (
    textValue: string,
    x: number,
    yTop: number,
    cellWidth: number,
    cellHeight: number,
    fontSize: number,
    textFont: any,
    textColor: any,
    align: 'left' | 'center' | 'right' = 'left',
    maxLines = 2
  ) => {
    const approxCharWidth = Math.max(4.4, fontSize * 0.5)
    const maxChars = Math.max(6, Math.floor((cellWidth - 10) / approxCharWidth))
    const lines = wrapTextLines(textValue, maxChars, maxLines)
    const lineGap = Math.max(9, fontSize + 1)
    const totalBlockHeight = (lines.length - 1) * lineGap
    let ty = yTop - (cellHeight / 2) - (totalBlockHeight / 2) + 3
    lines.forEach((line) => {
      let tx = x + 4
      if (align === 'center') tx = x + (cellWidth / 2) - (line.length * (fontSize * 0.24))
      if (align === 'right') tx = x + cellWidth - 5 - (line.length * (fontSize * 0.5))
      page.drawText(line, { x: tx, y: ty, size: fontSize, font: textFont, color: textColor })
      ty -= lineGap
    })
  }

  let logoImage: any = null
  try {
    const logoResponse = await fetch('/ann-anns-logo.png')
    if (logoResponse.ok) {
      const logoBytes = await logoResponse.arrayBuffer()
      logoImage = await pdfDoc.embedPng(logoBytes)
    }
  } catch {
    logoImage = null
  }

  const formatHeader = (header: string): string => {
    return header
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim()
      .replace(/_/g, ' ')
  }

  if (title === 'Inventory Movement Report') {
    const w = 595
    const h = 842
    const pad = 24
    const contentW = w - pad * 2
    const navy = rgb(0.08, 0.2, 0.53)
    const blue = rgb(0.13, 0.39, 0.92)
    const green = rgb(0.09, 0.58, 0.29)
    const red = rgb(0.75, 0.1, 0.1)
    const orange = rgb(0.94, 0.45, 0.05)
    const text = rgb(0.12, 0.16, 0.24)
    const muted = rgb(0.42, 0.47, 0.56)

    const drawCell = (
      x: number,
      y: number,
      cw: number,
      ch: number,
      val: string,
      isHeader = false,
      align: 'left' | 'center' | 'right' = 'left',
      color = text,
    ) => {
      page.drawRectangle({
        x,
        y: y - ch,
        width: cw,
        height: ch,
        borderColor: rgb(0.86, 0.89, 0.94),
        borderWidth: 0.6,
        color: isHeader ? rgb(0.95, 0.97, 1) : rgb(1, 1, 1),
      })
      const size = isHeader ? 9.5 : 9
      drawWrappedCellText(
        String(val || ''),
        x,
        y,
        cw,
        ch,
        size,
        isHeader ? boldFont : font,
        color,
        align,
        isHeader ? 1 : 2
      )
    }

    // Header
    if (logoImage) {
      const logoW = 56
      const logoH = (logoImage.height / logoImage.width) * logoW
      page.drawImage(logoImage, { x: pad, y: h - 70, width: logoW, height: logoH })
    }
    page.drawText(companyName, { x: pad + 66, y: h - 36, size: 17.5, font: boldFont, color: navy })
    page.drawText('Inventory Movement Report', { x: pad + 66, y: h - 62, size: 13, font: boldFont, color: navy })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: w - 250, y: h - 34, size: 9.6, font: boldFont, color: text })
    page.drawText(`Date Range: ${options?.rangeLabel || 'All records'}`, { x: w - 250, y: h - 58, size: 9.6, font: boldFont, color: text })
    page.drawLine({ start: { x: pad, y: h - 78 }, end: { x: w - pad, y: h - 78 }, thickness: 1.8, color: navy })

    // KPI cards
    const kpiY = h - 95
    const gap = 12
    const kW = (contentW - gap * 3) / 4
    const kH = 64
    const cards = [
      { title: 'TOTAL MOVEMENTS', value: `${inventoryMovementSummary.totalMovements}`, note: 'All inventory transactions', color: blue, bg: rgb(0.94, 0.97, 1) },
      { title: 'STOCK IN', value: `${inventoryMovementSummary.stockIn}`, note: 'Total units received', color: green, bg: rgb(0.94, 0.99, 0.95) },
      { title: 'STOCK OUT', value: `${inventoryMovementSummary.stockOut}`, note: 'Total units issued', color: red, bg: rgb(1, 0.96, 0.96) },
      { title: 'EXPIRING BATCHES', value: `${stockExpiryKpi.total}`, note: 'Require attention', color: orange, bg: rgb(1, 0.97, 0.93) },
    ]
    cards.forEach((card, i) => {
      const x = pad + i * (kW + gap)
      page.drawRectangle({ x, y: kpiY - kH, width: kW, height: kH, color: card.bg, borderColor: rgb(0.84, 0.88, 0.94), borderWidth: 0.8 })
      page.drawText(card.title, { x: x + 8, y: kpiY - 20, size: 9, font: boldFont, color: card.color })
      page.drawText(sanitizeForPdf(String(card.value || '')), { x: x + 8, y: kpiY - 40, size: 20, font: boldFont, color: card.color })
      page.drawText(card.note, { x: x + 8, y: kpiY - 55, size: 8.5, font, color: muted })
    })

    // Inventory movements section
    let y = kpiY - 86
    page.drawText('INVENTORY MOVEMENTS', { x: pad, y, size: 13, font: boldFont, color: navy })
    y -= 12
    const headers = ['Date & Time', 'Product', 'Type', 'Quantity']
    // Fit table exactly within portrait content width (547px) with enough room for Type/Quantity labels.
    const widths = [150, 220, 90, 87]
    let x = pad
    headers.forEach((hdr, idx) => {
      drawCell(x, y, widths[idx], 22, hdr, true, 'center', rgb(1, 1, 1))
      page.drawRectangle({ x, y: y - 22, width: widths[idx], height: 22, color: navy, borderColor: rgb(0.25, 0.35, 0.62), borderWidth: 0.6 })
      page.drawText(hdr, { x: x + widths[idx] / 2 - hdr.length * 2.1, y: y - 14, size: 9, font: boldFont, color: rgb(1, 1, 1) })
      x += widths[idx]
    })
    y -= 22
    const movementRows = sanitizedRows.slice(0, 12)
    movementRows.forEach((r: any) => {
      const rowH = 28
      const typeRaw = String(r.type || '').toUpperCase()
      const rowVals = [
        formatDateTime(r.createdAt),
        String(r.product || 'N/A'),
        typeRaw,
        String(r.quantity ?? '0'),
      ]
      let cx = pad
      rowVals.forEach((v, idx) => {
        drawCell(cx, y, widths[idx], rowH, v, false, idx === 3 ? 'center' : 'left')
        cx += widths[idx]
      })
      y -= rowH
    })

    // Net movement strip
    const net = Number(inventoryMovementSummary.stockIn || 0) - Number(inventoryMovementSummary.stockOut || 0)
    page.drawRectangle({ x: pad, y: y - 18, width: contentW, height: 18, color: rgb(0.97, 0.98, 1), borderColor: rgb(0.86, 0.89, 0.94), borderWidth: 0.7 })
    page.drawText('Net Movement (IN - OUT):', { x: pad + 170, y: y - 12, size: 10, font: boldFont, color: navy })
    page.drawText(`${net >= 0 ? '+' : ''}${net} units`, { x: pad + 350, y: y - 12, size: 10, font: boldFont, color: net >= 0 ? green : red })
    y -= 30

    // Expiring section
    page.drawText('EXPIRING ITEMS', { x: pad, y, size: 13, font: boldFont, color: orange })
    y -= 10
    const expHeaders = ['Product', 'Batch/Lot No.', 'Expiry Date', 'Days Left', 'Available Qty', 'Status']
    // Fit table exactly within portrait content width (547px).
    const expWidths = [95, 100, 86, 62, 82, 122]
    let ex = pad
    expHeaders.forEach((hdr, idx) => {
      page.drawRectangle({ x: ex, y: y - 20, width: expWidths[idx], height: 20, color: rgb(1, 0.97, 0.94), borderColor: rgb(0.98, 0.83, 0.69), borderWidth: 0.6 })
      page.drawText(hdr, { x: ex + expWidths[idx] / 2 - hdr.length * 2.1, y: y - 13, size: 8.8, font: boldFont, color: text })
      ex += expWidths[idx]
    })
    y -= 20
    const expRows = stockExpiryRows.slice(0, 8)
    expRows.forEach((r: any) => {
      const rowH = 28
      const vals = [
        String(r.product || 'N/A'),
        String(r.batchNumber || 'N/A'),
        String(r.expiryDate || 'N/A'),
        `${String(r.daysUntilExpiry ?? 'N/A')}`,
        `${String(r.quantity ?? 0)} units`,
        String(r.status || 'N/A'),
      ]
      let rx = pad
      vals.forEach((v, idx) => {
        drawCell(rx, y, expWidths[idx], rowH, v, false, idx >= 3 ? 'center' : 'left')
        rx += expWidths[idx]
      })
      y -= rowH
    })

    y -= 10
    page.drawText('NOTES', { x: pad, y, size: 12, font: boldFont, color: navy })
    y -= 15
    page.drawText('Please review expiring items and take appropriate action to minimize waste.', { x: pad, y, size: 9.5, font, color: muted })
    page.drawLine({ start: { x: pad, y: 34 }, end: { x: w - pad, y: 34 }, thickness: 1.2, color: navy })
    page.drawText("Thank you for using Ann Ann's Beverages Trading Inventory System.", { x: pad, y: 20, size: 9, font, color: muted })
    page.drawText('Page 1 of 1', { x: w - pad - 52, y: 20, size: 9, font: boldFont, color: muted })

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return
  }

  if (title === 'Transportation Driver Performance Report') {
    const w = 595
    const h = 842
    const pad = 24
    const contentW = w - pad * 2
    const navy = rgb(0.08, 0.2, 0.53)
    const blue = rgb(0.13, 0.39, 0.92)
    const green = rgb(0.09, 0.58, 0.29)
    const amber = rgb(0.82, 0.55, 0.06)
    const purple = rgb(0.36, 0.21, 0.58)
    const cyan = rgb(0.04, 0.45, 0.62)
    const orange = rgb(0.94, 0.45, 0.05)
    const text = rgb(0.12, 0.16, 0.24)
    const muted = rgb(0.42, 0.47, 0.56)

    const drawCard = (
      x: number,
      y: number,
      width: number,
      titleText: string,
      value: string,
      note: string,
      accent: any,
      bg: any,
    ) => {
      page.drawRectangle({ x, y: y - 64, width, height: 64, color: bg, borderColor: rgb(0.84, 0.88, 0.94), borderWidth: 0.7 })
      page.drawText(titleText, { x: x + 7, y: y - 18, size: 7.7, font: boldFont, color: accent })
      page.drawText(value, { x: x + 7, y: y - 39, size: 18, font: boldFont, color: accent })
      page.drawText(note, { x: x + 7, y: y - 54, size: 8, font, color: muted })
    }

    if (logoImage) {
      const logoW = 52
      const logoH = (logoImage.height / logoImage.width) * logoW
      page.drawImage(logoImage, { x: pad, y: h - 66, width: logoW, height: logoH })
    }
    page.drawText(companyName, { x: pad + 58, y: h - 32, size: 18.5, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
    page.drawText('Transportation Driver Performance Report', { x: pad + 58, y: h - 54, size: 13, font: boldFont, color: navy })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: w - 212, y: h - 36, size: 10, font: boldFont, color: text })
    page.drawText(`Date Range: ${options?.rangeLabel || 'All records'}`, { x: w - 212, y: h - 58, size: 10, font: boldFont, color: text })
    page.drawLine({ start: { x: pad, y: h - 74 }, end: { x: w - pad, y: h - 74 }, thickness: 1.5, color: navy })

    const totalDrivers = String(driverPerformanceKpi.total || 0)
    const activeDrivers = String(driverPerformanceKpi.active || 0)
    const avgRating = String(driverPerformanceKpi.avgRating || '0.0')
    const totalTrips = String(driverPerformanceKpi.totalTrips || 0)
    const delivered = transportDriverRows.reduce((acc, row) => acc + Number(row.deliveredDropPoints || 0), 0)
    const dropTotal = transportDriverRows.reduce((acc, row) => acc + Number(row.dropPointsTotal || 0), 0)
    const deliveredRatio = `${delivered}/${dropTotal || 0}`
    const completionRateValue = dropTotal > 0 ? `${Math.round((delivered / dropTotal) * 100)}%` : '0%'

    const cardsY = h - 96
    const gap = 8
    const cardW = (contentW - gap * 5) / 6
    drawCard(pad + (cardW + gap) * 0, cardsY, cardW, 'TOTAL DRIVERS', totalDrivers, 'All drivers', blue, rgb(0.95, 0.97, 1))
    drawCard(pad + (cardW + gap) * 1, cardsY, cardW, 'ACTIVE DRIVERS', activeDrivers, 'Currently active', green, rgb(0.94, 0.99, 0.95))
    drawCard(pad + (cardW + gap) * 2, cardsY, cardW, 'AVERAGE RATING', avgRating, 'Out of 5', amber, rgb(1, 0.98, 0.93))
    drawCard(pad + (cardW + gap) * 3, cardsY, cardW, 'TOTAL TRIPS', totalTrips, 'All trips', purple, rgb(0.97, 0.95, 1))
    drawCard(pad + (cardW + gap) * 4, cardsY, cardW, 'DELIVERED DROP POINTS', deliveredRatio, 'Total completed', cyan, rgb(0.94, 0.98, 1))
    drawCard(pad + (cardW + gap) * 5, cardsY, cardW, 'COMPLETION RATE', completionRateValue, 'Overall rate', orange, rgb(1, 0.97, 0.93))

    let y = cardsY - 94
    page.drawText('DRIVER PERFORMANCE', { x: pad, y, size: 12.5, font: boldFont, color: navy })
    y -= 12

    const headers = ['Driver Name', 'Rating', 'Total Trips', 'Delivered Drop Points', 'Completion Rate', 'Status']
    const widths = [106, 56, 68, 112, 96, 109]
    let x = pad
    headers.forEach((hdr, idx) => {
      page.drawRectangle({ x, y: y - 22, width: widths[idx], height: 22, color: navy, borderColor: rgb(0.25, 0.35, 0.62), borderWidth: 0.6 })
      page.drawText(hdr, { x: x + widths[idx] / 2 - hdr.length * 2.0, y: y - 14, size: 8.6, font: boldFont, color: rgb(1, 1, 1) })
      x += widths[idx]
    })
    y -= 22

    sanitizedRows.slice(0, 16).forEach((row: any) => {
      const rowH = 30
      const vals = [
        String(row.driverName || 'N/A'),
        String(row.rating || 'N/A'),
        String(row.totalTrips || '0'),
        String(row.deliveredDropPoints || '0/0'),
        String(row.completionRate || '0%'),
        String(row.status || 'N/A'),
      ]
      let cx = pad
      vals.forEach((v, idx) => {
        page.drawRectangle({
          x: cx,
          y: y - rowH,
          width: widths[idx],
          height: rowH,
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 0.6,
          color: rgb(1, 1, 1),
        })
        const textVal = String(v || '')
        const color = idx === 6 && String(v).toUpperCase() === 'ACTIVE' ? green : text
        drawWrappedCellText(
          textVal,
          cx,
          y,
          widths[idx],
          rowH,
          8.5,
          idx === 6 ? boldFont : font,
          color,
          idx === 0 ? 'left' : 'center',
          2
        )
        cx += widths[idx]
      })
      y -= rowH
    })

    page.drawLine({ start: { x: pad, y: 34 }, end: { x: w - pad, y: 34 }, thickness: 1.2, color: navy })
    page.drawText('Thank you for your dedication and hard work.', { x: pad, y: 20, size: 9, font, color: muted })
    page.drawText('Page 1 of 1', { x: w - pad - 52, y: 20, size: 9, font: boldFont, color: muted })

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return
  }

  if (title === 'Warehouse Utilization Report') {
    const w = 595
    const h = 842
    const pad = 24
    const contentW = w - pad * 2
    const navy = rgb(0.08, 0.2, 0.53)
    const blue = rgb(0.13, 0.39, 0.92)
    const green = rgb(0.09, 0.58, 0.29)
    const orange = rgb(0.94, 0.45, 0.05)
    const purple = rgb(0.36, 0.21, 0.58)
    const text = rgb(0.12, 0.16, 0.24)
    const muted = rgb(0.42, 0.47, 0.56)

    if (logoImage) {
      const logoW = 52
      const logoH = (logoImage.height / logoImage.width) * logoW
      page.drawImage(logoImage, { x: pad, y: h - 66, width: logoW, height: logoH })
    }
    page.drawText(companyName, { x: pad + 58, y: h - 32, size: 18.5, font: boldFont, color: navy })
    page.drawText('Warehouse Utilization Report', { x: pad + 58, y: h - 54, size: 13, font: boldFont, color: navy })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: w - 212, y: h - 36, size: 10, font: boldFont, color: text })
    page.drawText(`Date Range: ${options?.rangeLabel || 'All records'}`, { x: w - 212, y: h - 58, size: 10, font: boldFont, color: text })
    page.drawLine({ start: { x: pad, y: h - 74 }, end: { x: w - pad, y: h - 74 }, thickness: 1.5, color: navy })

    const cardY = h - 96
    const gap = 12
    const cardW = (contentW - gap * 3) / 4
    const cardH = 64
    const totalWarehouses = warehouses.length
    const dataPoints = sanitizedRows.length
    const latest = sanitizedRows[sanitizedRows.length - 1] as any
    const currentUsed = Number(String(latest?.usedUnits || '0').replace(/,/g, '')) || 0
    const currentCapacity = Number(String(latest?.totalCapacity || '0').replace(/,/g, '')) || 0
    const currentUtil = currentCapacity > 0 ? ((currentUsed / currentCapacity) * 100) : 0
    const peakRow = sanitizedRows.reduce((best: any, row: any) => {
      const pct = Number(String(row?.utilizationPercent || '0').replace('%', '').trim()) || 0
      return !best || pct > best.pct ? { row, pct } : best
    }, null as any)

    const cards = [
      { title: 'WAREHOUSE', value: totalWarehouses === 1 ? 'REGISTERED' : 'SETUP REQUIRED', note: 'Single warehouse', accent: blue, bg: rgb(0.95, 0.97, 1) },
      { title: 'DATA POINTS', value: `${dataPoints}`, note: 'Utilization snapshots', accent: green, bg: rgb(0.94, 0.99, 0.95) },
      { title: 'CURRENT USAGE', value: `${currentUsed.toLocaleString()} / ${currentCapacity.toLocaleString()}`, note: `${currentUtil.toFixed(1)}% utilized`, accent: orange, bg: rgb(1, 0.97, 0.93) },
      { title: 'PEAK UTILIZATION', value: `${Number(peakRow?.pct || 0).toFixed(1)}%`, note: String(peakRow?.row?.date || 'N/A'), accent: purple, bg: rgb(0.97, 0.95, 1) },
    ]
    cards.forEach((card, i) => {
      const x = pad + i * (cardW + gap)
      page.drawRectangle({ x, y: cardY - cardH, width: cardW, height: cardH, color: card.bg, borderColor: rgb(0.84, 0.88, 0.94), borderWidth: 0.7 })
      page.drawText(card.title, { x: x + 8, y: cardY - 18, size: 8.5, font: boldFont, color: card.accent })
      page.drawText(sanitizeForPdf(String(card.value || '')), { x: x + 8, y: cardY - 39, size: 16.5, font: boldFont, color: card.accent })
      page.drawText(card.note, { x: x + 8, y: cardY - 54, size: 8, font, color: muted })
    })

    let y = cardY - 94
    page.drawText('WAREHOUSE UTILIZATION', { x: pad, y, size: 12.5, font: boldFont, color: navy })
    y -= 12

    const headers = ['Date', 'Used Units', 'Total Capacity', 'Remaining Capacity', 'Utilization Percent']
    const widths = [104, 104, 104, 112, 127]
    let x = pad
    headers.forEach((hdr, idx) => {
      page.drawRectangle({ x, y: y - 22, width: widths[idx], height: 22, color: navy, borderColor: rgb(0.25, 0.35, 0.62), borderWidth: 0.6 })
      page.drawText(hdr, { x: x + widths[idx] / 2 - hdr.length * 2.1, y: y - 14, size: 8.8, font: boldFont, color: rgb(1, 1, 1) })
      x += widths[idx]
    })
    y -= 22

    sanitizedRows.slice(0, 20).forEach((row: any) => {
      const rowH = 30
      const vals = [
        String(row.date || 'N/A'),
        String(row.usedUnits || '0'),
        String(row.totalCapacity || '0'),
        String(row.remainingCapacity || '0'),
        String(row.utilizationPercent || '0%'),
      ]
      let cx = pad
      vals.forEach((v, idx) => {
        page.drawRectangle({
          x: cx,
          y: y - rowH,
          width: widths[idx],
          height: rowH,
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 0.6,
          color: rgb(1, 1, 1),
        })
        drawWrappedCellText(String(v || ''), cx, y, widths[idx], rowH, 8.5, font, text, idx === 0 ? 'left' : 'center', 2)
        cx += widths[idx]
      })
      y -= rowH
    })

    page.drawLine({ start: { x: pad, y: 34 }, end: { x: w - pad, y: 34 }, thickness: 1.2, color: navy })
    page.drawText("Thank you for using Ann Ann's Beverages Trading Inventory System.", { x: pad, y: 20, size: 9, font, color: muted })
    page.drawText('Page 1 of 1', { x: w - pad - 52, y: 20, size: 9, font: boldFont, color: muted })

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return
  }

  if (title === 'Replacement Handling Report') {
    const w = 595
    const h = 842
    const pad = 24
    const contentW = w - pad * 2
    const navy = rgb(0.08, 0.2, 0.53)
    const blue = rgb(0.13, 0.39, 0.92)
    const green = rgb(0.09, 0.58, 0.29)
    const orange = rgb(0.94, 0.45, 0.05)
    const red = rgb(0.82, 0.1, 0.1)
    const text = rgb(0.12, 0.16, 0.24)
    const muted = rgb(0.42, 0.47, 0.56)

    if (logoImage) {
      const logoW = 52
      const logoH = (logoImage.height / logoImage.width) * logoW
      page.drawImage(logoImage, { x: pad, y: h - 66, width: logoW, height: logoH })
    }
    page.drawText(companyName, { x: pad + 58, y: h - 32, size: 18.5, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
    page.drawText('Replacement Handling Report', { x: pad + 58, y: h - 54, size: 13, font: boldFont, color: navy })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: w - 212, y: h - 36, size: 10, font: boldFont, color: text })
    page.drawText(`Date Range: ${options?.rangeLabel || 'All records'}`, { x: w - 212, y: h - 58, size: 10, font: boldFont, color: text })
    page.drawLine({ start: { x: pad, y: h - 74 }, end: { x: w - pad, y: h - 74 }, thickness: 1.5, color: navy })

    const totalCases = replacementRows.length
    const completedCases = replacementRows.filter((row: any) => ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(String(row?.status || '').toUpperCase())).length
    const openCases = replacementRows.filter((row: any) => ['REPORTED', 'IN_PROGRESS', 'NEEDS_FOLLOW_UP', 'PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(String(row?.status || '').toUpperCase())).length
    const totalLoss = replacementRows.reduce((sum: number, row: any) => sum + (Number(row?.totalLoss || 0) || 0), 0)

    const cardY = h - 96
    const gap = 12
    const cardW = (contentW - gap * 3) / 4
    const cardH = 64
    const cards = [
      { title: 'TOTAL CASES', value: `${totalCases}`, note: 'All replacement cases', accent: blue, bg: rgb(0.95, 0.97, 1) },
      { title: 'COMPLETED', value: `${completedCases}`, note: 'Resolved cases', accent: green, bg: rgb(0.94, 0.99, 0.95) },
      { title: 'OPEN CASES', value: `${openCases}`, note: 'Pending / in progress', accent: orange, bg: rgb(1, 0.97, 0.93) },
      { title: 'TOTAL LOSS', value: `- ${formatPesoCompact(Math.max(0, totalLoss))}`, note: 'Estimated value loss', accent: red, bg: rgb(1, 0.95, 0.96) },
    ]
    cards.forEach((card, i) => {
      const x = pad + i * (cardW + gap)
      page.drawRectangle({ x, y: cardY - cardH, width: cardW, height: cardH, color: card.bg, borderColor: rgb(0.84, 0.88, 0.94), borderWidth: 0.7 })
      page.drawText(card.title, { x: x + 8, y: cardY - 18, size: 8.5, font: boldFont, color: card.accent })
      page.drawText(sanitizeForPdf(String(card.value || '')), { x: x + 8, y: cardY - 39, size: 16.5, font: boldFont, color: card.accent })
      page.drawText(card.note, { x: x + 8, y: cardY - 54, size: 8, font, color: muted })
    })

    let y = cardY - 94
    page.drawText('REPLACEMENT CASES', { x: pad, y, size: 12.5, font: boldFont, color: navy })
    y -= 12

    const headers = ['Replacement #', 'Order #', 'Customer', 'Assigned Driver', 'Status', 'Total Loss', 'Reason', 'Created At']
    const widths = [72, 66, 64, 74, 62, 58, 74, 77]
    let x = pad
    headers.forEach((hdr, idx) => {
      page.drawRectangle({ x, y: y - 22, width: widths[idx], height: 22, color: navy, borderColor: rgb(0.25, 0.35, 0.62), borderWidth: 0.6 })
      page.drawText(hdr, { x: x + widths[idx] / 2 - hdr.length * 2.0, y: y - 14, size: 7.9, font: boldFont, color: rgb(1, 1, 1) })
      x += widths[idx]
    })
    y -= 22

    sanitizedRows.slice(0, 18).forEach((row: any) => {
      const rowH = 30
      const rawStatus = String(row.status || '').toUpperCase()
      const vals = [
        String(row.replacementNumber || 'N/A'),
        String(row.orderNumber || 'N/A'),
        String(row.customer || 'N/A'),
        String(row.assignedDriver || 'N/A'),
        rawStatus || 'N/A',
        `- ${formatPesoCompact(Math.max(0, Number(row.totalLoss || 0)))}`,
        String(row.reason || 'N/A'),
        String(formatReportDateOnly(row.createdAt) || 'N/A'),
      ]
      let cx = pad
      vals.forEach((v, idx) => {
        page.drawRectangle({
          x: cx,
          y: y - rowH,
          width: widths[idx],
          height: rowH,
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 0.6,
          color: rgb(1, 1, 1),
        })
        const val = String(v || '')
        const statusColor =
          idx === 4
            ? (rawStatus.includes('COMPLETE') || rawStatus.includes('RESOLVED') ? green : rawStatus.includes('REJECT') ? red : blue)
            : idx === 5
              ? red
            : text
        drawWrappedCellText(
          val,
          cx,
          y,
          widths[idx],
          rowH,
          8.2,
          idx === 4 ? boldFont : font,
          statusColor,
          idx === 5 ? 'center' : 'left',
          2
        )
        cx += widths[idx]
      })
      y -= rowH
    })

    page.drawLine({ start: { x: pad, y: 34 }, end: { x: w - pad, y: 34 }, thickness: 1.2, color: navy })
    page.drawText("Thank you for using Ann Ann's Beverages Trading Inventory System.", { x: pad, y: 20, size: 9, font, color: muted })
    page.drawText('Page 1 of 1', { x: w - pad - 52, y: 20, size: 9, font: boldFont, color: muted })

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return
  }

  if (title === 'Client Feedback & Service Evaluation Report') {
    const w = 595
    const h = 842
    const pad = 24
    const contentW = w - pad * 2
    const navy = rgb(0.08, 0.2, 0.53)
    const blue = rgb(0.13, 0.39, 0.92)
    const green = rgb(0.09, 0.58, 0.29)
    const purple = rgb(0.36, 0.21, 0.58)
    const red = rgb(0.9, 0.2, 0.2)
    const text = rgb(0.12, 0.16, 0.24)
    const muted = rgb(0.42, 0.47, 0.56)

    if (logoImage) {
      const logoW = 52
      const logoH = (logoImage.height / logoImage.width) * logoW
      page.drawImage(logoImage, { x: pad, y: h - 66, width: logoW, height: logoH })
    }
    page.drawText(companyName, { x: pad + 58, y: h - 32, size: 18.5, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
    page.drawText('Client Feedback & Service Evaluation Report', { x: pad + 58, y: h - 54, size: 13, font: boldFont, color: navy })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: w - 212, y: h - 36, size: 10, font: boldFont, color: text })
    page.drawText(`Date Range: ${options?.rangeLabel || 'All records'}`, { x: w - 212, y: h - 58, size: 10, font: boldFont, color: text })
    page.drawLine({ start: { x: pad, y: h - 74 }, end: { x: w - pad, y: h - 74 }, thickness: 1.5, color: navy })

    const totalFeedback = feedbackExportRows.length
    const avgRating = totalFeedback > 0
      ? feedbackExportRows.reduce((sum: number, row: any) => sum + (Number(row?.rating || 0) || 0), 0) / totalFeedback
      : 0
    const compliments = feedbackExportRows.filter((row: any) => String(row?.type || '').toUpperCase().includes('COMPLIMENT')).length
    const complaints = feedbackExportRows.filter((row: any) => String(row?.type || '').toUpperCase().includes('COMPLAINT')).length

    const cardY = h - 96
    const gap = 12
    const cardW = (contentW - gap * 3) / 4
    const cardH = 64
    const cards = [
      { title: 'TOTAL FEEDBACK', value: `${totalFeedback}`, note: 'All feedback received', accent: blue, bg: rgb(0.95, 0.97, 1) },
      { title: 'AVERAGE RATING', value: `${avgRating.toFixed(2)}`, note: 'Out of 5', accent: green, bg: rgb(0.94, 0.99, 0.95) },
      { title: 'COMPLIMENTS', value: `${compliments}`, note: 'Positive feedback', accent: purple, bg: rgb(0.97, 0.95, 1) },
      { title: 'COMPLAINTS', value: `${complaints}`, note: 'Requires attention', accent: red, bg: rgb(1, 0.95, 0.96) },
    ]
    cards.forEach((card, i) => {
      const x = pad + i * (cardW + gap)
      page.drawRectangle({ x, y: cardY - cardH, width: cardW, height: cardH, color: card.bg, borderColor: rgb(0.84, 0.88, 0.94), borderWidth: 0.7 })
      page.drawText(card.title, { x: x + 8, y: cardY - 18, size: 8.5, font: boldFont, color: card.accent })
      page.drawText(sanitizeForPdf(String(card.value || '')), { x: x + 8, y: cardY - 39, size: 16.5, font: boldFont, color: card.accent })
      page.drawText(card.note, { x: x + 8, y: cardY - 54, size: 8, font, color: muted })
    })

    let y = cardY - 94
    page.drawText('FEEDBACK DETAILS', { x: pad, y, size: 12.5, font: boldFont, color: navy })
    y -= 12

    const headers = ['Created At', 'Customer', 'Driver', 'Type', 'Rating']
    const widths = [104, 106, 100, 108, 129]
    let x = pad
    headers.forEach((hdr, idx) => {
      page.drawRectangle({ x, y: y - 22, width: widths[idx], height: 22, color: navy, borderColor: rgb(0.25, 0.35, 0.62), borderWidth: 0.6 })
      page.drawText(hdr, { x: x + widths[idx] / 2 - hdr.length * 2.1, y: y - 14, size: 8.8, font: boldFont, color: rgb(1, 1, 1) })
      x += widths[idx]
    })
    y -= 22

    feedbackExportRows.slice(0, 18).forEach((row: any) => {
      const rowH = 30
      const typeRaw = String(row?.type || '').toUpperCase()
      const ratingNum = Math.max(0, Math.min(5, Number(row?.rating || 0) || 0))
      const vals = [
        String(row.createdAt || 'N/A'),
        String(row.customer || 'N/A'),
        String(row.driver || 'N/A'),
        typeRaw || 'N/A',
        String(ratingNum || 'N/A'),
      ]

      let cx = pad
      vals.forEach((v, idx) => {
        page.drawRectangle({
          x: cx,
          y: y - rowH,
          width: widths[idx],
          height: rowH,
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 0.6,
          color: rgb(1, 1, 1),
        })
        if (idx === 4 && Number.isFinite(ratingNum)) {
          // Fix: standard PDF fonts cannot encode Unicode stars, so use WinAnsi-safe rating marks.
          const ratingSlots = '*****'
          const filledRating = '*'.repeat(ratingNum)
          page.drawText(ratingSlots, { x: cx + 8, y: y - 14, size: 10, font, color: rgb(0.82, 0.84, 0.87) })
          page.drawText(filledRating, { x: cx + 8, y: y - 14, size: 10, font: boldFont, color: typeRaw.includes('COMPLIMENT') ? green : red })
          page.drawText(String(ratingNum), { x: cx + widths[idx] - 14, y: y - 14, size: 8.8, font: boldFont, color: text })
        } else {
          const val = String(v || '')
          const typeColor = idx === 3 ? (typeRaw.includes('COMPLIMENT') ? green : red) : text
          drawWrappedCellText(val, cx, y, widths[idx], rowH, 8.3, idx === 3 ? boldFont : font, typeColor, 'left', 2)
        }
        cx += widths[idx]
      })
      y -= rowH
    })

    page.drawLine({ start: { x: pad, y: 34 }, end: { x: w - pad, y: 34 }, thickness: 1.2, color: navy })
    page.drawText("Thank you for using Ann Ann's Beverages Trading System.", { x: pad, y: 20, size: 9, font, color: muted })
    page.drawText('Page 1 of 1', { x: w - pad - 52, y: 20, size: 9, font: boldFont, color: muted })

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return
  }

  if (title === 'Order Report') {
    const w = 595
    const h = 842
    const pad = 24
    const contentW = w - pad * 2
    const navy = rgb(0.08, 0.2, 0.53)
    const green = rgb(0.09, 0.58, 0.29)
    const red = rgb(0.9, 0.2, 0.2)
    const text = rgb(0.12, 0.16, 0.24)
    const muted = rgb(0.42, 0.47, 0.56)

    if (logoImage) {
      const logoW = 52
      const logoH = (logoImage.height / logoImage.width) * logoW
      page.drawImage(logoImage, { x: pad, y: h - 66, width: logoW, height: logoH })
    }
    page.drawText(companyName, { x: pad + 58, y: h - 32, size: 18.5, font: boldFont, color: rgb(0.05, 0.05, 0.05) })
    page.drawText('Order Report', { x: pad + 58, y: h - 54, size: 13, font: boldFont, color: navy })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, { x: w - 212, y: h - 36, size: 10, font: boldFont, color: text })
    page.drawText(`Date Range: ${options?.rangeLabel || 'All records'}`, { x: w - 212, y: h - 58, size: 10, font: boldFont, color: text })
    page.drawLine({ start: { x: pad, y: h - 74 }, end: { x: w - pad, y: h - 74 }, thickness: 1.5, color: navy })

    let y = h - 118
    page.drawText('ORDER DETAILS', { x: pad, y, size: 12.5, font: boldFont, color: navy })
    y -= 12

    const headers = ['Order Number', 'Customer', 'Item Summary', 'Total Quantity', 'Order Date', 'Order Status', 'Total Amount']
    const widths = [82, 92, 86, 76, 82, 78, 71]
    let x = pad
    headers.forEach((hdr, idx) => {
      page.drawRectangle({ x, y: y - 22, width: widths[idx], height: 22, color: navy, borderColor: rgb(0.25, 0.35, 0.62), borderWidth: 0.6 })
      page.drawText(hdr, { x: x + widths[idx] / 2 - hdr.length * 2.0, y: y - 14, size: 8.4, font: boldFont, color: rgb(1, 1, 1) })
      x += widths[idx]
    })
    y -= 22

    sanitizedRows.slice(0, 22).forEach((row: any) => {
      const rowH = 30
      const rawStatus = String(row.orderStatus || row.status || '').toUpperCase()
      const vals = [
        String(row.orderNumber || 'N/A'),
        String(row.customer || 'N/A'),
        String(row.productNameWithSize || row.itemSummary || 'N/A'),
        String(row.totalQuantity ?? '0'),
        String(row.orderDate || row.createdAt || 'N/A'),
        rawStatus || 'N/A',
        String(row.totalAmount || '0'),
      ]
      let cx = pad
      vals.forEach((v, idx) => {
        page.drawRectangle({
          x: cx,
          y: y - rowH,
          width: widths[idx],
          height: rowH,
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 0.6,
          color: rgb(1, 1, 1),
        })
        const val = String(v || '')
        if (idx === 2) {
          drawWrappedCellText(String(v || ''), cx, y, widths[idx], rowH, 8.3, font, text, 'left', 1)
          drawWrappedCellText(String(row.productCategory || 'Uncategorized'), cx, y - 11, widths[idx], rowH, 7.6, font, muted, 'left', 1)
        } else if (idx === 5) {
          const isDelivered = rawStatus.includes('DELIVERED')
          const isCancelled = rawStatus.includes('CANCEL') || rawStatus.includes('REJECT')
          const statusColor = isDelivered ? green : isCancelled ? red : navy
          drawWrappedCellText(val, cx, y, widths[idx], rowH, 8.2, boldFont, statusColor, 'left', 2)
        } else {
          drawWrappedCellText(val, cx, y, widths[idx], rowH, 8.3, font, text, 'left', 2)
        }
        cx += widths[idx]
      })
      y -= rowH
    })

    page.drawLine({ start: { x: pad, y: 34 }, end: { x: w - pad, y: 34 }, thickness: 1.2, color: navy })
    page.drawText("Thank you for using Ann Ann's Beverages Trading System.", { x: pad, y: 20, size: 9, font, color: muted })
    page.drawText('Page 1 of 1', { x: w - pad - 52, y: 20, size: 9, font: boldFont, color: muted })

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return
  }

  const drawHeader = (heading: string) => {
    if (logoImage) {
      const logoWidth = 45
      const logoHeight = (logoImage.height / logoImage.width) * logoWidth
      page.drawImage(logoImage, {
        x: margin,
        y: 535,
        width: logoWidth,
        height: logoHeight,
      })
    }
    page.drawText(companyName, { x: margin + 55, y: 550, size: 18, font: boldFont, color: rgb(0.08, 0.08, 0.08) })
    page.drawText(heading, { x: margin, y: 520, size: 16, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, {
      x: margin, y: 500, size: summaryFontSize, font, color: rgb(0.3, 0.3, 0.3),
    })
    if (options?.rangeLabel) {
      page.drawText(`Date Range: ${options.rangeLabel}`, {
        x: margin, y: 487, size: summaryFontSize, font, color: rgb(0.3, 0.3, 0.3),
      })
    }
  }

  drawHeader(title)
  let y = 468
  headers.forEach((header, index) => {
    page.drawText(formatHeader(header), { x: margin + index * colWidth, y, size: tableHeaderFontSize, font: boldFont, color: rgb(0.1, 0.1, 0.1), maxWidth: colWidth - 10 })
  })
  y -= lineHeight

  for (let i = 0; i < maxRows; i += 1) {
    const row = sanitizedRows[i]
    headers.forEach((header, index) => {
      const rawValue = String(row[header] ?? '')
      const approxCharWidth = tableBodyFontSize <= 8 ? 4.5 : 5.1
      drawWrappedCellText(
        rawValue,
        margin + index * colWidth,
        y + 7,
        colWidth,
        20,
        tableBodyFontSize,
        font,
        rgb(0.18, 0.18, 0.18),
        'left',
        2
      )
    })
    y -= 22
    if (y < 95) break
  }

  y -= 10
  const summaryLines = options?.summaryLines && options.summaryLines.length > 0
    ? options.summaryLines
    : [`Total records: ${sanitizedRows.length}`]
  summaryLines.forEach((line) => {
    page.drawText(sanitizeForPdf(line), { x: margin, y, size: summaryFontSize, font, color: rgb(0.3, 0.3, 0.3) })
    y -= 14
  })

  const extraSections = options?.extraSections || []
  for (const section of extraSections) {
    page = pdfDoc.addPage([595, 842])
    drawHeader(`${title} - ${section.title}`)
    let sectionY = 470

    const sectionLines = section.lines || []
    sectionLines.forEach((line) => {
      page.drawText(sanitizeForPdf(line), { x: margin, y: sectionY, size: summaryFontSize, font, color: rgb(0.22, 0.22, 0.22) })
      sectionY -= 14
    })

    const sectionRows = section.rows || []
    if (sectionRows.length > 0) {
      sectionY -= 8
      const sectionHeaders = Object.keys(sectionRows[0]).slice(0, 6)
      const sectionColWidth = usableWidth / Math.max(1, sectionHeaders.length)
      sectionHeaders.forEach((header, index) => {
        page.drawText(formatHeader(header), {
          x: margin + index * sectionColWidth,
          y: sectionY,
          size: tableHeaderFontSize,
          font: boldFont,
          color: rgb(0.1, 0.1, 0.1),
          maxWidth: sectionColWidth - 10,
        })
      })
      sectionY -= lineHeight
      for (let rowIndex = 0; rowIndex < Math.min(sectionRows.length, 24); rowIndex += 1) {
        const row = sectionRows[rowIndex]
        sectionHeaders.forEach((header, index) => {
          const rawValue = String(row[header] ?? '')
          drawWrappedCellText(
            rawValue,
            margin + index * sectionColWidth,
            sectionY + 7,
            sectionColWidth,
            20,
            sectionBodyFontSize,
            font,
            rgb(0.18, 0.18, 0.18),
            'left',
            2
          )
        })
        sectionY -= 22
        if (sectionY < 60) break
      }
    }
  }

  const bytes = await pdfDoc.save()
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
