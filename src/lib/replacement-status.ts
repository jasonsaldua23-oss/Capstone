export type ReplacementStatus =
  | 'REPORTED'
  | 'IN_PROGRESS'
  | 'RESOLVED_ON_DELIVERY'
  | 'NEEDS_FOLLOW_UP'
  | 'COMPLETED'

const REPLACEMENT_STATUS_LABELS: Record<string, string> = {
  REPORTED: 'REPORTED',
  IN_PROGRESS: 'IN PROGRESS',
  RESOLVED_ON_DELIVERY: 'RESOLVED ON DELIVERY',
  NEEDS_FOLLOW_UP: 'NEEDS FOLLOW-UP',
  COMPLETED: 'COMPLETED',
  REQUESTED: 'REPORTED',
  APPROVED: 'IN PROGRESS',
  PICKED_UP: 'IN PROGRESS',
  IN_TRANSIT: 'IN PROGRESS',
  RECEIVED: 'IN PROGRESS',
  PROCESSED: 'COMPLETED',
  REJECTED: 'NEEDS FOLLOW-UP',
}

export function formatReplacementStatusLabel(status: string): string {
  const key = String(status || '').toUpperCase()
  return REPLACEMENT_STATUS_LABELS[key] || key.replace(/_/g, ' ') || 'UNKNOWN'
}
