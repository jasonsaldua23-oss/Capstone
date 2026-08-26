'use client'

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { toast } from 'sonner'
import { formatPeso } from '../shared'

export interface ExportColumn<T = any> {
  header: string
  key?: keyof T | string
  accessor?: (row: T) => string | number
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

  const tableHeaders = columns.map((c) => `<th>${c.header}</th>`).join('')
  const tableRows = rows
    .slice(0, 500)
    .map((row) => {
      const cells = columns.map((col) => {
        let val: any = ''
        if (col.accessor) {
          val = col.accessor(row)
        } else if (col.key) {
          val = (row as any)[col.key]
        }
        return `<td>${String(val ?? '').replace(/</g, '&lt;')}</td>`
      })
      return `<tr>${cells.join('')}</tr>`
    })
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 30px; color: #1e293b; font-size: 12px; }
          .header { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 16px; }
          h1 { margin: 0 0 4px 0; font-size: 20px; color: #0f172a; }
          .subtitle { margin: 0; color: #64748b; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 11px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
          th { background: #f8fafc; font-weight: 600; color: #334155; }
          tr:nth-child(even) { background: #f8fafc; }
          .summary { margin-top: 20px; padding: 12px; background: #f1f5f9; border-radius: 6px; }
          .summary p { margin: 3px 0; font-weight: 500; font-size: 11px; }
          @media print {
            body { margin: 15px; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Ann Ann's Beverages Trading</h1>
          <p class="subtitle"><strong>${title}</strong> &bull; Generated: ${new Date().toLocaleString()} ${dateLabel ? `&bull; Period: ${dateLabel}` : ''}</p>
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
                ${summaryLines.map((line) => `<p>${line}</p>`).join('')}
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
    const pdfDoc = await PDFDocument.create()
    let page = pdfDoc.addPage([595, 842]) // A4 portrait
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const margin = 30
    const pageWidth = 595
    let y = 842 - margin

    // Header
    page.drawText("Ann Ann's Beverages Trading", {
      x: margin,
      y,
      size: 14,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    })
    y -= 16

    page.drawText(title, {
      x: margin,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.15, 0.35, 0.75),
    })
    y -= 14

    const metaText = `Generated: ${new Date().toLocaleDateString()} ${dateLabel ? `| Period: ${dateLabel}` : ''}`
    page.drawText(metaText, {
      x: margin,
      y,
      size: 8,
      font,
      color: rgb(0.4, 0.45, 0.55),
    })
    y -= 18

    // Summary lines
    if (summaryLines.length > 0) {
      summaryLines.slice(0, 3).forEach((line) => {
        // Fix: standard PDF fonts use WinAnsi, which cannot encode the Philippine peso symbol.
        const pdfSafeLine = line.replace(/\u20B1/g, 'PHP ')
        page.drawText(pdfSafeLine, {
          x: margin,
          y,
          size: 8,
          font: fontBold,
          color: rgb(0.2, 0.25, 0.35),
        })
        y -= 12
      })
      y -= 8
    }

    // Table
    const activeCols = columns.slice(0, 6) // Max 6 columns in PDF
    const colWidth = (pageWidth - margin * 2) / activeCols.length

    // Table header row
    activeCols.forEach((col, idx) => {
      page.drawText(col.header.slice(0, 16), {
        x: margin + idx * colWidth,
        y,
        size: 8,
        font: fontBold,
        color: rgb(0.1, 0.15, 0.25),
      })
    })
    y -= 12

    // Table data rows
    const maxRows = Math.min(rows.length, 45)
    for (let r = 0; r < maxRows; r++) {
      if (y < 40) {
        page = pdfDoc.addPage([595, 842])
        y = 842 - margin
      }

      const row = rows[r]
      activeCols.forEach((col, idx) => {
        let val: any = ''
        if (col.accessor) val = col.accessor(row)
        else if (col.key) val = (row as any)[col.key]
        if (val === null || val === undefined) val = ''
        const text = String(val).replace(/\u20B1/g, 'PHP ').slice(0, 20)

        page.drawText(text, {
          x: margin + idx * colWidth,
          y,
          size: 7.5,
          font,
          color: rgb(0.2, 0.25, 0.35),
        })
      })
      y -= 14
    }

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
