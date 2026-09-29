/**
 * Stored statuses that every portal shows under another name:
 * - PREPARING, the order status, reads Processing (its label in OrderStatus,
 *   backend/core/models.py);
 * - IN_TRANSIT, carried by stops, delivery legs and legacy trips, reads In Progress.
 * A screen that prints a raw status passes it through here first, then keeps its
 * own casing and underscore handling.
 */
const DISPLAY_STATUS: Record<string, string> = {
  PREPARING: 'PROCESSING',
  IN_TRANSIT: 'IN_PROGRESS',
}

export function toDisplayStatus(status: unknown): string {
  const raw = String(status ?? '').trim()
  return DISPLAY_STATUS[raw.toUpperCase()] ?? raw
}
