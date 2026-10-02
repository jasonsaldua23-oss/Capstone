// The second SKU segment names the order format the SKU was built for. Mirrors
// _sku_names_other_order_format in backend/core/views_products.py, which rebuilds
// such a SKU on any save; the edit form uses this to show what will be stored.
const SKU_ORDER_FORMATS: Record<string, string> = { CAS: 'case', PAC: 'pack', BOT: 'bottle' }

// Same mapping as the backend's _normalize_product_unit.
function normalizeProductUnit(unit: unknown): string {
  const value = String(unit || '').trim().toLowerCase()
  if (!value || ['case', 'piece', 'pieces'].includes(value)) return 'case'
  if (['pack', 'bundle', 'pack(bundle)', 'pack (bundle)'].includes(value)) return 'pack'
  if (['bottle', 'bottles'].includes(value)) return 'bottle'
  return value
}

/** True when the SKU says CAS/PAC/BOT but the product is sold in another format (e.g. MILK-CAS-... on a pack product). */
export function skuNamesOtherOrderFormat(sku: unknown, unit: unknown): boolean {
  const named = SKU_ORDER_FORMATS[String(sku || '').split('-')[1]?.trim().toUpperCase() || '']
  return Boolean(named) && named !== normalizeProductUnit(unit)
}
