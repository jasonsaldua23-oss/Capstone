'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDepositRefundUnitDetails, getMaximumDepositRefundQuantity, getProductDepositBalanceRows } from '@/lib/deposit-refund-units'
import {
  Clock,
  Loader2,
  Package,
  Info,
  ArrowLeft,
  Minus,
  Plus,
  Recycle,
  WalletCards,
} from 'lucide-react'
import type { CustomerEmptiesDeposits } from './use-customer-empties-deposits'

/**
 * Empty bottles and glass deposits: balances, recording returns, reserved orders, and applying refunds.
 */
export type EmptiesDepositsScreenProps = {
  eligibleProducts: CustomerEmptiesDeposits['eligibleProducts']
  emptiesTab: CustomerEmptiesDeposits['emptiesTab']
  fetchEligibleProducts: CustomerEmptiesDeposits['fetchEligibleProducts']
  handleApplyRefundToOrder: CustomerEmptiesDeposits['handleApplyRefundToOrder']
  handleRecordEmpties: CustomerEmptiesDeposits['handleRecordEmpties']
  isLoadingEligible: CustomerEmptiesDeposits['isLoadingEligible']
  isLoadingReserved: CustomerEmptiesDeposits['isLoadingReserved']
  isRecordModalOpen: CustomerEmptiesDeposits['isRecordModalOpen']
  isSubmittingEmpties: CustomerEmptiesDeposits['isSubmittingEmpties']
  isSubmittingRefund: CustomerEmptiesDeposits['isSubmittingRefund']
  recordCases: CustomerEmptiesDeposits['recordCases']
  recordLooseBottles: CustomerEmptiesDeposits['recordLooseBottles']
  refundEmptyOptions: CustomerEmptiesDeposits['refundEmptyOptions']
  refundQuantityByProduct: CustomerEmptiesDeposits['refundQuantityByProduct']
  refundableOrders: CustomerEmptiesDeposits['refundableOrders']
  requestedRefundAmount: CustomerEmptiesDeposits['requestedRefundAmount']
  reservedOrders: CustomerEmptiesDeposits['reservedOrders']
  selectedProductId: CustomerEmptiesDeposits['selectedProductId']
  selectedRefundOrderId: CustomerEmptiesDeposits['selectedRefundOrderId']
  setEmptiesTab: CustomerEmptiesDeposits['setEmptiesTab']
  setIsRecordModalOpen: CustomerEmptiesDeposits['setIsRecordModalOpen']
  setRecordCases: CustomerEmptiesDeposits['setRecordCases']
  setRecordLooseBottles: CustomerEmptiesDeposits['setRecordLooseBottles']
  setRefundQuantityByProduct: CustomerEmptiesDeposits['setRefundQuantityByProduct']
  setSelectedProductId: CustomerEmptiesDeposits['setSelectedProductId']
  setSelectedRefundOrderId: CustomerEmptiesDeposits['setSelectedRefundOrderId']
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
  user: any
}

