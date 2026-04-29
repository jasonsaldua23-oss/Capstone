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
  if (label === 'Needs Follow-up' || label === 'Partially Resolved') return 3
  if (label === 'In Progress') return 2
  if (label === 'Resolved on Delivery' || label === 'Completed') return 1
  return 0
}

export function getReplacementStatusLabel(status?: string | null) {
  const rawStatus = String(status || '').toUpperCase()
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
  if (normalizedStatus === 'IN_PROGRESS') return 'In Progress'
  return 'Reported'
}

export function getReplacementBadgeClass(label: string) {
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
  return 'https://placehold.co/120x120/e2e8f0/475569?text=Product'
}
