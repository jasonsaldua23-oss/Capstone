// Returnable-container deposit credit. The web portal applies this the moment an
// item enters the cart, so the checkout summary can show how much of a new deposit
// the customer's existing empties already cover.

export function isReturnableGlassItem(item: any) {
  if (!item) return false
  if (item.packagingType !== 'RETURNABLE' || item.depositExempt) return false
  const hasDeposit = Number(item.caseDepositAmount || item.depositAmount || 0) > 0
  return Boolean(hasDeposit && item.containerTypeId)
}

export type EmptyCredit = {
  availableEmptyBottles: number
  availableDepositBalance: number
  emptyReturnedQuantity: number
}

/**
 * How many empties from the customer's balance are consumed by `quantity` of `item`.
 * `bottleBalances` is the customer's per-container-type balance list.
 */
export function getAutomaticEmptyCredit(
  item: any,
  quantity: number,
  bottleBalances: any[] | null | undefined
): EmptyCredit {
  if (!isReturnableGlassItem(item)) {
    return { availableEmptyBottles: 0, availableDepositBalance: 0, emptyReturnedQuantity: 0 }
  }
  const customerBalance = Array.isArray(bottleBalances)
    ? bottleBalances.find((row) => String(row?.containerTypeId) === String(item.containerTypeId))
    : undefined
  const availableEmpties = Math.max(0, Math.floor(Number(customerBalance?.bottlesOutstanding || 0)))
  const containersPerCase = Math.max(1, Math.floor(Number(item.containersPerCase || 1)))
  const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
  const emptyReturnedQuantity = isCase
    ? Math.min(quantity, Math.floor(availableEmpties / containersPerCase)) * containersPerCase
    : Math.min(quantity, availableEmpties)
  return {
    availableEmptyBottles: availableEmpties,
    availableDepositBalance: Math.max(0, Number(customerBalance?.depositBalance || 0)),
    emptyReturnedQuantity,
  }
}

/** Gross deposit charged and the portion covered by existing empties, for one line. */
export function getLineDepositAmounts(item: any) {
  if (!isReturnableGlassItem(item)) return { charged: 0, refunded: 0 }
  const quantity = Math.max(0, Number(item.quantity || 0))
  const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
  const containersPerCase = Math.max(1, Number(item.containersPerCase || 1))
  const charged = quantity * Number(isCase ? item.caseDepositAmount || 0 : item.depositAmount || 0)
  const refunded = isCase
    ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase) * Number(item.caseDepositAmount || 0)
    : Number(item.emptyReturnedQuantity || 0) * Number(item.depositAmount || 0)
  return { charged, refunded: Math.min(charged, refunded) }
}
