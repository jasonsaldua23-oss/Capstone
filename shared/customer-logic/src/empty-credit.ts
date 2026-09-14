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

/** Resolve the balance for this exact product, not another product using the same container. */
export function getProductBottleBalance(
  item: any,
  bottleBalances: any[] | null | undefined
): any | undefined {
  const containerBalance = Array.isArray(bottleBalances)
    ? bottleBalances.find((row) => String(row?.containerTypeId) === String(item?.containerTypeId))
    : undefined
  if (!containerBalance) return undefined

  const productBalances = Array.isArray(containerBalance.productBalances)
    ? containerBalance.productBalances
    : []
  const productId = String(item?.productId ?? item?.id ?? '').trim()
  if (productBalances.length === 0) {
    const productOptions = Array.isArray(containerBalance.productOptions)
      ? containerBalance.productOptions
      : []
    // A legacy unallocated pool is safe only when exactly one product can own it.
    if (productOptions.length !== 1) return undefined
    const onlyProductId = String(productOptions[0]?.productId ?? productOptions[0]?.id ?? '')
    return onlyProductId === productId ? containerBalance : undefined
  }

  const productBalance = productBalances.find((row: any) =>
    String(row?.productId ?? row?.id ?? '') === productId
  )
  return productBalance ? { ...containerBalance, ...productBalance } : undefined
}

// A configured case deposit belongs to the physical case and is additional to
// the refundable deposits of every bottle packed inside it.
export function getFullCaseDepositAmount(item: any) {
  const containersPerCase = Math.max(1, Number(item?.containersPerCase || 1))
  const bottleDeposit = Math.max(0, Number(item?.depositAmount || 0))
  const caseDeposit = Math.max(0, Number(item?.caseDepositAmount || 0))
  return (bottleDeposit * containersPerCase) + caseDeposit
}

/**
 * How many empties from the customer's balance are consumed by `quantity` of `item`.
 * `bottleBalances` contains product sub-balances inside each container balance.
 */
export function getAutomaticEmptyCredit(
  item: any,
  quantity: number,
  bottleBalances: any[] | null | undefined
): EmptyCredit {
  if (!isReturnableGlassItem(item)) {
    return { availableEmptyBottles: 0, availableDepositBalance: 0, emptyReturnedQuantity: 0 }
  }
  // Fix: matching by container type alone let another same-size product pay this deposit.
  const customerBalance = getProductBottleBalance(item, bottleBalances)
  const availableEmpties = Math.max(0, Math.floor(Number(
    customerBalance?.bottlesAvailable ?? customerBalance?.bottlesOutstanding ?? 0
  )))
  const containersPerCase = Math.max(1, Math.floor(Number(item.containersPerCase || 1)))
  const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
  const emptyReturnedQuantity = isCase
    ? Math.min(quantity, Math.floor(availableEmpties / containersPerCase)) * containersPerCase
    : Math.min(quantity, availableEmpties)
  return {
    availableEmptyBottles: availableEmpties,
    availableDepositBalance: Math.max(0, Number(
      customerBalance?.depositAvailable ?? customerBalance?.depositBalance ?? 0
    )),
    emptyReturnedQuantity,
  }
}

/** Gross deposit charged and the portion covered by existing empties, for one line. */
export function getLineDepositAmounts(item: any) {
  if (!isReturnableGlassItem(item)) return { charged: 0, refunded: 0 }
  const quantity = Math.max(0, Number(item.quantity || 0))
  const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
  const containersPerCase = Math.max(1, Number(item.containersPerCase || 1))
  const fullCaseDeposit = getFullCaseDepositAmount(item)
  const charged = quantity * Number(isCase ? fullCaseDeposit : item.depositAmount || 0)
  const refunded = isCase
    ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase) * fullCaseDeposit
    : Number(item.emptyReturnedQuantity || 0) * Number(item.depositAmount || 0)
  return { charged, refunded: Math.min(charged, refunded) }
}
