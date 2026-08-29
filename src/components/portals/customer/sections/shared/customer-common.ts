const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function extractCustomerPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.customer && typeof payload.customer === 'object') return payload.customer
  if (payload.data && typeof payload.data === 'object') return payload.data
  if (payload.user && typeof payload.user === 'object') return payload.user
  return null
}

export const formatPeso = (value: number) => pesoFormatter.format(Number(value || 0))

export const formatPdfMoney = (value: number) => {
  const amount = Number(value || 0)
  return `PHP ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export const createPdfBlob = (bytes: Uint8Array): Blob => {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}

export function parseReplacementMeta(notes: string | null | undefined): Record<string, any> {
  const raw = String(notes || '').trim()
  if (!raw) return {}
  const marker = 'Meta:'
  const index = raw.lastIndexOf(marker)
  if (index < 0) return {}
  const jsonText = raw.slice(index + marker.length).trim()
  if (!jsonText) return {}
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function getReplacementRank(label: string): number {
  // Active workflow states outrank older cancelled records for the order-card summary.
  if (label === 'Needs Follow-up' || label === 'Partially Resolved') return 6
  if (label === 'In Progress' || label === 'Approved') return 5
  if (label === 'Under Review') return 4
  if (label === 'Pending' || label === 'Reported') return 3
  if (label === 'Resolved on Delivery' || label === 'Completed') return 2
  if (label === 'Rejected' || label === 'Cancelled') return 1
  return 0
}

export function getReplacementStatusLabel(status?: string | null) {
  const rawStatus = String(status || '').toUpperCase()
  if (rawStatus === 'PENDING') return 'Pending'
  if (rawStatus === 'UNDER_REVIEW') return 'Under Review'
  if (rawStatus === 'APPROVED') return 'Approved'
  if (rawStatus === 'REJECTED') return 'Rejected'
  if (rawStatus === 'CANCELLED' || rawStatus === 'CANCELED' || rawStatus === 'FAILED_DELIVERY') return 'Cancelled'
  const normalizedStatus =
    rawStatus === 'REQUESTED'
      ? 'REPORTED'
      : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
        ? 'IN_PROGRESS'
        : rawStatus === 'REJECTED'
          ? 'NEEDS_FOLLOW_UP'
          : rawStatus === 'PROCESSED'
            ? 'COMPLETED'
            : rawStatus

  if (normalizedStatus === 'RESOLVED_ON_DELIVERY') return 'Resolved on Delivery'
  if (normalizedStatus === 'NEEDS_FOLLOW_UP') return 'Partially Resolved'
  if (normalizedStatus === 'COMPLETED') return 'Completed'
  if (normalizedStatus === 'CANCELLED' || normalizedStatus === 'CANCELED') return 'Cancelled'
  if (normalizedStatus === 'IN_PROGRESS') return 'In Progress'
  return 'Reported'
}

export function getReplacementBadgeClass(label: string) {
  if (label === 'Pending') return 'bg-slate-100 text-slate-700 hover:bg-slate-100'
  if (label === 'Under Review') return 'bg-blue-100 text-blue-700 hover:bg-blue-100'
  if (label === 'Approved') return 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
  if (label === 'Rejected') return 'bg-rose-100 text-rose-700 hover:bg-rose-100'
  if (label === 'Cancelled') return 'bg-slate-100 text-slate-600 hover:bg-slate-100'
  if (label === 'Partially Resolved' || label === 'Needs Follow-up') {
    return 'bg-amber-100 text-amber-800 hover:bg-amber-100'
  }
  if (label === 'Resolved on Delivery' || label === 'Completed') {
    return 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
  }
  return 'bg-sky-100 text-sky-700 hover:bg-sky-100'
}

export const getProductImage = (imageUrl?: string | null) => {
  if (imageUrl && String(imageUrl).trim().length > 0) return imageUrl
  return '/ann-anns-logo.png'
}
