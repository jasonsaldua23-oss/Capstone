import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDepositRefundUnitDetails, getProductDepositBalanceRows } from '@/lib/deposit-refund-units'
import { toast } from 'sonner'

/**
 * Empty-bottle returns and glass deposits for a customer: eligible products, recording returns, reserved and refundable orders, and applying deposit refunds to an order.
 */
export type CustomerEmptiesDepositsInputs = {
  onUserUpdate: ((user: any) => void) | undefined
  subView: 'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'
  user: any
}

export function useCustomerEmptiesDeposits(inputs: CustomerEmptiesDepositsInputs) {
  const {
    onUserUpdate,
    subView,
    user,
  } = inputs

  // Empty Bottles Recording State
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false)
  const [eligibleProducts, setEligibleProducts] = useState<any[]>([])
  const [isLoadingEligible, setIsLoadingEligible] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [recordCases, setRecordCases] = useState(1)
  const [recordLooseBottles, setRecordLooseBottles] = useState(0)
  const [isSubmittingEmpties, setIsSubmittingEmpties] = useState(false)
  const [emptiesTab, setEmptiesTab] = useState<'available' | 'reserved' | 'refund'>('available')
  const [reservedOrders, setReservedOrders] = useState<any[]>([])
  const [refundableOrders, setRefundableOrders] = useState<any[]>([])
  const [selectedRefundOrderId, setSelectedRefundOrderId] = useState('')
  const [refundQuantityByProduct, setRefundQuantityByProduct] = useState<Record<string, { cases: number; bottles: number }>>({})
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false)
  const [isLoadingReserved, setIsLoadingReserved] = useState(false)
  const lastFetchedReservedRef = useRef<number>(0)
  const isFetchingReservedRef = useRef<boolean>(false)
  const refundEmptyOptions = useMemo(() => (
    (Array.isArray(user?.bottleBalances) ? user.bottleBalances : [])
      .flatMap(getProductDepositBalanceRows)
      .flatMap((balance: any) => {
      const containerTypeId = String(balance?.containerTypeId || '').trim()
      const bottlesAvailable = Math.max(0, Math.floor(Number(balance?.bottlesAvailable ?? balance?.bottlesOutstanding ?? 0)))
      const isProductBalance = Array.isArray(balance?.productBalances) && balance.productBalances.length > 0
      // Product rows must use their own refundable value; the parent total may
      // include another brand that shares the same physical bottle type.
      const refundableBalance = Math.max(0, Number(
        isProductBalance
          ? balance?.depositAvailable
          : balance?.depositBalanceTotal ?? balance?.depositAvailable ?? 0
      ))
      const productOptions = Array.isArray(balance?.productOptions) ? balance.productOptions : []
      if (!containerTypeId || bottlesAvailable <= 0 || refundableBalance <= 0) return []
      return productOptions.flatMap((product: any) => {
        const productId = String(product?.id || '').trim()
        if (!productId) return []
        const unitDetails = getDepositRefundUnitDetails(product, balance)
        return [{
          key: `${productId}::${containerTypeId}`,
          productId,
          productName: String(product?.label || product?.name || 'Returnable product'),
          containerTypeId,
          containerTypeName: String(balance?.containerTypeName || 'Returnable container'),
          ...unitDetails,
          depositPerContainer: Math.max(0, Number(product?.depositAmount ?? balance?.depositAmount ?? 0)),
          containersPerCase: Math.max(1, Math.floor(Number(product?.containersPerCase ?? balance?.containersPerCase ?? 1))),
          caseDepositAmount: Math.max(0, Number(product?.caseDepositAmount ?? balance?.caseDepositAmount ?? 0)),
          bottlesAvailable,
          containerBottlesAvailable: Math.max(0, Number(balance?.containerBottlesAvailable ?? bottlesAvailable)),
          refundableBalance,
        }]
      })
    })
  ), [user?.bottleBalances])
  const selectedRefundOrder = refundableOrders.find((order: any) => String(order.id) === selectedRefundOrderId)
  const requestedRefundAmount = refundEmptyOptions.reduce(
    (total: number, option: any) => {
      const selected = refundQuantityByProduct[option.key] || { cases: 0, bottles: 0 }
      return total + (selected.cases * option.depositPerUnit) + (selected.bottles * option.depositPerContainer)
    },
    0
  )

  const fetchReservedOrders = useCallback(async (force = false) => {
    const now = Date.now()
    if (!force && now - lastFetchedReservedRef.current < 20000 && lastFetchedReservedRef.current > 0) {
      return
    }
    if (isFetchingReservedRef.current) return
    isFetchingReservedRef.current = true
    if (reservedOrders.length === 0) {
      setIsLoadingReserved(true)
    }
    try {
      const res = await fetch('/api/customer/orders', { cache: 'no-store' })
      const payload = await res.json().catch(() => ({}))
      if (res.ok && payload.success) {
        const rows = Array.isArray(payload.orders) ? payload.orders : []
        const activeWithEmpties = rows.filter((order: any) => {
          const status = String(order?.status || '').toUpperCase()
          const reqStatus = String(order?.requestStatus || order?.request_status || '').toUpperCase()
          if (['CANCELLED', 'CANCELED', 'REJECTED', 'DELIVERED', 'COMPLETED', 'FAILED', 'FAILED_DELIVERY'].includes(status)) return false
          if (['REJECTED', 'CANCELLED'].includes(reqStatus)) return false
          const items = Array.isArray(order?.items) ? order.items : []
          const hasItemEmpties = items.some((item: any) => Number(item?.emptyReturnedQuantity || item?.empty_returned_quantity || 0) > 0)
          const hasRefundClaim = (Array.isArray(order?.depositRefundClaims) ? order.depositRefundClaims : [])
            .some((claim: any) => String(claim?.status || '').toUpperCase() === 'PENDING')
          return hasItemEmpties || hasRefundClaim
        })
        const undeliveredPurchaseOrders = rows.filter((order: any) => {
          const status = String(order?.status || '').toUpperCase()
          const requestStatus = String(order?.requestStatus || order?.request_status || '').toUpperCase()
          if (['CANCELLED', 'CANCELED', 'REJECTED', 'DELIVERED', 'COMPLETED', 'FAILED', 'FAILED_DELIVERY'].includes(status)) return false
          if (['REJECTED', 'CANCELLED'].includes(requestStatus)) return false
          // A refund is attached only after the request has a real PO number.
          return Boolean(String(order?.purchaseOrderNumber || order?.purchase_order_number || '').trim())
            && Number(order?.totalAmount || order?.total_amount || 0) > 0
        })
        setReservedOrders(activeWithEmpties)
        setRefundableOrders(undeliveredPurchaseOrders)
        setSelectedRefundOrderId((current) => (
          undeliveredPurchaseOrders.some((order: any) => String(order.id) === current)
            ? current
            : String(undeliveredPurchaseOrders[0]?.id || '')
        ))
        lastFetchedReservedRef.current = Date.now()
      }
    } catch (e) {
      console.error('Failed to fetch reserved deposit orders:', e)
    } finally {
      setIsLoadingReserved(false)
      isFetchingReservedRef.current = false
    }
  }, [reservedOrders.length])

  const refreshCustomerBalances = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', {
        cache: 'no-store',
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.user) {
        // Fix: balances may have changed since the portal first loaded. Refresh
        // them before rendering exact product-and-size labels.
        onUserUpdate?.(payload.user)
      }
    } catch (error) {
      console.error('Failed to refresh customer bottle balances:', error)
    }
  }, [onUserUpdate])

  useEffect(() => {
    if (subView === 'empties-deposits') {
      void fetchReservedOrders()
      void refreshCustomerBalances()
    }
  }, [subView, fetchReservedOrders, refreshCustomerBalances])

  const fetchEligibleProducts = async () => {
    setIsLoadingEligible(true)
    try {
      const res = await fetch('/api/customer/empty-bottles/eligible', {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success && Array.isArray(data.eligibleItems)) {
        setEligibleProducts(data.eligibleItems)
        if (data.eligibleItems.length > 0) {
          const firstItem = data.eligibleItems[0]
          const recordsCases = String(firstItem?.unit || '').trim().toLowerCase() === 'case'
          setSelectedProductId(firstItem.productId)
          setRecordCases(recordsCases && firstItem.availableCasesToReturn > 0 ? 1 : 0)
          setRecordLooseBottles(!recordsCases && firstItem.availableBottlesToReturn > 0 ? 1 : 0)
        } else {
          setSelectedProductId('')
        }
      }
    } catch (e) {
      console.error('Failed to fetch eligible returnable products:', e)
    } finally {
      setIsLoadingEligible(false)
    }
  }

  const handleRecordEmpties = async () => {
    const selectedItem = eligibleProducts.find((p) => p.productId === selectedProductId)
    if (!selectedItem) {
      toast.error('Please select a product')
      return
    }
    const recordsCases = String(selectedItem.unit || '').trim().toLowerCase() === 'case'
    const containersPerCase = Math.max(1, Number(selectedItem.containersPerCase || 1))
    const selectedQuantity = recordsCases ? recordCases : recordLooseBottles
    const totalBottles = recordsCases ? recordCases * containersPerCase : recordLooseBottles
    if (totalBottles <= 0 || totalBottles > Number(selectedItem.availableBottlesToReturn || 0)) {
      const maximum = recordsCases ? selectedItem.availableCasesToReturn : selectedItem.availableBottlesToReturn
      toast.error(`Please record between 1 and ${maximum} available ${recordsCases ? 'cases' : 'bottles'}`)
      return
    }

    setIsSubmittingEmpties(true)
    try {
      const res = await fetch('/api/customer/empty-bottles/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          productId: selectedProductId,
          cases: recordsCases ? selectedQuantity : 0,
          bottles: recordsCases ? 0 : selectedQuantity,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        toast.success(data.message || 'Empty containers recorded successfully!')
        if (data.user && onUserUpdate) {
          onUserUpdate(data.user)
        }
        setIsRecordModalOpen(false)
        fetchEligibleProducts()
      } else {
        toast.error(data.error || 'Failed to record empty bottles')
      }
    } catch (e) {
      toast.error('Network error while recording empty bottles')
    } finally {
      setIsSubmittingEmpties(false)
    }
  }

  const handleApplyRefundToOrder = async () => {
    if (!selectedRefundOrder) {
      toast.error('Please select a purchase order that has not been delivered')
      return
    }
    const refundLines = refundEmptyOptions.flatMap((option: any) => {
      const selected = refundQuantityByProduct[option.key] || { cases: 0, bottles: 0 }
      const cases = Math.max(0, Math.floor(selected.cases || 0))
      const bottles = Math.max(0, Math.floor(selected.bottles || 0))
      const quantity = (cases * option.containersPerCase) + bottles
      return quantity > 0 ? [{
        productId: option.productId,
        containerTypeId: option.containerTypeId,
        quantity,
        cases,
        bottles,
      }] : []
    })
    if (refundLines.length === 0) {
      toast.error('Select the empty containers you want to refund')
      return
    }
    const requestedByContainer = new Map<string, number>()
    for (const line of refundLines) {
      requestedByContainer.set(line.containerTypeId, (requestedByContainer.get(line.containerTypeId) || 0) + line.quantity)
    }
    const exceedsContainerBalance = Array.from(requestedByContainer.entries()).some(([containerTypeId, quantity]) => {
      const option = refundEmptyOptions.find((entry: any) => entry.containerTypeId === containerTypeId)
      return quantity > Number(option?.containerBottlesAvailable || option?.bottlesAvailable || 0)
    })
    if (exceedsContainerBalance) {
      toast.error('The selected quantities exceed your available empties')
      return
    }
    const orderBalance = Math.max(0, Number(selectedRefundOrder.totalAmount || selectedRefundOrder.total_amount || 0))
    if (requestedRefundAmount > orderBalance + 0.001) {
      toast.error('The refund cannot exceed the remaining order amount')
      return
    }

    setIsSubmittingRefund(true)
    try {
      const response = await fetch(`/api/customer/orders/${selectedRefundOrder.id}/deposit-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          // Retries reuse this serialized body so the backend can return the first result.
          requestId: crypto.randomUUID(),
          depositCreditAmount: Math.round(requestedRefundAmount * 100) / 100,
          depositRefundLines: refundLines,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        toast.error(payload?.error || 'Unable to apply the deposit refund')
        return
      }
      if (payload?.user) onUserUpdate?.(payload.user)
      setRefundQuantityByProduct({})
      lastFetchedReservedRef.current = 0
      await fetchReservedOrders(true)
      toast.success(`${new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(payload?.appliedAmount || requestedRefundAmount))} was applied to the selected order.`)
    } catch {
      toast.error('Network error while applying the deposit refund')
    } finally {
      setIsSubmittingRefund(false)
    }
  }

  return {
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
  }
}

/** Everything the hook manages, for the screen that renders it. */
export type CustomerEmptiesDeposits = ReturnType<typeof useCustomerEmptiesDeposits>
