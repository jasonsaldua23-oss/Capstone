import { toPng } from 'html-to-image'
import { toast } from 'sonner'
import type { Order } from '../shared/customer-types'

export async function downloadOrderReceipt(order: Order, receiptElement?: HTMLElement | null) {
  let desktopReceipt: HTMLElement | null = null
  try {
    if (!receiptElement) throw new Error('No receipt element')

    // Capture a fixed desktop copy so mobile viewport breakpoints never affect the downloaded receipt.
    desktopReceipt = receiptElement.cloneNode(true) as HTMLElement
    desktopReceipt.style.position = 'fixed'
    desktopReceipt.style.left = '-10000px'
    desktopReceipt.style.top = '0'
    desktopReceipt.style.width = '720px'
    desktopReceipt.style.maxWidth = 'none'
    desktopReceipt.style.padding = '20px'
    desktopReceipt.style.boxSizing = 'border-box'
    desktopReceipt.style.backgroundColor = '#ffffff'

    const itemHeader = desktopReceipt.querySelector<HTMLElement>('[data-receipt-items-header]')
    if (itemHeader) {
      itemHeader.style.gridTemplateColumns = 'minmax(0, 1fr) 50px 90px 95px'
      itemHeader.style.paddingLeft = '16px'
      itemHeader.style.paddingRight = '16px'
      itemHeader.style.fontSize = '12px'
    }
    desktopReceipt.querySelectorAll<HTMLElement>('[data-receipt-item-row]').forEach((row) => {
      row.style.gridTemplateColumns = 'minmax(0, 1fr) 50px 90px 95px'
      row.style.fontSize = '12px'
    })
    desktopReceipt.querySelectorAll<HTMLElement>('[data-receipt-product-cell]').forEach((cell) => {
      cell.style.paddingLeft = '12px'
      cell.style.paddingRight = '12px'
    })
    desktopReceipt.querySelectorAll<HTMLElement>('[data-receipt-amount-cell]').forEach((cell) => {
      cell.style.paddingLeft = '8px'
      cell.style.paddingRight = '8px'
    })
    document.body.appendChild(desktopReceipt)
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    const dataUrl = await toPng(desktopReceipt, {
      backgroundColor: '#ffffff',
      pixelRatio: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
      cacheBust: true,
      skipAutoScale: true,
      width: 720,
      style: {
        position: 'static',
        left: '0',
        top: '0',
        width: '720px',
        maxWidth: 'none',
        margin: '0',
        transform: 'none',
        borderRadius: '0',
      },
    })

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `Receipt-${order.orderNumber || order.id}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('Receipt downloaded')
  } catch (error) {
    console.error('Receipt download failed:', error)
    toast.error('Failed to download receipt.')
  } finally {
    desktopReceipt?.remove()
  }
}
