export type ReplacementStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'PROCESSED'
  | 'REJECTED'

const REPLACEMENT_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  PICKED_UP: 'PROCESSING',
  IN_TRANSIT: 'PACKED',
  RECEIVED: 'OUT FOR DELIVERY',
  PROCESSED: 'DELIVERED',
  REJECTED: 'REJECTED',
}

export function formatReplacementStatusLabel(status: string): string {
  const key = String(status || '').toUpperCase()
  return REPLACEMENT_STATUS_LABELS[key] || key.replace(/_/g, ' ') || 'UNKNOWN'
}

