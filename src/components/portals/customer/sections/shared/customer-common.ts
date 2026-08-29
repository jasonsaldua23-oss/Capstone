// Shared customer logic lives in shared/customer-logic so the web portal and the
// Expo customer app compute identical results. Only web-bound helpers stay here.
export {
  extractCustomerPayload,
  formatPeso,
  formatPdfMoney,
  parseReplacementMeta,
  getReplacementRank,
  getReplacementStatusLabel,
  getReplacementStatusTone,
} from '@shared/customer-logic/customer-common'
export type { ReplacementTone } from '@shared/customer-logic/customer-common'

import { getReplacementStatusTone, type ReplacementTone } from '@shared/customer-logic/customer-common'

export const createPdfBlob = (bytes: Uint8Array): Blob => {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}

const REPLACEMENT_BADGE_CLASS_BY_TONE: Record<ReplacementTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  muted: 'bg-slate-100 text-slate-600 hover:bg-slate-100',
  info: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  success: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  danger: 'bg-rose-100 text-rose-700 hover:bg-rose-100',
  warning: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  accent: 'bg-sky-100 text-sky-700 hover:bg-sky-100',
}

export function getReplacementBadgeClass(label: string) {
  return REPLACEMENT_BADGE_CLASS_BY_TONE[getReplacementStatusTone(label)]
}

export const getProductImage = (imageUrl?: string | null) => {
  if (imageUrl && String(imageUrl).trim().length > 0) return imageUrl
  return '/ann-anns-logo.png'
}
