/**
 * A local calendar date, `days` from `now`, as an <input type="date"> value.
 * `toISOString()` would give the UTC date, a day behind in the Philippines
 * before 8 am.
 */
export function localDateInputValue(days = 0, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
