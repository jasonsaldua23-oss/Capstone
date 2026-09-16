'use client'

export function formatFullName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
  suffix?: string | null,
  fallback?: string
): string {
  const first = (firstName || '').trim()
  const middle = (middleName || '').trim()
  const last = (lastName || '').trim()
  const suf = (suffix || '').trim()

  const parts: string[] = []
  if (first) parts.push(first)
  if (middle) {
    const cleanM = middle.replace(/\.+$/, '')
    if (cleanM) {
      parts.push(`${cleanM.charAt(0).toUpperCase()}.`)
    }
  }
  if (last) parts.push(last)

  let result = parts.join(' ')
  if (suf) {
    result = result ? `${result} ${suf}` : suf
  }
  return result || fallback || ''
}

export type NotificationPrefs = {
  orderUpdates: boolean
  deliveryUpdates: boolean
  systemAlerts: boolean
}

export const CUSTOMER_NOTIFICATION_PREFS_KEY = 'customer_portal_notification_preferences'

export function timeAgo(dateString: string) {
  try {
    const now = new Date()
    const past = new Date(dateString)
    const diffMs = now.getTime() - past.getTime()
    if (Number.isNaN(diffMs)) return ''
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    return past.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function NotificationRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string
  description: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-none border-b border-slate-100 bg-white px-4 py-3.5 last:border-b-0 hover:bg-slate-50/30">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
      <button type="button" onClick={onToggle} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-[#14532d]' : 'bg-slate-200'}`} aria-pressed={checked}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? 'left-5.5' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

export function RequirementRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-1 py-0.5">
      {met ? (
        <span className="text-emerald-500 font-bold text-xs select-none">✓</span>
      ) : (
        <span className="text-red-500 font-bold text-xs select-none">✗</span>
      )}
      <span className={`text-[10px] font-medium leading-none ${met ? 'text-emerald-700' : 'text-slate-400'}`}>
        {label}
      </span>
    </div>
  )
}
