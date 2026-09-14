export type DepositRefundUnitType = 'CASE' | 'BOTTLE'

export type DepositRefundUnitDetails = {
  unitType: DepositRefundUnitType
  unitLabel: 'case' | 'bottle'
  containersPerUnit: number
  depositPerUnit: number
}

import { getFullCaseDepositAmount } from '@shared/customer-logic/empty-credit'

// A container balance can hold several products. Consumers render and select the
// product rows while retaining the parent container id used for shared safeguards.
export function getProductDepositBalanceRows(balance: any): any[] {
  const productBalances = Array.isArray(balance?.productBalances) ? balance.productBalances : []
  if (productBalances.length > 0) {
    return productBalances.map((productBalance: any) => ({
      ...balance,
      containerBottlesAvailable: balance.bottlesAvailable,
      ...productBalance,
      productOptions: [productBalance],
      productIds: [productBalance.productId || productBalance.id],
    }))
  }

  const productOptions = Array.isArray(balance?.productOptions) ? balance.productOptions : []
  // Fix: even zero/legacy balances render each product independently instead of
  // combining same-size, same-price products into one misleading row.
  return productOptions.length > 0
    ? productOptions.map((product: any) => ({
      ...balance,
      ...product,
      productId: product.productId || product.id,
      productName: product.name,
      productLabel: product.label || product.name,
      productOptions: [product],
      productIds: [product.productId || product.id],
      bottlesAvailable: 0,
      bottlesOutstanding: 0,
      depositAvailable: 0,
      depositBalance: 0,
    }))
    : [balance]
}

// Fix: manual refunds must use the selected product's sales unit and matching
// deposit price instead of treating every returnable container as one bottle.
export function getDepositRefundUnitDetails(product: any, balance: any): DepositRefundUnitDetails {
  const unitType: DepositRefundUnitType = String(product?.unit || '').trim().toLowerCase() === 'case'
    ? 'CASE'
    : 'BOTTLE'
  const containersPerCase = Math.max(1, Math.floor(Number(product?.containersPerCase ?? balance?.containersPerCase ?? 1)))
  const depositPerBottle = Math.max(0, Number(product?.depositAmount ?? balance?.depositAmount ?? 0))
  const caseDeposit = getFullCaseDepositAmount({
    depositAmount: depositPerBottle,
    containersPerCase,
    caseDepositAmount: product?.caseDepositAmount ?? balance?.caseDepositAmount ?? 0,
  })

  return unitType === 'CASE'
    ? { unitType, unitLabel: 'case', containersPerUnit: containersPerCase, depositPerUnit: caseDeposit }
    : { unitType, unitLabel: 'bottle', containersPerUnit: 1, depositPerUnit: depositPerBottle }
}

export function getMaximumDepositRefundQuantity(
  availableContainers: number,
  availableDepositBalance: number,
  details: DepositRefundUnitDetails
) {
  if (details.depositPerUnit <= 0 || details.containersPerUnit <= 0) return 0
  return Math.max(0, Math.min(
    Math.floor(Math.max(0, availableContainers) / details.containersPerUnit),
    Math.floor((Math.max(0, availableDepositBalance) + 0.000001) / details.depositPerUnit)
  ))
}

export function serializeDepositRefundQuantity(line: {
  quantity: number
  unitType: DepositRefundUnitType
  containersPerUnit: number
}) {
  const selectedUnits = Math.max(0, Math.floor(Number(line.quantity || 0)))
  const cases = line.unitType === 'CASE' ? selectedUnits : 0
  const bottles = line.unitType === 'BOTTLE' ? selectedUnits : 0
  return {
    quantity: (cases * Math.max(1, Math.floor(Number(line.containersPerUnit || 1)))) + bottles,
    cases,
    bottles,
  }
}
