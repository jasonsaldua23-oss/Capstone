'use client'

import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from 'pdf-lib'
import { toast } from 'sonner'

export interface ExportColumn<T = any> {
  header: string
  key?: keyof T | string
  accessor?: (row: T) => string | number
  widthWeight?: number
}

// Convert optional column weights into exact widths without changing unweighted reports.
export function calculateReportColumnWidths<T>(columns: ExportColumn<T>[], availableWidth: number) {
  const weights = columns.map((column) => {
    const value = Number(column.widthWeight || 1)
    return Number.isFinite(value) && value > 0 ? value : 1
  })
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
  return weights.map((weight) => (availableWidth * weight) / totalWeight)
}

// Fix: retain every CSV field in PDF/print, including references and creation dates.
export function cleanReportPdfColumns<T>(_title: string, columns: ExportColumn<T>[]) {
  return columns
}

// Fix: analytics CSV and PDF must derive identical headers and field order.
export function reportColumns(rows: Array<Record<string, unknown>>): ExportColumn<Record<string, unknown>>[] {
  return Object.keys(rows[0] || {}).map((key) => ({
    key,
    header: key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')
      .replace(/^./, (character) => character.toUpperCase()).trim(),
  }))
}

// Fix: resolve and normalize cells once for every export format.
function reportCellValue<T>(column: ExportColumn<T>, row: T): string {
  const value = column.accessor ? column.accessor(row) : column.key ? (row as any)[column.key] : ''
  return String(value ?? '').replace(/\r\n?/g, '\n')
}

function summaryToKpis(summaryLines: string[]) {
  return summaryLines
    .flatMap((line) => String(line).split('|'))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(':')
      return separator > 0
        ? { label: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
        : { label: 'Summary', value: part }
    })
    .slice(0, 5)
}

/**
 * Export rows to clean CSV file with Excel UTF-8 BOM.
 */