export function EmptiesDepositsScreen({
  eligibleProducts,
  emptiesTab,
  fetchEligibleProducts,
  handleApplyRefundToOrder,
  handleRecordEmpties,
  isLoadingEligible,
  isLoadingReserved,
  isRecordModalOpen,
  isSubmittingEmpties,
  isSubmittingRefund,
  recordCases,
  recordLooseBottles,
  refundEmptyOptions,
  refundQuantityByProduct,
  refundableOrders,
  requestedRefundAmount,
  reservedOrders,
  selectedProductId,
  selectedRefundOrderId,
  setEmptiesTab,
  setIsRecordModalOpen,
  setRecordCases,
  setRecordLooseBottles,
  setRefundQuantityByProduct,
  setSelectedProductId,
  setSelectedRefundOrderId,
  setSubView,
  user,
}: EmptiesDepositsScreenProps) {
  const bottleBalances = (Array.isArray(user?.bottleBalances) ? user.bottleBalances : [])
    .flatMap(getProductDepositBalanceRows)
  const formatDeposit = (amount: unknown) => new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(Number(amount) || 0)

  const selectedItem = eligibleProducts.find((p) => p.productId === selectedProductId)
  const selectedItemIsCase = String(selectedItem?.unit || '').trim().toLowerCase() === 'case'

  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
      <div className="flex items-center justify-between gap-3 px-4 pt-5 pb-1">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('menu')}
            aria-label="Back to profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Empties &amp; Deposits</h2>
        </div>

        <Button
          type="button"
          size="sm"
          className="gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500"
          onClick={() => {
            setIsRecordModalOpen(true)
            fetchEligibleProducts()
          }}
        >
          <Plus className="h-4 w-4" />
          <span>Record Empties</span>
        </Button>
      </div>

      {/* Available balances, active reservations, and post-checkout refunds share one view. */}
      <div className="mx-4 mb-3 flex rounded-2xl bg-slate-100/80 p-1">
        <button
          type="button"
          onClick={() => setEmptiesTab('available')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all ${
            emptiesTab === 'available'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Recycle className="h-3.5 w-3.5 text-emerald-600" />
          <span>Available</span>
        </button>
        <button
          type="button"
          onClick={() => setEmptiesTab('reserved')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all ${
            emptiesTab === 'reserved'
              ? 'bg-white text-blue-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Package className="h-3.5 w-3.5 text-blue-600" />
          <span>Reserved</span>
          {reservedOrders.length > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
              {reservedOrders.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setEmptiesTab('refund')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all ${
            emptiesTab === 'refund'
              ? 'bg-white text-amber-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <WalletCards className="h-3.5 w-3.5 text-amber-600" />
          <span>Refund Empties</span>
        </button>
      </div>

      {emptiesTab === 'available' ? (
        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          <div className="border-b border-slate-100 px-4 py-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">Available Empty Containers</h3>
              <p className="mt-0.5 text-xs text-slate-500">Available empty containers applied automatically at checkout.</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <Recycle className="h-4 w-4" />
            </span>
          </div>

          {bottleBalances.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {bottleBalances.map((balance: any) => {
                const bottlesAvailable = Number.isFinite(Number(balance.bottlesAvailable))
                  ? Math.max(0, Math.floor(Number(balance.bottlesAvailable)))
                  : Math.max(0, Math.floor(Number(balance.bottlesOutstanding || 0)))
                const reservedBottles = Math.max(0, Math.floor(Number(balance.bottlesReserved || 0)))
                const productOptions = Array.isArray(balance.productOptions) ? balance.productOptions : []
                const productUnits = productOptions.map((product: any) => String(product?.unit || '').trim().toLowerCase())
                const isCaseFormat = productUnits.length > 0
                  ? productUnits.every((unit: string) => unit === 'case')
                  : String(balance.unit || '').trim().toLowerCase() === 'case'
                const unitDetails = getDepositRefundUnitDetails(
                  isCaseFormat ? productOptions[0] : { ...productOptions[0], unit: 'bottle' },
                  balance
                )
                const availableQuantity = Math.floor(bottlesAvailable / unitDetails.containersPerUnit)
                const reservedQuantity = Math.floor(reservedBottles / unitDetails.containersPerUnit)
                const hasReserved = reservedQuantity > 0
                const depositAvailable = Math.min(
                  Math.max(0, Number(balance.depositBalanceTotal ?? balance.depositBalance ?? 0)),
                  availableQuantity * unitDetails.depositPerUnit
                )

                return (
                  <div key={`${balance.containerTypeId}-${balance.productId || balance.productIds?.[0] || 'balance'}`} className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        {/* Fix: show each exact stored product name with its size. */}
                        <p className="text-sm font-semibold leading-5 text-slate-800">
                          {balance.productLabel || balance.productName || balance.containerTypeName || 'Returnable container'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Deposit value: <span className="font-semibold text-emerald-700">{formatDeposit(unitDetails.depositPerUnit)}/{unitDetails.unitLabel}</span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-lg font-bold ${availableQuantity > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                          {availableQuantity}
                        </p>
                        <p className="text-xs text-slate-500">
                          empty {isCaseFormat ? 'case' : 'bottle'}{availableQuantity !== 1 ? 's' : ''} available
                        </p>
                        <p className={`mt-0.5 text-xs font-semibold ${depositAvailable > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {formatDeposit(depositAvailable)} credit
                        </p>
                      </div>
                    </div>

                    {hasReserved && (
                      <div className="mt-2.5 flex items-center justify-between rounded-xl bg-blue-50/70 px-3 py-1.5 text-[11px] text-blue-800">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-blue-600" />
                          <span>Reserved in active orders:</span>
                        </span>
                        <span className="font-bold">
                          {reservedQuantity} {unitDetails.unitLabel}{reservedQuantity !== 1 ? 's' : ''}
                          {' '}({formatDeposit(balance.depositReserved || 0)})
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <div className="mx-auto mb-2.5 grid h-10 w-10 place-items-center rounded-2xl bg-slate-50 text-slate-400">
                <Recycle className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No Empty Bottles Recorded</p>
              <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
                Have empty cases at home from past purchases? Click <strong>"Record Empties"</strong> to declare them in cases and waive container deposits on your next order.
              </p>
            </div>
          )}
        </div>
      ) : emptiesTab === 'reserved' ? (
        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          <div className="border-b border-slate-100 px-4 py-3.5 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">Used or Reserved Deposits</h3>
              <p className="mt-0.5 text-xs text-slate-500">Deposits locked in pending and active orders. Released if cancelled.</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <Package className="h-4 w-4" />
            </span>
          </div>

          {isLoadingReserved && reservedOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading active reservations...</div>
          ) : reservedOrders.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {reservedOrders.map((order: any) => {
                const itemsWithEmpties = (Array.isArray(order?.items) ? order.items : []).filter(
                  (i: any) => Number(i?.emptyReturnedQuantity || i?.empty_returned_quantity || 0) > 0
                )
                const refundClaims = (Array.isArray(order?.depositRefundClaims) ? order.depositRefundClaims : []).filter(
                  (claim: any) => String(claim?.status || '').toUpperCase() === 'PENDING'
                )
                const automaticDepositCovered = itemsWithEmpties.reduce((sum: number, item: any) => {
                  const refund = Number(item?.depositRefunded || item?.deposit_refunded || 0)
                  return sum + refund
                }, 0) || Number(order?.depositRefundTotal || order?.deposit_refund_total || 0)
                const requestedRefundCovered = refundClaims.reduce(
                  (sum: number, claim: any) => sum + Number(claim?.requestedAmount || 0),
                  0
                )
                const totalDepositCovered = automaticDepositCovered + requestedRefundCovered

                return (
                  <div key={order.id} className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{order.purchaseRequestNumber || order.purchase_request_number || order.orderNumber || order.order_number}</p>
                        <p className="text-[11px] text-slate-400">
                          {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'Active Order'}
                        </p>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 border border-blue-100">
                        {String(order.requestStatus || order.status || 'PENDING').replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="rounded-2xl bg-slate-50 p-3 space-y-1.5 text-xs text-slate-600">
                      {itemsWithEmpties.map((item: any, idx: number) => {
                        const empties = Number(item?.emptyReturnedQuantity || item?.empty_returned_quantity || 0)
                        const perCase = Math.max(1, Number(item?.containersPerCase || item?.quantityPerCase || item?.product?.quantityPerCase || 1))
                        const cases = Math.floor(empties / perCase)
                        const loose = empties % perCase
                        const depositRefund = Number(item?.depositRefunded || item?.deposit_refunded || 0) || (automaticDepositCovered > 0 && itemsWithEmpties.length === 1 ? automaticDepositCovered : 0)

                        return (
                          <div key={idx} className="flex items-center justify-between">
                            <span className="font-medium text-slate-800 truncate mr-2">
                              {item?.productName || item?.product_name || 'Returnable Product'}
                            </span>
                            <span className="shrink-0 font-semibold text-slate-700">
                              {cases > 0 ? `${cases} case${cases !== 1 ? 's' : ''}` : ''}
                              {cases > 0 && loose > 0 ? ' + ' : ''}
                              {loose > 0 ? `${loose} loose` : ''}
                              {depositRefund > 0 ? ` (${formatDeposit(depositRefund)})` : ''}
                            </span>
                          </div>
                        )
                      })}
                      {refundClaims.map((claim: any) => {
                        const matchingBalance = bottleBalances.find(
                          (balance: any) => String(balance?.containerTypeId || '') === String(claim?.containerTypeId || '')
                        )
                        const perCase = Math.max(1, Number(matchingBalance?.containersPerCase || 1))
                        const quantity = Math.max(0, Number(claim.requestedQuantity || 0))
                        const hasStoredBreakdown = Number(claim.requestedCases || 0) > 0 || Number(claim.requestedLooseBottles || 0) > 0
                        const cases = hasStoredBreakdown
                          ? Math.max(0, Number(claim.requestedCases || 0))
                          : (perCase > 1 ? Math.floor(quantity / perCase) : 0)
                        const bottles = hasStoredBreakdown
                          ? Math.max(0, Number(claim.requestedLooseBottles || 0))
                          : (perCase > 1 ? quantity % perCase : quantity)

                        return (
                          <div key={claim.id} className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-slate-800">{claim.productName || claim.containerTypeName || 'Returnable Product'}</span>
                            <span className="shrink-0 font-semibold text-slate-700">
                              {cases > 0 ? `${cases} case${cases === 1 ? '' : 's'}` : ''}
                              {cases > 0 && bottles > 0 ? ' + ' : ''}
                              {bottles > 0 ? `${bottles} bottle${bottles === 1 ? '' : 's'}` : ''}
                              {' '}({formatDeposit(claim.requestedAmount)})
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-500 font-medium">Total Locked Deposit Credit</span>
                      <span className="font-bold text-emerald-700">{formatDeposit(totalDepositCovered || order?.depositRefundTotal || order?.deposit_refund_total || 0)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <div className="mx-auto mb-2.5 grid h-10 w-10 place-items-center rounded-2xl bg-slate-50 text-slate-400">
                <Package className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No Used or Reserved Deposits</p>
              <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
                You do not have any active orders currently reserving empty containers. All recorded empties are available for checkout.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">Refund Empties to a Purchase Order</h3>
              <p className="mt-0.5 text-xs text-slate-500">Reduce a PO that has not been delivered and have the driver collect the selected empties.</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <WalletCards className="h-4 w-4" />
            </span>
          </div>

          {isLoadingReserved && refundableOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading undelivered purchase orders...</div>
          ) : refundableOrders.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-700">No Undelivered Purchase Orders</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">A deposit refund can only be applied to a PO before it is delivered.</p>
            </div>
          ) : refundEmptyOptions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-700">No Available Empties</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">Your recorded empties are already reserved or have no refundable balance.</p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="refund-order" className="text-xs font-semibold text-slate-700">Apply refund to purchase order</Label>
                <select
                  id="refund-order"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
                  value={selectedRefundOrderId}
                  onChange={(event) => {
                    setSelectedRefundOrderId(event.target.value)
                    setRefundQuantityByProduct({})
                  }}
                >
                  {refundableOrders.map((order: any) => (
                    <option key={order.id} value={order.id}>
                      {order.purchaseOrderNumber || order.purchase_order_number} — {formatDeposit(Math.max(0, Number(order.totalAmount || 0)))} total
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2.5">
                {refundEmptyOptions.map((option: any) => {
                  const containersPerCase = Math.max(1, Number(option.containersPerCase || 1))
                  const supportsCases = option.unitType === 'CASE'
                  const selected = refundQuantityByProduct[option.key] || { cases: 0, bottles: 0 }
                  const selectedCases = supportsCases ? Math.max(0, selected.cases) : 0
                  const selectedBottles = supportsCases ? 0 : Math.max(0, selected.bottles)
                  const selectedQuantity = (selectedCases * containersPerCase) + selectedBottles
                  const availableCases = supportsCases ? Math.floor(option.bottlesAvailable / containersPerCase) : 0
                  const availableBottles = supportsCases ? 0 : option.bottlesAvailable
                  const maximumQuantity = getMaximumDepositRefundQuantity(
                    option.bottlesAvailable,
                    option.refundableBalance,
                    option
                  )
                  const maximumCases = supportsCases ? maximumQuantity : 0
                  const maximumBottles = supportsCases ? 0 : maximumQuantity

                  // Fix: keep only the quantity that matches this product's
                  // packaging type while retaining the API's case/bottle shape.
                  const updateCaseAndBottleQuantity = (cases: number, bottles: number) => {
                    setRefundQuantityByProduct((current) => ({
                      ...current,
                      [option.key]: {
                        cases: supportsCases ? Math.max(0, Math.floor(cases || 0)) : 0,
                        bottles: Math.max(0, Math.floor(bottles || 0)),
                      },
                    }))
                  }

                  return (
                    <div key={option.key} className="rounded-2xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{option.productName}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {option.containerTypeName} · {supportsCases ? `${formatDeposit(option.depositPerUnit)}/case` : `${formatDeposit(option.depositPerContainer)}/bottle`}
                          </p>
                          <p className="mt-1 text-xs font-medium text-emerald-700">
                            {availableCases > 0 ? `${availableCases} case${availableCases === 1 ? '' : 's'}` : ''}
                            {availableCases > 0 && availableBottles > 0 ? ' + ' : ''}
                            {availableBottles > 0 ? `${availableBottles} bottle${availableBottles === 1 ? '' : 's'}` : ''}
                            {' available'}
                          </p>
                        </div>
                        <div className="grid w-20 shrink-0 grid-cols-1 gap-2">
                          {supportsCases ? <div className="space-y-1">
                            <Label htmlFor={`profile-refund-cases-${option.key}`} className="text-[10px] font-semibold text-slate-500">Cases</Label>
                            <Input
                              id={`profile-refund-cases-${option.key}`}
                              type="number"
                              min="0"
                              max={maximumCases}
                              step="1"
                              value={selectedCases || ''}
                              onChange={(event) => updateCaseAndBottleQuantity(
                                Math.min(Number(event.target.value || 0), maximumCases),
                                selectedBottles
                              )}
                              placeholder="0"
                              aria-label={`Cases of ${option.productName}`}
                            />
                          </div> : null}
                          {!supportsCases ? <div className="space-y-1">
                            <Label htmlFor={`profile-refund-bottles-${option.key}`} className="text-[10px] font-semibold text-slate-500">Bottles</Label>
                            <Input
                              id={`profile-refund-bottles-${option.key}`}
                              type="number"
                              min="0"
                              max={maximumBottles}
                              step="1"
                              value={selectedBottles || ''}
                              onChange={(event) => updateCaseAndBottleQuantity(
                                selectedCases,
                                Math.min(Number(event.target.value || 0), maximumBottles)
                              )}
                              placeholder="0"
                              aria-label={`Loose bottles of ${option.productName}`}
                            />
                          </div> : null}
                        </div>
                      </div>
                      {selectedQuantity > 0 ? (
                        <p className="mt-2 text-[11px] font-semibold text-amber-700">
                          Selected: {selectedCases > 0 ? `${selectedCases} case${selectedCases === 1 ? '' : 's'}` : ''}
                          {selectedCases > 0 && selectedBottles > 0 ? ' + ' : ''}
                          {selectedBottles > 0 ? `${selectedBottles} bottle${selectedBottles === 1 ? '' : 's'}` : ''}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              <div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Refund applied to order</span>
                  <span className="text-sm font-bold">-{formatDeposit(requestedRefundAmount)}</span>
                </div>
                <p className="mt-1 text-amber-800">The driver will confirm and collect these empties during delivery.</p>
              </div>

              <Button
                type="button"
                className="h-11 w-full rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-500"
                disabled={isSubmittingRefund || requestedRefundAmount <= 0}
                onClick={handleApplyRefundToOrder}
              >
                {isSubmittingRefund ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />}
                Apply Refund to PO
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Record Empty Bottles Dialog */}
      <Dialog open={isRecordModalOpen} onOpenChange={setIsRecordModalOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Recycle className="h-5 w-5 text-emerald-600" />
              Record Empty Containers
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Declare empties from past orders using each product&apos;s packaging type.
            </DialogDescription>
          </DialogHeader>

          {isLoadingEligible ? (
            <div className="py-8 text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-600 mx-auto" />
              <p className="text-xs text-slate-500">Checking your returnable purchase history...</p>
            </div>
          ) : eligibleProducts.length === 0 ? (
            <div className="py-6 text-center space-y-2">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
                <Info className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800">No Eligible Returnable History</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                You have no unreturned glass case purchases on record. Empty bottles can only be declared for returnable glass products previously purchased from our store.
              </p>
              <div className="pt-2">
                <Button
                  variant="outline"
                  className="rounded-xl text-xs"
                  onClick={() => setIsRecordModalOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              {/* Product Select */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Select Purchased Beverage</Label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-2xs focus:border-emerald-600 focus:outline-none"
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value)
                    const nextItem = eligibleProducts.find((item) => item.productId === e.target.value)
                    const recordsCases = String(nextItem?.unit || '').trim().toLowerCase() === 'case'
                    setRecordCases(recordsCases && Number(nextItem?.availableCasesToReturn || 0) > 0 ? 1 : 0)
                    setRecordLooseBottles(!recordsCases && Number(nextItem?.availableBottlesToReturn || 0) > 0 ? 1 : 0)
                  }}
                >
                  {eligibleProducts.map((prod) => (
                    <option key={prod.productId} value={prod.productId}>
                      {prod.productName} ({String(prod.unit || '').toLowerCase() === 'case'
                        ? `${prod.availableCasesToReturn} case${prod.availableCasesToReturn === 1 ? '' : 's'}`
                        : `${prod.availableBottlesToReturn} bottle${prod.availableBottlesToReturn === 1 ? '' : 's'}`} available)
                    </option>
                  ))}
                </select>
              </div>

              {selectedItem ? (
                <>
                  {/* Fix: show only the quantity control matching the product unit. */}
                  {selectedItemIsCase ? <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-slate-700">Number of Cases to Return</Label>
                      <span className="text-[11px] font-medium text-emerald-700">
                        Max available: {selectedItem.availableCasesToReturn} case(s)
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-2">
                      <span className="text-xs font-medium text-slate-600 pl-2">
                        {recordCases} case{recordCases === 1 ? '' : 's'}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-xl bg-white border-slate-200"
                          disabled={recordCases <= 0}
                          onClick={() => setRecordCases((prev) => Math.max(0, prev - 1))}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="min-w-[2rem] text-center text-sm font-bold text-slate-900">
                          {recordCases}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-xl bg-white border-slate-200"
                          disabled={recordCases >= selectedItem.availableCasesToReturn}
                          onClick={() => setRecordCases((prev) => {
                            const nextCases = Math.min(selectedItem.availableCasesToReturn, prev + 1)
                            const nextLooseMax = Math.max(0, Math.min(
                              selectedItem.containersPerCase - 1,
                              selectedItem.availableBottlesToReturn - (nextCases * selectedItem.containersPerCase),
                            ))
                            setRecordLooseBottles((loose) => Math.min(loose, nextLooseMax))
                            return nextCases
                          })}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div> : null}

                  {!selectedItemIsCase ? <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-slate-700">Number of Bottles to Return</Label>
                      <span className="text-[11px] font-medium text-emerald-700">
                        Max available: {selectedItem.availableBottlesToReturn} bottle(s)
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-2">
                      <span className="pl-2 text-xs font-medium text-slate-600">
                        {recordLooseBottles} bottle{recordLooseBottles === 1 ? '' : 's'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-xl border-slate-200 bg-white"
                          disabled={recordLooseBottles <= 0}
                          onClick={() => setRecordLooseBottles((prev) => Math.max(0, prev - 1))}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="min-w-[2rem] text-center text-sm font-bold text-slate-900">
                          {recordLooseBottles}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-xl border-slate-200 bg-white"
                          disabled={recordLooseBottles >= selectedItem.availableBottlesToReturn}
                          onClick={() => setRecordLooseBottles((prev) => Math.min(selectedItem.availableBottlesToReturn, prev + 1))}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div> : null}

                  {/* Deposit Preview Card */}
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between font-semibold text-emerald-900">
                      <span>Deposit Credit to Apply:</span>
                      <span className="text-sm font-bold text-emerald-700">
                        {formatDeposit(selectedItemIsCase
                          ? recordCases * selectedItem.caseDeposit
                          : recordLooseBottles * selectedItem.unitDeposit)}
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-800 leading-snug">
                      ✓ Recorded balance: {selectedItemIsCase
                        ? `${recordCases} case${recordCases === 1 ? '' : 's'}`
                        : `${recordLooseBottles} bottle${recordLooseBottles === 1 ? '' : 's'}`}.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 rounded-xl text-xs"
                      onClick={() => setIsRecordModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="flex-1 rounded-xl bg-emerald-600 text-xs font-bold text-white shadow-xs hover:bg-emerald-500"
                      disabled={isSubmittingEmpties || (selectedItemIsCase ? recordCases : recordLooseBottles) <= 0}
                      onClick={handleRecordEmpties}
                    >
                      {isSubmittingEmpties ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Recording...
                        </>
                      ) : (
                        selectedItemIsCase
                          ? `Record ${recordCases} case${recordCases === 1 ? '' : 's'}`
                          : `Record ${recordLooseBottles} bottle${recordLooseBottles === 1 ? '' : 's'}`
                      )}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
