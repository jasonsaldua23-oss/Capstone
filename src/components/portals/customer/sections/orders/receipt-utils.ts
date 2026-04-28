import { toast } from 'sonner'
import type { Order, OrderItem } from '../shared/customer-types'
import { createPdfBlob, formatPdfMoney } from '../shared/customer-common'

const getOrderLineTotal = (item: OrderItem) => {
  const explicit = Number(item.totalPrice)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return Number(item.unitPrice || 0) * Number(item.quantity || 0)
}

export async function downloadOrderReceipt(order: Order) {
  try {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
    const subtotal = Number(order.subtotal ?? order.items.reduce((sum, item) => sum + getOrderLineTotal(item), 0))
    const tax = Number(order.tax ?? 0)
    const shippingCost = Number(order.shippingCost ?? 0)
    const discount = Number(order.discount ?? 0)
    const total = Number(order.totalAmount ?? subtotal + tax + shippingCost - discount)
    const issuedAt = new Date(order.deliveredAt || order.deliveryDate || order.createdAt)
    const receiptNumber = `RCT-${String(order.orderNumber || order.id)}`
    const normalizeToken = (value: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    const addressTokens = String(order.shippingAddress || '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    const tokenSet = new Set(addressTokens.map((token) => normalizeToken(token)))
    const extras = [
      order.shippingCity,
      order.shippingProvince,
      order.shippingZipCode,
      order.shippingCountry || 'Philippines',
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .filter((part) => {
        const key = normalizeToken(part)
        if (!key || tokenSet.has(key)) return false
        tokenSet.add(key)
        return true
      })
    const fullAddress = [...addressTokens, ...extras].join(', ')

    const fileName = `Receipt-${order.orderNumber}.pdf`
    const pdf = await PDFDocument.create()
    const pageSize: [number, number] = [595.28, 841.89]
    let page = pdf.addPage(pageSize)
    const fontRegular = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const margin = 40
    const contentWidth = page.getWidth() - margin * 2
    let y = page.getHeight() - margin

    const wrapText = (text: string, maxWidth: number, fontSize: number, font: any) => {
      const words = String(text || '').split(/\s+/)
      const lines: string[] = []
      let current = ''
      for (const word of words) {
        const next = current ? `${current} ${word}` : word
        if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
          current = next
        } else {
          if (current) lines.push(current)
          current = word
        }
      }
      if (current) lines.push(current)
      return lines.length ? lines : ['']
    }

    const ensureSpace = (needed: number) => {
      if (y - needed >= margin) return
      page = pdf.addPage(pageSize)
      y = page.getHeight() - margin
    }

    const drawText = (text: string, x: number, yy: number, size = 10, bold = false, color = rgb(0.2, 0.25, 0.32)) => {
      page.drawText(text, {
        x,
        y: yy,
        size,
        font: bold ? fontBold : fontRegular,
        color,
      })
    }

    let logoWidth = 0
    try {
      const response = await fetch('/ann-anns-logo.png', { cache: 'no-store' })
      if (response.ok) {
        const logoBytes = await response.arrayBuffer()
        const logoImage = await pdf.embedPng(logoBytes)
        const logoHeight = 24
        logoWidth = (logoImage.width / logoImage.height) * logoHeight
        page.drawImage(logoImage, {
          x: margin,
          y: y - 13,
          width: logoWidth,
          height: logoHeight,
        })
      }
    } catch {
      logoWidth = 0
    }

    const titleX = margin + (logoWidth > 0 ? logoWidth + 8 : 0)
    drawText("Ann Ann's Beverages Trading", titleX, y, 13, true, rgb(0.06, 0.09, 0.16))
    drawText('Order Receipt', page.getWidth() - margin - fontBold.widthOfTextAtSize('Order Receipt', 10), y + 1, 10, true)
    y -= 16
    drawText('Official Delivery Receipt', titleX, y, 9, false, rgb(0.39, 0.45, 0.55))
    y -= 14

    const badgeText = `Receipt No: ${receiptNumber} | Order No: ${order.orderNumber}`
    page.drawRectangle({
      x: margin,
      y: y - 7,
      width: contentWidth,
      height: 12,
      borderColor: rgb(0.88, 0.91, 0.94),
      borderWidth: 1,
      color: rgb(0.97, 0.98, 0.99),
    })
    drawText(badgeText, margin + 6, y - 2.5, 8.5, false, rgb(0.28, 0.33, 0.41))
    y -= 22

    const colGap = 10
    const colW = (contentWidth - colGap * 2) / 3
    drawText('Delivery Details', margin, y, 8.5, true, rgb(0.39, 0.45, 0.55))
    drawText('Sold By', margin + colW + colGap, y, 8.5, true, rgb(0.39, 0.45, 0.55))
    drawText('Order Details', margin + (colW + colGap) * 2, y, 8.5, true, rgb(0.39, 0.45, 0.55))
    y -= 11

    const addressLines = wrapText(fullAddress || '-', colW, 8.5, fontRegular)
    const orderDetails = [
      `Ordered: ${new Date(order.createdAt).toLocaleDateString()}`,
      `Delivered: ${issuedAt.toLocaleDateString()}`,
    ]
    const maxRows = Math.max(addressLines.length, 1, orderDetails.length)
    ensureSpace(maxRows * 11)
    for (let i = 0; i < maxRows; i++) {
      if (addressLines[i]) drawText(addressLines[i], margin, y - i * 10, 8.5, false)
      if (i === 0) drawText("Ann Ann's Beverages Trading", margin + colW + colGap, y, 8.5, false)
      if (orderDetails[i]) drawText(orderDetails[i], margin + (colW + colGap) * 2, y - i * 10, 8.5, false)
    }
    y -= maxRows * 10 + 12

    ensureSpace(24)
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + contentWidth, y },
      thickness: 1,
      color: rgb(0.88, 0.91, 0.94),
    })
    y -= 12
    drawText('Item Description', margin, y, 8.5, true, rgb(0.39, 0.45, 0.55))
    drawText('Qty', page.getWidth() - margin - fontBold.widthOfTextAtSize('Qty', 8.5), y, 8.5, true, rgb(0.39, 0.45, 0.55))
    y -= 10

    for (const item of order.items || []) {
      const lineText = `${item.product?.name || 'Item'} (${(item.product as any)?.unit || 'unit'}) - ${formatPdfMoney(Number(item.unitPrice || 0))}`
      const lines = wrapText(lineText, contentWidth - 42, 8.5, fontRegular)
      const blockHeight = Math.max(lines.length * 10, 10)
      ensureSpace(blockHeight + 6)
      lines.forEach((line, idx) => drawText(line, margin, y - idx * 10, 8.5, false, rgb(0.12, 0.16, 0.23)))
      drawText(String(Number(item.quantity || 0)), page.getWidth() - margin - fontBold.widthOfTextAtSize(String(Number(item.quantity || 0)), 9), y, 9, true, rgb(0.12, 0.16, 0.23))
      y -= blockHeight + 4
    }

    y -= 4
    ensureSpace(30)
    const totalLabel = 'Total Price'
    const totalValue = formatPdfMoney(total)
    const totalBlockWidth = 180
    page.drawLine({
      start: { x: page.getWidth() - margin - totalBlockWidth, y },
      end: { x: page.getWidth() - margin, y },
      thickness: 1,
      color: rgb(0.8, 0.84, 0.9),
    })
    y -= 14
    drawText(totalLabel, page.getWidth() - margin - totalBlockWidth + 2, y, 11, true, rgb(0.06, 0.09, 0.16))
    drawText(totalValue, page.getWidth() - margin - fontBold.widthOfTextAtSize(totalValue, 11), y, 11, true, rgb(0.06, 0.09, 0.16))
    y -= 20

    const footer = 'This receipt serves as proof of payment and delivery. Thank you for your purchase.'
    const footerLines = wrapText(footer, contentWidth, 8, fontRegular)
    ensureSpace(footerLines.length * 9 + 6)
    footerLines.forEach((line, idx) => {
      const w = fontRegular.widthOfTextAtSize(line, 8)
      drawText(line, (page.getWidth() - w) / 2, y - idx * 8, 8, false, rgb(0.39, 0.45, 0.55))
    })

    const pdfBytes = await pdf.save()
    const blob = createPdfBlob(pdfBytes)

    const nav = navigator as any
    if (typeof nav?.msSaveOrOpenBlob === 'function') {
      nav.msSaveOrOpenBlob(blob, fileName)
    } else {
      let handled = false
      const canShareFiles =
        typeof nav?.canShare === 'function' &&
        typeof nav?.share === 'function' &&
        (() => {
          try {
            const file = new File([blob], fileName, { type: 'application/pdf' })
            return nav.canShare({ files: [file] })
          } catch {
            return false
          }
        })()

      if (canShareFiles) {
        try {
          const file = new File([blob], fileName, { type: 'application/pdf' })
          await nav.share({ title: `Receipt ${order.orderNumber}`, text: `Receipt for ${order.orderNumber}`, files: [file] })
          handled = true
        } catch (shareError: any) {
          if (String(shareError?.name || '') !== 'AbortError') {
            console.error('Receipt share failed:', shareError)
          }
        }
      }

      if (!handled) {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.rel = 'noopener'
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      }
    }
    toast.success('Receipt downloaded')
  } catch (error) {
    console.error('Receipt download failed:', error)
    try {
      const { PDFDocument, StandardFonts } = await import('pdf-lib')
      const simple = await PDFDocument.create()
      const page = simple.addPage([595.28, 841.89])
      const font = await simple.embedFont(StandardFonts.Helvetica)
      page.drawText(`Receipt ${order.orderNumber}`, { x: 40, y: 800, size: 14, font })
      page.drawText(`Total Price: ${formatPdfMoney(Number(order.totalAmount || 0))}`, { x: 40, y: 780, size: 11, font })
      const fallbackBlob = createPdfBlob(await simple.save())
      const fallbackUrl = URL.createObjectURL(fallbackBlob)
      const opened = window.open(fallbackUrl, '_blank')
      if (!opened) throw new Error('Popup blocked')
    } catch (fallbackError) {
      console.error('Receipt fallback failed:', fallbackError)
      toast.error('Failed to download receipt. Please allow downloads/popups and try again.')
    }
  }
}
