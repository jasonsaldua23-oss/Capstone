import { toast } from 'sonner'
import type { Order, OrderItem } from '../shared/customer-types'
import { formatPdfMoney } from '../shared/customer-common'

declare global {
  interface Window {
    html2canvas?: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>
  }
}

const getOrderLineTotal = (item: OrderItem) => {
  const explicit = Number(item.totalPrice)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return Number(item.unitPrice || 0) * Number(item.quantity || 0)
}

const getMixedCaseComponentDetail = (component: any, itemCaseCount: number) => {
  const perCase = Math.max(0, Number(component?.quantityPerCase || 0))
  const caseCount = Math.max(0, Number(component?.caseCount ?? itemCaseCount))
  const totalBaseUnits = Math.max(0, Number(component?.totalBaseUnits ?? perCase * caseCount))
  const unitPrice = Number(component?.unitPrice || 0)
  const subtotal = Number(component?.componentSubtotal ?? totalBaseUnits * unitPrice)
  const label = String(component?.baseUnitLabel || 'unit').trim() || 'unit'
  return `${component?.productName || 'Product'}: ${perCase} ${label}(s)/case x ${caseCount} = ${totalBaseUnits} ${label}(s); ${formatPdfMoney(unitPrice)}/${label}; ${formatPdfMoney(subtotal)}`
}

const wrapCanvasText = (ctx: CanvasRenderingContext2D, value: string, maxWidth: number) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let current = words[0]
  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
    } else {
      lines.push(current)
      current = words[index]
    }
  }
  lines.push(current)
  return lines
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

async function inlineImagesAsDataUrls(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      const rawSrc = String(img.getAttribute('src') || '').trim()
      if (!rawSrc) return
      if (rawSrc.startsWith('data:')) {
        img.setAttribute('src', rawSrc)
        return
      }
      try {
        const absoluteSrc = new URL(rawSrc, window.location.origin).toString()
        const response = await fetch(absoluteSrc, { mode: 'cors', credentials: 'include', cache: 'no-store' })
        if (!response.ok) throw new Error('Image fetch failed')
        const blob = await response.blob()
        const dataUrl = await blobToDataUrl(blob)
        img.setAttribute('src', dataUrl)
        img.setAttribute('crossorigin', 'anonymous')
      } catch {
        // Avoid tainting canvas: keep layout but drop problematic image source.
        img.removeAttribute('src')
      }
    })
  )
}

async function ensureHtml2Canvas(): Promise<NonNullable<Window['html2canvas']>> {
  if (typeof window === 'undefined') throw new Error('Browser only')
  if (typeof window.html2canvas === 'function') return window.html2canvas
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-html2canvas="1"]') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load html2canvas')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    script.async = true
    script.dataset.html2canvas = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load html2canvas'))
    document.head.appendChild(script)
  })
  if (typeof window.html2canvas !== 'function') throw new Error('html2canvas unavailable')
  return window.html2canvas
}