export function exportToCsv<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[]
) {
  if (!rows || rows.length === 0) {
    toast.error('No records available to export')
    return
  }

  // Fix: include the same row numbers shown in PDF and print tables.
  const headerLine = ['#', ...columns.map((col) => col.header)].map((header) => `"${header.replace(/"/g, '""')}"`).join(',')
  const dataLines = rows.map((row, rowIndex) => {
    return [`"${rowIndex + 1}"`, ...columns
      .map((col) => {
        // Quoted CSV cells safely preserve the product/component line structure.
        const val = reportCellValue(col, row).replace(/"/g, '""')
        return `"${val}"`
      })]
      .join(',')
  })

  const csvContent = '\uFEFF' + [headerLine, ...dataLines].join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  toast.success(`Exported ${rows.length} records to CSV`)
}

/**
 * Open browser print view with company header and table styling.
 */
export function printReportTable<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summaryLines: string[] = [],
  dateLabel?: string
) {
  if (!rows || rows.length === 0) {
    toast.error('No records available to print')
    return
  }

  // Fix: preserve literal report values when inserting them into the print document.
  const escapeHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  // Print and PDF use the same business-facing columns and proportions.
  const activeColumns = cleanReportPdfColumns(title, columns)
  const tableHeaders = ['#', ...activeColumns.map((column) => column.header)]
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join('')
  const printColumnWidths = calculateReportColumnWidths(activeColumns, 96)
  const tableColumns = [
    '<col style="width:4%">',
    ...printColumnWidths.map((width) => `<col style="width:${width.toFixed(3)}%">`),
  ].join('')
  const kpis = summaryToKpis(summaryLines)
  // Fix: print every filtered record; pagination must not silently discard rows.
  const tableRows = rows
    .map((row, rowIndex) => {
      const cells = activeColumns.map((col) => {
        return `<td>${escapeHtml(reportCellValue(col, row))}</td>`
      })
      return `<tr><td>${rowIndex + 1}</td>${cells.join('')}</tr>`
    })
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; margin: 30px; color: #000; font-size: 12px; }
          .header { margin-bottom: 20px; text-align: center; }
          h1 { margin: 0 0 10px 0; font-size: 25px; color: #000; }
          h2 { margin: 0 0 14px 0; font-size: 18px; color: #000; }
          .subtitle { margin: 0; color: #000; font-size: 11px; }
          /* Fix: wrap long values within the printable width and repeat column headings. */
          @page { size: A4 ${activeColumns.length > 6 ? 'landscape' : 'portrait'}; margin: 12mm; }
          table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
          th, td { border: 1px solid #000; padding: 5px 7px; text-align: left; overflow-wrap: anywhere; vertical-align: top; white-space: pre-line; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          .header, .kpi-strip { break-inside: avoid; }
          th { background: #f3f3f3; font-weight: 700; text-align: center; color: #000; }
          .kpi-strip { display: grid; grid-template-columns: repeat(${Math.max(1, kpis.length)}, 1fr); margin-bottom: 8px; border: 1px solid #000; }
          .kpi { min-height: 52px; padding: 10px 6px; text-align: center; border-right: 1px solid #000; }
          .kpi:last-child { border-right: 0; }
          .kpi-label { display: block; margin-bottom: 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
          .kpi-value { display: block; font-size: 17px; font-weight: 700; }
          @media print {
            body { margin: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Ann Ann's Beverages Trading</h1>
          <h2>${escapeHtml(title)}</h2>
          <p class="subtitle">Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          ${dateLabel ? `<p class="subtitle">Period: ${escapeHtml(dateLabel)}</p>` : ''}
        </div>
        ${kpis.length > 0
          ? `<div class="kpi-strip">${kpis.map((kpi) => `
              <div class="kpi">
                <span class="kpi-label">${escapeHtml(kpi.label)}</span>
                <span class="kpi-value">${escapeHtml(kpi.value)}</span>
              </div>`).join('')}</div>`
          : ''}
        <table>
          <colgroup>${tableColumns}</colgroup>
          <thead>
            <tr>${tableHeaders}</tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
    </html>
  `

  const printWin = window.open('', '_blank')
  if (!printWin) {
    toast.error('Pop-up was blocked. Please allow pop-ups to print reports.')
    return
  }
  printWin.document.open()
  printWin.document.write(html)
  printWin.document.close()
  printWin.focus()
  setTimeout(() => {
    printWin.print()
  }, 250)
}

/**
 * Generate formatted PDF document and trigger download.
 */
export async function exportReportPdf<T>(
  filename: string,
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summaryLines: string[] = [],
  dateLabel?: string
) {
  if (!rows || rows.length === 0) {
    toast.error('No records available to export')
    return
  }

  try {
    const activeCols = cleanReportPdfColumns(title, columns)
    const pdfDoc = await PDFDocument.create()
    const pageWidth = activeCols.length > 6 ? 842 : 595
    const pageHeight = activeCols.length > 6 ? 595 : 842
    let page = pdfDoc.addPage([pageWidth, pageHeight])
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman)
    const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
    const margin = 26
    const contentWidth = pageWidth - margin * 2
    let y = pageHeight - 40
    let pageNumber = 1

    // Standard PDF fonts omit the peso glyph, so draw its visible P and two bars
    // while keeping every exported amount labelled with the requested ₱ symbol.
    const measurePdfText = (value: string, size: number, textFont: PDFFont = font) =>
      Array.from(value).reduce(
        (width, character) => width + textFont.widthOfTextAtSize(character === '₱' ? 'P' : character, size),
        0,
      )
    const drawPdfText = (
      value: string,
      options: { x: number; y: number; size: number; textFont?: PDFFont; color?: RGB },
    ) => {
      const textFont = options.textFont || font
      const color = options.color || rgb(0, 0, 0)
      let cursorX = options.x
      for (const segment of value.split(/(₱)/)) {
        if (!segment) continue
        const printable = segment === '₱' ? 'P' : segment
        page.drawText(printable, { x: cursorX, y: options.y, size: options.size, font: textFont, color })
        const segmentWidth = textFont.widthOfTextAtSize(printable, options.size)
        if (segment === '₱') {
          const thickness = Math.max(0.35, options.size * 0.045)
          for (const offset of [0.42, 0.57]) {
            page.drawLine({
              start: { x: cursorX - 0.4, y: options.y + options.size * offset },
              end: { x: cursorX + segmentWidth + 0.4, y: options.y + options.size * offset },
              thickness,
              color,
            })
          }
        }
        cursorX += segmentWidth
      }
    }

    // Measure real glyph widths, honor explicit product lines, and wrap within cells.
    const wrap = (value: unknown, width: number, size: number, textFont = font) => {
      const source = String(value ?? '').replace(/\r\n?/g, '\n')
      if (!source) return ['']
      const lines: string[] = []
      for (const sourceLine of source.split('\n')) {
        let line = ''
        for (const char of sourceLine) {
          if (line && measurePdfText(line + char, size, textFont) > width) {
            lines.push(line)
            line = ''
          }
          line += char
        }
        lines.push(line)
      }
      return lines
    }
    const centeredX = (value: string, size: number, textFont = fontBold) =>
      (pageWidth - measurePdfText(value, size, textFont)) / 2
    const fitTextSize = (value: string, preferred: number, availableWidth: number, textFont = fontBold) => {
      let size = preferred
      while (size > 7 && measurePdfText(value, size, textFont) > availableWidth) size -= 0.5
      return size
    }
    const drawPageNumber = () => {
      const value = `Page ${pageNumber}`
      page.drawText(value, { x: pageWidth - 30 - font.widthOfTextAtSize(value, 8), y: 30, size: 8, font, color: rgb(0.2, 0.2, 0.2) })
    }
    const nextPage = () => {
      drawPageNumber()
      page = pdfDoc.addPage([pageWidth, pageHeight])
      pageNumber += 1
      y = pageHeight - margin
    }

    const company = "Ann Ann's Beverages Trading"
    page.drawText(company, { x: centeredX(company, 25), y, size: 25, font: fontBold, color: rgb(0, 0, 0) })
    y -= 29
    page.drawText(title, { x: centeredX(title, 18), y, size: 18, font: fontBold, color: rgb(0, 0, 0) })
    y -= 25
    const generated = `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    page.drawText(generated, { x: centeredX(generated, 11, font), y, size: 11, font, color: rgb(0, 0, 0) })
    y -= 20
    if (dateLabel) {
      const period = `Period: ${dateLabel}`
      page.drawText(period, { x: centeredX(period, 9, font), y, size: 9, font, color: rgb(0.1, 0.1, 0.1) })
      y -= 17
    }

    // A single bordered KPI strip replaces scattered summary text.
    const kpis = summaryToKpis(summaryLines)
    if (kpis.length) {
      const kpiHeight = 64
      const kpiWidth = contentWidth / kpis.length
      page.drawRectangle({ x: margin, y: y - kpiHeight, width: contentWidth, height: kpiHeight, borderColor: rgb(0, 0, 0), borderWidth: 0.8 })
      kpis.forEach((kpi, index) => {
        const x = margin + index * kpiWidth
        if (index) page.drawLine({ start: { x, y: y - 8 }, end: { x, y: y - kpiHeight + 8 }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) })
        const label = kpi.label.toUpperCase()
        const labelSize = fitTextSize(label, 8.5, kpiWidth - 10)
        const valueSize = fitTextSize(kpi.value, 17, kpiWidth - 10)
        drawPdfText(label, { x: x + (kpiWidth - measurePdfText(label, labelSize, fontBold)) / 2, y: y - 21, size: labelSize, textFont: fontBold })
        drawPdfText(kpi.value, { x: x + (kpiWidth - measurePdfText(kpi.value, valueSize, fontBold)) / 2, y: y - 47, size: valueSize, textFont: fontBold })
      })
      y -= kpiHeight + 14
    }

    const numberedCols: ExportColumn<T>[] = [{ header: '#', accessor: () => '' }, ...activeCols]
    const numberWidth = 28
    const dataColumnWidths = calculateReportColumnWidths(activeCols, contentWidth - numberWidth)
    const columnWidth = (index: number) => index === 0 ? numberWidth : dataColumnWidths[index - 1]
    const columnX = (index: number) => {
      if (index === 0) return margin
      return margin + numberWidth + dataColumnWidths.slice(0, index - 1).reduce((sum, width) => sum + width, 0)
    }
    const headerLines = numberedCols.map((column, index) => wrap(column.header, columnWidth(index) - 8, 9, fontBold))
    const headerHeight = Math.max(1, ...headerLines.map((lines) => lines.length)) * 10 + 8
    const drawTableHeader = () => {
      numberedCols.forEach((_column, index) => page.drawRectangle({ x: columnX(index), y: y - headerHeight, width: columnWidth(index), height: headerHeight, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0, 0, 0), borderWidth: 0.6 }))
      headerLines.forEach((lines, index) => lines.forEach((line, lineIndex) => {
        drawPdfText(line, { x: columnX(index) + Math.max(4, (columnWidth(index) - measurePdfText(line, 9, fontBold)) / 2), y: y - 12 - lineIndex * 10, size: 9, textFont: fontBold })
      }))
      y -= headerHeight
    }
    if (y < margin + headerHeight + 12) nextPage()
    drawTableHeader()

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      const cellLines = numberedCols.map((column, index) => {
        if (index === 0) return [String(rowIndex + 1)]
        return wrap(reportCellValue(column, row), columnWidth(index) - 10, 8.5)
      })
      const lineCount = Math.max(1, ...cellLines.map((lines) => lines.length))
      let lineOffset = 0
      while (lineOffset < lineCount) {
        const availableLines = Math.floor((y - (margin + 12) - 6) / 10)
        if (availableLines < 1) {
          nextPage()
          drawTableHeader()
          continue
        }
        const linesOnPage = Math.min(lineCount - lineOffset, availableLines)
        const segmentHeight = linesOnPage * 10 + 6
        numberedCols.forEach((_column, index) => page.drawRectangle({ x: columnX(index), y: y - segmentHeight, width: columnWidth(index), height: segmentHeight, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.45 }))
        cellLines.forEach((lines, index) => {
          for (let localIndex = 0; localIndex < linesOnPage; localIndex += 1) {
            const line = lines[lineOffset + localIndex]
            if (line) drawPdfText(line, { x: columnX(index) + 5, y: y - 11 - localIndex * 10, size: 8.5 })
          }
        })
        y -= segmentHeight
        lineOffset += linesOnPage
        if (lineOffset < lineCount) {
          nextPage()
          drawTableHeader()
        }
      }
    }
    drawPageNumber()

    const pdfBytes = await pdfDoc.save()
    const blob = new Blob([pdfBytes as any], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${title} PDF`)
  } catch (err: any) {
    console.error('PDF export failed:', err)
    toast.error('Failed to generate PDF. You can also use the Print/CSV option.')
  }
}
