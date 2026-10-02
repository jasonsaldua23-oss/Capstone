import { normalizeProductSize } from './product-weight.ts'

// The sizes a product can be registered with. Returnable glass is sold by the case and
// only comes in these sizes; everything else is registered as a pack. The inventory size
// filters read the same lists, so a size added here is filterable everywhere at once.
export const CASE_SIZE_OPTIONS: readonly string[] = [
  '7oz',
  '8oz',
  '12oz',
  '750ml',
  '1 Liter',
]

export const PACK_SIZE_OPTIONS: readonly string[] = [
  '7oz',
  '8oz',
  '12oz',
  '195ml',
  '230ml',
  '237ml',
  '240ml',
  '250ml',
  '290ml',
  '295ml',
  '300ml',
  '320ml',
  '330ml',
  '350ml',
  '355ml',
  '360ml',
  '450ml',
  '500ml',
  '600ml',
  '900ml',
  '1 Liter',
  '1.5 Liters',
  '2 Liters',
  '10 Liters',
  '20 Liters',
  '320g',
  '640g',
]

/** One key per physical size, so "330ml (11 oz)" and "330ml" are the same size. */
export const productSizeKey = (size: unknown): string =>
  normalizeProductSize(size) ?? String(size ?? '').trim().toLowerCase()

// Registration order: ounces, then millilitres and litres by volume, then grams.
const sizeSortKey = (size: string): [number, number] => {
  const match = productSizeKey(size).match(/^(\d+(?:\.\d+)?)(oz|ml|l|g)$/)
  if (!match) return [3, 0]
  const amount = Number(match[1])
  const unit = match[2]
  if (unit === 'oz') return [0, amount]
  if (unit === 'g') return [2, amount]
  return [1, unit === 'l' ? amount * 1000 : amount]
}

/**
 * Size filter choices: every registrable size, plus any older label on a product that
 * none of them covers, so no stocked product becomes unfilterable.
 */
export function buildProductSizeFilterOptions(productSizes: readonly unknown[]): string[] {
  const byKey = new Map<string, string>()
  for (const size of [...PACK_SIZE_OPTIONS, ...CASE_SIZE_OPTIONS, ...productSizes]) {
    const label = String(size ?? '').trim()
    const key = productSizeKey(label)
    // The registration spelling wins over a legacy one for the same size.
    if (key && !byKey.has(key)) byKey.set(key, label)
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const [groupA, amountA] = sizeSortKey(a)
    const [groupB, amountB] = sizeSortKey(b)
    return groupA - groupB || amountA - amountB || a.localeCompare(b)
  })
}

/** Whether any of a product's sizes is the selected filter size. */
export function productHasSize(productSizes: readonly unknown[], selected: string): boolean {
  const selectedKey = productSizeKey(selected)
  return productSizes.some((size) => productSizeKey(size) === selectedKey)
}