export async function downloadOrderReceipt(order: Order, receiptElement?: HTMLElement | null) {
  try {
    if (receiptElement) {
      try {
        const html2canvas = await ensureHtml2Canvas()
        const clone = receiptElement.cloneNode(true) as HTMLElement
        clone.style.position = 'fixed'
        clone.style.left = '-10000px'
        clone.style.top = '0'
        clone.style.zIndex = '-1'
        clone.style.background = '#ffffff'
        clone.style.margin = '0'
        clone.style.transform = 'none'
        clone.style.maxHeight = 'none'
        clone.style.overflow = 'visible'
        document.body.appendChild(clone)
        await inlineImagesAsDataUrls(clone)
        try {
          const canvas = await html2canvas(clone, {
          backgroundColor: '#ffffff',
          scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
          useCORS: true,
          allowTaint: false,
          imageTimeout: 30000,
          logging: false,
          })
          const dataUrl = canvas.toDataURL('image/png')
          const { PDFDocument } = await import('pdf-lib')
          const pdfDoc = await PDFDocument.create()
          const pngBytes = await fetch(dataUrl).then((res) => res.arrayBuffer())
          const pngImage = await pdfDoc.embedPng(pngBytes)
          const imageWidth = pngImage.width
          const imageHeight = pngImage.height
          const page = pdfDoc.addPage([imageWidth, imageHeight])
          page.drawImage(pngImage, { x: 0, y: 0, width: imageWidth, height: imageHeight })
          const pdfBytes = await pdfDoc.save()
          const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
          const pdfUrl = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = pdfUrl
          link.download = `Receipt-${order.orderNumber || order.id}.pdf`
          link.rel = 'noopener'
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 15000)
        } finally {
          document.body.removeChild(clone)
        }
        toast.success('Receipt downloaded')
        return
      } catch (captureError) {
        console.warn('Preview capture failed; using fallback PDF renderer.', captureError)
      }
    }

    const subtotal = Number(order.subtotal ?? order.items.reduce((sum, item) => sum + getOrderLineTotal(item), 0))
    const discount = Number(order.discount ?? 0)
    const total = Number(order.totalAmount ?? subtotal - discount)
    const discountPercent = (() => {
      const explicitPercent = Number((order as any)?.discountDetails?.percent)
      if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
      if (subtotal > 0 && discount > 0) return (discount / subtotal) * 100
      return 0
    })()
    const discountPercentLabel =
      Number.isInteger(discountPercent)
        ? `${discountPercent}%`
        : `${discountPercent.toFixed(2).replace(/\.?0+$/, '')}%`
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
    const sellerPhone = String(
      (order as any)?.sellerPhone ||
      (order as any)?.adminPhone ||
      (order as any)?.ownerPhone ||
      (order as any)?.warehousePhone ||
      '+63 9460056944'
    ).trim()

    const fileName = `Receipt-${order.orderNumber || order.id}.pdf`
    const receiptItems = order.items || []
    const measureCanvas = document.createElement('canvas')
    const measureCtx = measureCanvas.getContext('2d')
    if (!measureCtx) throw new Error('Canvas unavailable')
    const receiptRows = receiptItems.map((item: any) => {
      const itemName = item.itemType === 'MIXED_CASE'
        ? `Mixed Case - ${Number(item.caseCapacity || 0)} units`
        : String(item.product?.name || 'Item')
      measureCtx.font = '30px Arial'
      const nameLines = wrapCanvasText(measureCtx, itemName, 470)
      measureCtx.font = '20px Arial'
      const detailValues = item.itemType === 'MIXED_CASE'
        ? (item.components || []).map((component: any) => getMixedCaseComponentDetail(component, Number(item.quantity || 0)))
        : [String((item.product as any)?.categoryName || (item.product as any)?.category || '').trim()].filter(Boolean)
      const detailLines = detailValues.flatMap((detail: string) => wrapCanvasText(measureCtx, detail, 470))
      const rowHeight = Math.max(100, 30 + nameLines.length * 34 + (detailLines.length > 0 ? 10 + detailLines.length * 26 : 0))
      return { item, nameLines, detailLines, rowHeight }
    })
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = Math.max(1600, 1500 + receiptRows.reduce((sum, row) => sum + row.rowHeight, 0))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')

    const navy = '#102a5c'
    const slate = '#334155'
    const lightBorder = '#dbe3ef'
    const green = '#16a34a'
    const paleGreen = '#edf9f0'
    const left = 60
    const top = 52
    const width = 1080
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 2
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48)

    ctx.fillStyle = navy
    ctx.font = 'bold 48px Arial'
    ctx.fillText('AAB TRADING SHOP', left + 120, top + 40)
    ctx.font = '24px Arial'
    ctx.fillStyle = slate
    ctx.fillText('Official Delivery Receipt', left + 120, top + 78)
    ctx.fillText(sellerPhone, left + 120, top + 114)
    ctx.font = 'bold 46px Arial'
    ctx.fillStyle = navy
    ctx.fillText('ORDER', left + 740, top + 42)
    ctx.fillText('RECEIPT', left + 700, top + 92)
    ctx.strokeStyle = green
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(left + 700, top + 108)
    ctx.lineTo(left + 860, top + 108)
    ctx.stroke()

    let y = top + 160
    ctx.strokeStyle = '#c8d7ef'
    ctx.lineWidth = 2
    ctx.fillStyle = '#f8fbff'
    ctx.fillRect(left, y, width, 88)
    ctx.strokeRect(left, y, width, 88)
    ctx.strokeStyle = '#d7e3f6'
    ctx.beginPath()
    ctx.moveTo(left + width / 2, y)
    ctx.lineTo(left + width / 2, y + 88)
    ctx.stroke()
    ctx.fillStyle = slate
    ctx.font = '26px Arial'
    ctx.fillText('Receipt No.', left + 26, y + 36)
    ctx.font = 'bold 42px Arial'
    ctx.fillStyle = navy
    ctx.fillText(receiptNumber, left + 26, y + 74)
    ctx.fillStyle = slate
    ctx.font = '26px Arial'
    ctx.fillText('Order No.', left + width / 2 + 26, y + 36)
    ctx.font = 'bold 42px Arial'
    ctx.fillStyle = navy
    ctx.fillText(String(order.orderNumber || ''), left + width / 2 + 26, y + 74)

    y += 120
    const col = width / 3
    ctx.font = 'bold 26px Arial'
    ctx.fillStyle = navy
    ctx.fillText('DELIVERY ADDRESS', left, y)
    ctx.fillText('SOLD BY', left + col + 20, y)
    ctx.fillText('ORDER DETAILS', left + col * 2 + 20, y)
    ctx.font = '30px Arial'
    ctx.fillStyle = slate
    const lines = [fullAddress || '-']
    lines.forEach((line, i) => ctx.fillText(line, left, y + 44 + i * 34))
    ctx.fillText('AAB TRADING SHOP', left + col + 20, y + 44)
    ctx.fillText(`Ordered: ${new Date(order.createdAt).toLocaleDateString()}`, left + col * 2 + 20, y + 44)
    ctx.fillText(`Delivered: ${new Date(order.deliveredAt || order.deliveryDate || order.createdAt).toLocaleDateString()}`, left + col * 2 + 20, y + 78)

    y += 160
    ctx.fillStyle = navy
    ctx.fillRect(left, y, width, 56)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 24px Arial'
    ctx.fillText('Product', left + 20, y + 36)
    ctx.fillText('Qty', left + 520, y + 36)
    ctx.fillText('Unit Price', left + 640, y + 36)
    ctx.fillText('Amount', left + 860, y + 36)
    y += 56
    ctx.strokeStyle = lightBorder
    receiptRows.forEach(({ item, nameLines, detailLines, rowHeight }) => {
      ctx.strokeRect(left, y, width, rowHeight)
      ctx.fillStyle = navy
      ctx.font = '30px Arial'
      nameLines.forEach((line, index) => ctx.fillText(line, left + 20, y + 38 + index * 34))
      ctx.font = '20px Arial'
      ctx.fillStyle = slate
      const detailStart = y + 38 + nameLines.length * 34
      detailLines.forEach((line, index) => ctx.fillText(line, left + 20, detailStart + index * 26))
      ctx.fillStyle = '#102a5c'
      ctx.font = '30px Arial'
      ctx.fillText(String(item.quantity || 0), left + 530, y + 60)
      ctx.fillText(formatPdfMoney(Number(item.unitPrice || 0)), left + 640, y + 60)
      ctx.fillText(formatPdfMoney(getOrderLineTotal(item)), left + 860, y + 60)
      y += rowHeight
    })

    y += 30
    ctx.strokeStyle = '#b9e6ca'
    ctx.fillStyle = '#fff'
    ctx.fillRect(left, y, width * 0.62, 180)
    ctx.strokeRect(left, y, width * 0.62, 180)
    ctx.fillStyle = paleGreen
    ctx.fillRect(left + width * 0.62, y, width * 0.38, 180)
    ctx.strokeRect(left + width * 0.62, y, width * 0.38, 180)
    ctx.fillStyle = navy
    ctx.font = 'bold 38px Arial'
    ctx.fillText('Subtotal', left + 28, y + 62)
    ctx.fillText(formatPdfMoney(subtotal), left + 260, y + 62)
    if (discount > 0) {
      ctx.fillStyle = green
      ctx.font = 'bold 36px Arial'
      ctx.fillText(`Discount${discountPercent > 0 ? ` (${discountPercentLabel})` : ''}`, left + 28, y + 126)
      ctx.fillText(`-${formatPdfMoney(discount)}`, left + 260, y + 126)
    }
    ctx.fillStyle = green
    ctx.font = 'bold 42px Arial'
    ctx.fillText('TOTAL PRICE', left + width * 0.62 + 40, y + 78)
    ctx.fillStyle = navy
    ctx.font = 'bold 72px Arial'
    ctx.fillText(formatPdfMoney(total), left + width * 0.62 + 40, y + 150)

    y += 230
    ctx.strokeStyle = '#dbe3ef'
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(left + width, y)
    ctx.stroke()
    ctx.font = '20px Arial'
    ctx.fillStyle = '#64748b'
    ctx.fillText('This receipt serves as proof of payment and delivery.', left + 180, y + 36)
    ctx.fillText('Thank you for your purchase.', left + 320, y + 66)

    const dataUrl = canvas.toDataURL('image/png')
    const { PDFDocument } = await import('pdf-lib')
    const pdfDoc = await PDFDocument.create()
    const pngBytes = await fetch(dataUrl).then((res) => res.arrayBuffer())
    const pngImage = await pdfDoc.embedPng(pngBytes)
    const imageWidth = pngImage.width
    const imageHeight = pngImage.height
    const page = pdfDoc.addPage([imageWidth, imageHeight])
    page.drawImage(pngImage, { x: 0, y: 0, width: imageWidth, height: imageHeight })
    const pdfBytes = await pdfDoc.save()
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
    const pdfUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 15000)
    toast.success('Receipt downloaded')
  } catch (error) {
    console.error('Receipt download failed:', error)
    toast.error('Failed to download receipt.')
  }
}
