export function getMixedCaseComponentDepositProfile(component: any) {
  const product = component?.product || {}
  const containersPerCase = Math.max(1, Number(product?.containersPerCase || component?.quantityPerCase || 1))
  const caseDeposit = Math.max(0, Number(product?.caseDepositAmount || 0))
  const depositPerUnit = Math.max(
    0,
    Number(component?.depositPerUnit || product?.depositAmount || (caseDeposit > 0 ? caseDeposit / containersPerCase : 0))
  )
  return {
    containerTypeId: String(component?.containerTypeId || product?.containerTypeId || '').trim(),
    depositPerUnit,
    isReturnable: !product?.depositExempt && depositPerUnit > 0,
  }
}

// Mixed cases are charged by the actual returnable bottles contributed by each component.
export function getMixedCaseDepositAmounts(item: any) {
  const caseCount = Math.max(0, Number(item?.quantity || item?.caseCount || 0))
  return (Array.isArray(item?.components) ? item.components : []).reduce(
    (totals: { charged: number; refunded: number }, component: any) => {
      const profile = getMixedCaseComponentDepositProfile(component)
      if (!profile.isReturnable) return totals
      const bottlesPerCase = Math.max(0, Number(component?.quantityPerCase || 0))
      const emptyCovered = Math.max(0, Number(component?.emptyReturnedQuantity ?? component?.emptyCoveredQuantity ?? 0))
      return {
        charged: totals.charged + bottlesPerCase * caseCount * profile.depositPerUnit,
        refunded: totals.refunded + emptyCovered * profile.depositPerUnit,
      }
    },
    { charged: 0, refunded: 0 }
  )
}
