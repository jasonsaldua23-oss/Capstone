// One shared name formatter for every portal. Mirrors _format_display_name in
// backend/core/views_api.py, which recomputes User.name from the structured fields
// whenever any of them is saved — so a screen that edits a person's name must edit
// first/middle/last/suffix, never the flat display name, or the two drift apart.
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
    // The middle name is shown as an initial, the way the backend formats it.
    const cleanMiddle = middle.replace(/\.+$/, '')
    if (cleanMiddle) parts.push(`${cleanMiddle.charAt(0).toUpperCase()}.`)
  }
  if (last) parts.push(last)

  let result = parts.join(' ')
  if (suf) result = result ? `${result} ${suf}` : suf
  return result || fallback || ''
}

/**
 * Best-effort split of a flat display name, used only to seed the structured fields
 * for a record saved before they existed. The first word is the given name and the
 * rest is the family name; a single-word name leaves the last name empty rather than
 * repeating the first, which is what produced names like "jandriver jandriver".
 */
export function splitFullName(value: unknown): { firstName: string; lastName: string } {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  }
}
