function toDisplayLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function pluralizeContainer(label: string, quantity: number): string {
  if (quantity === 1) return label
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`
  return `${label}s`
}

export function getOrderedContainerLabel(item: any): string {
  if (String(item?.itemType || item?.item_type || '').trim().toUpperCase() === 'MIXED_CASE') {
    return 'Mixed Case'
  }

  // The purchased product unit is authoritative; loose bottle/category labels describe contents, not billing units.
  const rawUnit = String(
    item?.productUnit ||
    item?.product_unit ||
    item?.product?.unit ||
    item?.unit ||
    ''
  ).trim()
  if (rawUnit) return toDisplayLabel(rawUnit)

  const itemType = String(item?.itemType || item?.item_type || '').trim().toUpperCase()
  return itemType === 'STANDARD_CASE' ? 'Case' : 'Unit'
}

export function formatOrderedQuantityWithContainer(item: any, includePrefix = true): string {
  const quantity = Math.max(Number(item?.quantity || 0), 0)
  const container = pluralizeContainer(getOrderedContainerLabel(item), quantity)
  return `${includePrefix ? 'x' : ''}${quantity} ${container}`
}
