// Shared client calculation for the product-registration weight preview.
// The backend repeats and enforces this rule so the browser cannot bypass it.
const RETURNABLE_GLASS_UNIT_WEIGHT_KG: Record<string, number> = {
  '8oz': 0.45,
  '12oz': 0.68,
  '1l': 1.55,
}

const STANDARD_UNIT_WEIGHT_KG: Record<string, number> = {
  '7oz': 0.20,
  '8oz': 0.23,
  '12oz': 0.34,
  '195ml': 0.20,
  '237ml': 0.24,
  '240ml': 0.24,
  '250ml': 0.25,
  '290ml': 0.29,
  '300ml': 0.30,
  '320ml': 0.32,
  '330ml': 0.33,
  '350ml': 0.35,
  '355ml': 0.36,
  '450ml': 0.45,
  '500ml': 0.50,
  '600ml': 0.60,
  '900ml': 0.90,
  '1l': 1.00,
  '1.5l': 1.50,
  '2l': 2.00,
  '320g': 0.32,
  '640g': 0.64,
}

const normalizeProductSize = (value: unknown): string | null => {
  const compact = String(value || '').trim().toLowerCase().replace(/\s+/g, '')
  const match = compact.match(/^(\d+(?:\.\d+)?)(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|g)/)
  if (!match) return null
  const amount = Number(match[1])
  const rawUnit = match[2]
  const unit = rawUnit === 'ml' || rawUnit.startsWith('millilit')
    ? 'ml'
    : rawUnit === 'l' || rawUnit.startsWith('lit') ? 'l' : rawUnit
  return `${Number.isInteger(amount) ? Math.trunc(amount) : amount}${unit}`
}

export const calculateProductWeightKg = ({
  size,
  quantityPerUnit,
  returnableGlass,
}: {
  size: unknown
  quantityPerUnit: unknown
  returnableGlass: boolean
}): number | null => {
  const quantity = Number(quantityPerUnit)
  const sizeKey = normalizeProductSize(size)
  if (!sizeKey || !Number.isInteger(quantity) || quantity <= 0) return null

  const unitWeight = (returnableGlass ? RETURNABLE_GLASS_UNIT_WEIGHT_KG[sizeKey] : undefined)
    ?? STANDARD_UNIT_WEIGHT_KG[sizeKey]
  if (!Number.isFinite(unitWeight) || unitWeight <= 0) return null
  return Number((unitWeight * quantity).toFixed(2))
}
