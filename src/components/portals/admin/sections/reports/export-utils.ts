'use client'

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { toast } from 'sonner'

export interface ExportColumn<T = any> {
  header: string
  key?: keyof T | string
  accessor?: (row: T) => string | number
}

// PDF exports show business-facing fields only. Internal creation timestamps and
// a second identifier that repeats the primary document number add visual noise.
export function cleanReportPdfColumns<T>(title: string, columns: ExportColumn<T>[]) {
  return columns.filter((column) => {
    const header = String(column.header || '').trim()
    if (/^Created (Date|At)$/i.test(header)) return false
    if (/Purchase Orders/i.test(title) && /^(Order|PO) Ref$/i.test(header)) return false
    if (/Purchase Requests/i.test(title) && /^Order Ref$/i.test(header)) return false
    return true
  })
}

function summaryToKpis(summaryLines: string[]) {
  return summaryLines
    .flatMap((line) => String(line).split('|'))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(':')
      return separator > 0
        ? { label: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim().replace(/\u20B1/g, 'PHP ') }
        : { label: 'Summary', value: part.replace(/\u20B1/g, 'PHP ') }
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

  const headerLine = columns.map((col) => `"${col.header.replace(/"/g, '""')}"`).join(',')
  const dataLines = rows.map((row) => {
    return columns
      .map((col) => {
        let val: any = ''
        if (col.accessor) {
          val = col.accessor(row)
        } else if (col.key) {
          val = (row as any)[col.key]
        }
        if (val === null || val === undefined) val = ''
        val = String(val).replace(/\r?\n/g, ' ').replace(/"/g, '""')
        return `"${val}"`
      })
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
  const tableHeaders = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')
  // Fix: print every filtered record; pagination must not silently discard rows.
  const tableRows = rows
    .map((row) => {
      const cells = columns.map((col) => {
        let val: any = ''
        if (col.accessor) {
          val = col.accessor(row)
        } else if (col.key) {
          val = (row as any)[col.key]
        }
        return `<td>${escapeHtml(val)}</td>`
      })
      return `<tr>${cells.join('')}</tr>`
    })
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 30px; color: #1e293b; font-size: 12px; }
          .header { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 16px; }
          h1 { margin: 0 0 4px 0; font-size: 20px; color: #0f172a; }
          .subtitle { margin: 0; color: #64748b; font-size: 12px; }
          /* Fix: wrap long values within the printable width and repeat column headings. */
          @page { size: A4 ${columns.length > 6 ? 'landscape' : 'portrait'}; margin: 12mm; }
          table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 16px; font-size: 11px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          .header, .summary { break-inside: avoid; }
          th { background: #f8fafc; font-weight: 600; color: #334155; }
          tr:nth-child(even) { background: #f8fafc; }
          .summary { margin-top: 20px; padding: 12px; background: #f1f5f9; border-radius: 6px; }
          .summary p { margin: 3px 0; font-weight: 500; font-size: 11px; }
          @media print {
            body { margin: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Ann Ann's Beverages Trading</h1>
          <p class="subtitle"><strong>${escapeHtml(title)}</strong> &bull; Generated: ${new Date().toLocaleString()} ${dateLabel ? `&bull; Period: ${escapeHtml(dateLabel)}` : ''}</p>
        </div>
        <table>
          <thead>
            <tr>${tableHeaders}</tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        ${
          summaryLines.length > 0
            ? `<div class="summary">
                <p><strong>Report Summary:</strong></p>
                ${summaryLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
               </div>`
            : ''
        }
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

    // Measure real glyph widths so values wrap before crossing cell borders.
    const wrap = (value: unknown, width: number, size: number, textFont = font) => {
      const source = String(value ?? '').replace(/\u20B1/g, 'PHP ').replace(/\s+/g, ' ').trim()
      if (!source) return ['']
      const lines: string[] = []
      let line = ''
      for (const char of source) {
        if (line && textFont.widthOfTextAtSize(line + char, size) > width) {
          lines.push(line)
          line = ''
        }
        line += char
      }
      lines.push(line)
      return lines
    }
    const centeredX = (value: string, size: number, textFont = fontBold) =>
      (pageWidth - textFont.widthOfTextAtSize(value, size)) / 2
    const fitTextSize = (value: string, preferred: number, availableWidth: number, textFont = fontBold) => {
      let size = preferred
      while (size > 7 && textFont.widthOfTextAtSize(value, size) > availableWidth) size -= 0.5
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
        page.drawText(label, { x: x + (kpiWidth - fontBold.widthOfTextAtSize(label, labelSize)) / 2, y: y - 21, size: labelSize, font: fontBold, color: rgb(0, 0, 0) })
        page.drawText(kpi.value, { x: x + (kpiWidth - fontBold.widthOfTextAtSize(kpi.value, valueSize)) / 2, y: y - 47, size: valueSize, font: fontBold, color: rgb(0, 0, 0) })
      })
      y -= kpiHeight + 14
    }

    const numberedCols: ExportColumn<T>[] = [{ header: '#', accessor: () => '' }, ...activeCols]
    const numberWidth = 28
    const colWidth = (contentWidth - numberWidth) / activeCols.length
    const columnX = (index: number) => index === 0 ? margin : margin + numberWidth + (index - 1) * colWidth
    const columnWidth = (index: number) => index === 0 ? numberWidth : colWidth
    const headerLines = numberedCols.map((column, index) => wrap(column.header, columnWidth(index) - 8, 9, fontBold))
    const headerHeight = Math.max(1, ...headerLines.map((lines) => lines.length)) * 10 + 8
    const drawTableHeader = () => {
      numberedCols.forEach((_column, index) => page.drawRectangle({ x: columnX(index), y: y - headerHeight, width: columnWidth(index), height: headerHeight, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0, 0, 0), borderWidth: 0.6 }))
      headerLines.forEach((lines, index) => lines.forEach((line, lineIndex) => {
        page.drawText(line, { x: columnX(index) + Math.max(4, (columnWidth(index) - fontBold.widthOfTextAtSize(line, 9)) / 2), y: y - 12 - lineIndex * 10, size: 9, font: fontBold, color: rgb(0, 0, 0) })
      }))
      y -= headerHeight
    }
    if (y < margin + headerHeight + 12) nextPage()
    drawTableHeader()

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      const cellLines = numberedCols.map((column, index) => {
        if (index === 0) return [String(rowIndex + 1)]
        let value: any = ''
        if (column.accessor) value = column.accessor(row)
        else if (column.key) value = (row as any)[column.key]
        return wrap(value, columnWidth(index) - 10, 8.5)
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
            if (line) page.drawText(line, { x: columnX(index) + 5, y: y - 11 - localIndex * 10, size: 8.5, font, color: rgb(0, 0, 0) })
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
