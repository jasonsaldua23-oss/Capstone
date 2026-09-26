import { useEffect, useMemo } from 'react'
import { emitDataSync } from '@/lib/data-sync'
import { toast } from 'sonner'
import { validatePersonName } from '@/lib/person-name'
import { getMixedCaseComponentDepositProfile, getMixedCaseDepositAmounts } from '@/components/portals/shared/mixed-case-deposit'
import { getAutomaticEmptyCredit, getLineDepositAmounts, getProductBottleBalance } from '@shared/customer-logic/empty-credit'
import { type DepositRefundLine, type DepositRefundOption } from '../checkout/checkout-view'
import { createCustomerOrder, quoteMixedCase } from '../orders/orders-api'
import type { CartItem, Product } from '../shared/customer-types'
import { SERVICE_AREA_MESSAGE } from '@/lib/service-area'
import { getDepositRefundUnitDetails, getMaximumDepositRefundQuantity, getProductDepositBalanceRows, serializeDepositRefundQuantity } from '@/lib/deposit-refund-units'
import { createClientRequestId, getLocalDateOnly, parseDateOnly } from '../../customer-portal-utils'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import type { CustomerPortalState } from '../layout/portal-state'
import type { AuthUser } from '@/types'

/**
 * The customer cart: adding and adjusting items, empties credits, deposit refunds, discount breakdown, stock checks, placing the order, and buy-again.
 */
export type CustomerCartInputs = {
  cart: CustomerPortalState['cart']
  checkoutRequestRef: MutableRefObject<{ payloadKey: string; requestId: string } | null>
  composedShippingAddress: string
  customerDiscountAmountPerCase: number
  customerDiscountOption: string
  customerDiscountPercent: number
  customerDiscountStatus: string
  deliveryDate: CustomerPortalState['deliveryDate']
  depositRefundLines: DepositRefundLine[]
  fetchProducts: (silent?: boolean) => Promise<Product[] | null>
  isInServiceArea: (lat: number, lng: number) => boolean
  loadCustomerProfile: (silent?: boolean) => Promise<void>
  notes: CustomerPortalState['notes']
  pendingCartProduct: CustomerPortalState['pendingCartProduct']
  pendingCartQty: CustomerPortalState['pendingCartQty']
  products: CustomerPortalState['products']
  selectedCartIds: CustomerPortalState['selectedCartIds']
  setActiveView: CustomerPortalState['setActiveView']
  setCart: CustomerPortalState['setCart']
  setDepositRefundLines: Dispatch<SetStateAction<DepositRefundLine[]>>
  setEditingMixedCase: CustomerPortalState['setEditingMixedCase']
  setIsAddToCartDialogOpen: CustomerPortalState['setIsAddToCartDialogOpen']
  setIsAddressDialogOpen: CustomerPortalState['setIsAddressDialogOpen']
  setIsMixedCaseBuilderOpen: CustomerPortalState['setIsMixedCaseBuilderOpen']
  setIsOrderConfirmationOpen: Dispatch<SetStateAction<boolean>>
  setIsPlacingOrder: CustomerPortalState['setIsPlacingOrder']
  setLastPlacedOrderNumber: Dispatch<SetStateAction<string>>
  setNotes: CustomerPortalState['setNotes']
  setOrders: CustomerPortalState['setOrders']
  setOrdersSearch: CustomerPortalState['setOrdersSearch']
  setOrdersTab: CustomerPortalState['setOrdersTab']
  setPendingCartProduct: CustomerPortalState['setPendingCartProduct']
  setPendingCartQty: CustomerPortalState['setPendingCartQty']
  setSelectedCartIds: CustomerPortalState['setSelectedCartIds']
  setUser: Dispatch<SetStateAction<AuthUser | null>>
  shippingCity: CustomerPortalState['shippingCity']
  shippingCountry: CustomerPortalState['shippingCountry']
  shippingLatitude: CustomerPortalState['shippingLatitude']
  shippingLongitude: CustomerPortalState['shippingLongitude']
  shippingName: CustomerPortalState['shippingName']
  shippingPhone: CustomerPortalState['shippingPhone']
  shippingProvince: CustomerPortalState['shippingProvince']
  shippingStreetName: CustomerPortalState['shippingStreetName']
  shippingZipCode: CustomerPortalState['shippingZipCode']
  user: AuthUser | null
}

export function useCustomerCart(inputs: CustomerCartInputs) {
  const {
    cart,
    checkoutRequestRef,
    composedShippingAddress,
    customerDiscountAmountPerCase,
    customerDiscountOption,
    customerDiscountPercent,
    customerDiscountStatus,
    deliveryDate,
    depositRefundLines,
    fetchProducts,
    isInServiceArea,
    loadCustomerProfile,
    notes,
    pendingCartProduct,
    pendingCartQty,
    products,
    selectedCartIds,
    setActiveView,
    setCart,
    setDepositRefundLines,
    setEditingMixedCase,
    setIsAddToCartDialogOpen,
    setIsAddressDialogOpen,
    setIsMixedCaseBuilderOpen,
    setIsOrderConfirmationOpen,
    setIsPlacingOrder,
    setLastPlacedOrderNumber,
    setNotes,
    setOrders,
    setOrdersSearch,
    setOrdersTab,
    setPendingCartProduct,
    setPendingCartQty,
    setSelectedCartIds,
    setUser,
    shippingCity,
    shippingCountry,
    shippingLatitude,
    shippingLongitude,
    shippingName,
    shippingPhone,
    shippingProvince,
    shippingStreetName,
    shippingZipCode,
    user,
  } = inputs

  const getCartItemAvailable = (item: any): number | null => {
    const raw = Number(item?.available)
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : null
  }

  const getAvailableQty = (product: Product) => {
    const explicitAvailable = Number((product as any)?.availableQuantity)
    if (Number.isFinite(explicitAvailable)) {
      return Math.max(0, Math.floor(explicitAvailable))
    }
    return (product.inventory || []).reduce((sum, inv) => sum + Math.max(0, inv.quantity - inv.reservedQuantity), 0)
  }

  const getProductSizeLabel = (product: Product) => {
    const sizes = Array.isArray((product as any)?.sizes)
      ? (product as any).sizes.map((s: any) => String(s).trim()).filter(Boolean)
      : []
    if (sizes.length > 0) return sizes.join(', ')
    const fallback = String((product as any)?.sizeLabel || (product as any)?.size || '').trim()
    return fallback || String((product as any)?.unit || '').trim() || 'case'
  }

  const isReturnableGlassItem = (item: any) => {
    if (!item) return false
    if (item.packagingType !== 'RETURNABLE' || item.depositExempt) return false
    const hasDeposit = Number(item.caseDepositAmount || item.depositAmount || 0) > 0
    return Boolean(hasDeposit && item.containerTypeId)
  }

  const applyAutomaticEmptyCredit = (item: CartItem, quantity: number): CartItem => {
    // Fix: automatic credit must follow the product sub-balance, not a same-size container pool.
    const credit = getAutomaticEmptyCredit(item, quantity, user?.bottleBalances)
    return {
      ...item,
      quantity,
      ...credit,
    }
  }

  const addToCart = (product: Product, requestedQty = 1) => {
    const available = getAvailableQty(product)
    const qty = Math.max(1, Math.floor(Number(requestedQty || 1)))
    if (available <= 0) {
      toast.error('This item is out of stock')
      return
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id)
      if (!existing) {
        const newItem: CartItem = {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          imageUrl: product.imageUrl || null,
          unit: product.unit,
          sizeLabel: getProductSizeLabel(product),
          category: String((product as any)?.category?.name || (product as any)?.category || '').trim() || undefined,
          containerPackagingType: product.containerPackagingType,
          looseUnit: product.looseUnit,
          packagingCompatibilityKey: product.packagingCompatibilityKey,
          depositExempt: product.depositExempt,
          unitPrice: product.price,
          quantity: Math.min(qty, available),
          available,
          packagingType: product.packagingType,
          containerTypeId: product.containerTypeId,
          containerTypeName: product.containerTypeName,
          containersPerCase: product.containersPerCase,
          depositAmount: product.depositAmount,
          caseDepositAmount: product.caseDepositAmount,
        }
        return [
          ...prev,
          applyAutomaticEmptyCredit(newItem, newItem.quantity),
        ]
      }
      if (existing.quantity >= available) return prev
      return prev.map((i) =>
        i.productId === product.id
          ? applyAutomaticEmptyCredit({
            ...i,
            available,
            imageUrl: i.imageUrl || product.imageUrl || null,
            sizeLabel: i.sizeLabel || getProductSizeLabel(product),
            category:
              String((i as any)?.category || '').trim() ||
              String((product as any)?.category?.name || (product as any)?.category || '').trim() ||
              undefined,
            containerPackagingType: product.containerPackagingType,
            looseUnit: product.looseUnit,
            packagingCompatibilityKey: product.packagingCompatibilityKey,
            depositExempt: product.depositExempt,
          }, Math.min(existing.quantity + qty, available))
          : i
      )
    })
    setSelectedCartIds((prev) => {
      if (prev.has(product.id)) return prev
      const next = new Set(prev)
      next.add(product.id)
      return next
    })
  }

  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0) return
    setCart((prev) =>
      prev.map((item) => {
        if (item.itemType === 'MIXED_CASE') {
          // Refresh component product data so persisted mixed cases retain both product images.
          return {
            ...item,
            components: (item.components || []).map((component) => ({
              ...component,
              product: products.find((product) => String(product.id) === String(component.productId)) || component.product || null,
            })),
          }
        }
        const currentSize = String((item as any)?.sizeLabel || '').trim()
        const product = products.find((p) => String(p.id) === String(item.productId))
        const nextCategory =
          String((item as any)?.category || '').trim() ||
          String((product as any)?.category?.name || (product as any)?.category || '').trim() ||
          undefined
        if (!product) {
          return { ...item, sizeLabel: String(item.unit || 'case').trim() || 'case', category: nextCategory }
        }
        const refreshedItem = {
          ...item,
          // Availability has to track the live catalog; a frozen snapshot let an
          // over-quantity cart reach checkout and fail server-side.
          available: getAvailableQty(product),
          sizeLabel: currentSize && currentSize.toUpperCase() !== 'N/A' ? currentSize : getProductSizeLabel(product),
          category: nextCategory,
          containerPackagingType: product.containerPackagingType,
          looseUnit: product.looseUnit,
          packagingCompatibilityKey: product.packagingCompatibilityKey,
          depositExempt: product.depositExempt,
          packagingType: product.packagingType,
          containerTypeId: product.containerTypeId,
          containerTypeName: product.containerTypeName,
          containersPerCase: product.containersPerCase,
          depositAmount: product.depositAmount,
          caseDepositAmount: product.caseDepositAmount,
        }
        return applyAutomaticEmptyCredit(refreshedItem, item.quantity)
      })
    )
  }, [products, setCart, user?.bottleBalances])

  const openAddToCartDialog = (product: Product) => {
    const available = getAvailableQty(product)
    if (available <= 0) {
      toast.error('This item is out of stock')
      return
    }
    setPendingCartProduct(product)
    setPendingCartQty('1')
    setIsAddToCartDialogOpen(true)
  }

  const confirmAddToCart = () => {
    if (!pendingCartProduct) return
    const available = getAvailableQty(pendingCartProduct)
    if (available <= 0) {
      toast.error('This item is out of stock')
      setIsAddToCartDialogOpen(false)
      setPendingCartProduct(null)
      return
    }
    const parsed = Number(pendingCartQty)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Please enter a valid quantity')
      return
    }
    const qty = Math.min(Math.floor(parsed), available)
    addToCart(pendingCartProduct, qty)
    setIsAddToCartDialogOpen(false)
    setPendingCartProduct(null)
    toast.success('Added to cart', { duration: 1000 })
  }

  const adjustPendingCartQty = (delta: number) => {
    if (!pendingCartProduct) return
    const available = getAvailableQty(pendingCartProduct)
    const current = Number(pendingCartQty)
    const safeCurrent = Number.isFinite(current) && current > 0 ? Math.floor(current) : 1
    const next = Math.max(1, Math.min(available, safeCurrent + delta))
    setPendingCartQty(String(next))
  }

  const updateCartQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.productId !== productId) return i
          if (i.itemType === 'MIXED_CASE') return qty <= 0 ? { ...i, quantity: 0 } : i
          const newQty = Math.max(0, Math.min(qty, i.available))
          return applyAutomaticEmptyCredit(i, newQty)
        })
        .filter((i) => i.quantity > 0)
    )
  }

  // Added: customers can drop a line item from the cart outright, not only by
  // stepping the quantity down to zero.
  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId))
    setSelectedCartIds((prev) => {
      const next = new Set(prev)
      next.delete(productId)
      return next
    })
  }

  const removeSelectedFromCart = () => {
    setCart((prev) => prev.filter((item) => !selectedCartIds.has(item.productId)))
    setSelectedCartIds(new Set())
  }

  const openMixedCaseBuilder = (item: CartItem | null = null) => {
    setEditingMixedCase(item)
    setIsMixedCaseBuilderOpen(true)
  }

  const saveMixedCase = (item: CartItem) => {
    const mixedCaseWithDeposit = applyAutomaticEmptyCredit(item, item.quantity)
    setCart((prev) => {
      const existing = prev.some((row) => row.productId === item.productId)
      return existing
        ? prev.map((row) => (row.productId === item.productId ? mixedCaseWithDeposit : row))
        : [...prev, mixedCaseWithDeposit]
    })
    setSelectedCartIds((prev) => {
      const next = new Set(prev)
      next.add(item.productId)
      return next
    })
    setEditingMixedCase(null)
  }

  const cartCount = useMemo(() => cart.reduce((sum, i) => sum + i.quantity, 0), [cart])
  const selectedCartItems = useMemo(
    () => {
      const remainingByProductContainer = new Map<string, number>()
      return cart
        .filter((item) => selectedCartIds.has(item.productId))
        .map((item) => {
          if (item.itemType === 'MIXED_CASE') {
            const components = (item.components || []).map((component) => {
              const profile = getMixedCaseComponentDepositProfile(component)
              if (!profile.isReturnable || !profile.containerTypeId) return component
              const productContainerKey = `${String(component.productId || '')}::${profile.containerTypeId}`
              if (!remainingByProductContainer.has(productContainerKey)) {
                const customerBalance = getProductBottleBalance(
                  { productId: component.productId, containerTypeId: profile.containerTypeId },
                  user?.bottleBalances,
                )
                remainingByProductContainer.set(productContainerKey, Math.max(0, Math.floor(Number(
                  customerBalance?.bottlesAvailable ?? customerBalance?.bottlesOutstanding ?? 0
                ))))
              }
              const remaining = remainingByProductContainer.get(productContainerKey) || 0
              const needed = Math.max(0, Number(component.quantityPerCase || 0)) * Math.max(0, Number(item.quantity || 0))
              const emptiesUsed = Math.min(needed, remaining)
              remainingByProductContainer.set(productContainerKey, remaining - emptiesUsed)
              return { ...component, emptyReturnedQuantity: emptiesUsed }
            })
            return { ...item, components }
          }
          if (item.packagingType !== 'RETURNABLE' || item.depositExempt || !item.containerTypeId) return item
          const containerKey = String(item.containerTypeId)
          const productContainerKey = `${String(item.productId || '')}::${containerKey}`
          if (!remainingByProductContainer.has(productContainerKey)) {
            const customerBalance = getProductBottleBalance(item, user?.bottleBalances)
            remainingByProductContainer.set(productContainerKey, Math.max(0, Math.floor(Number(
              customerBalance?.bottlesAvailable ?? customerBalance?.bottlesOutstanding ?? 0
            ))))
          }
          const remaining = remainingByProductContainer.get(productContainerKey) || 0
          const containersPerCase = Math.max(1, Math.floor(Number(item.containersPerCase || 1)))
          const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
          const emptiesUsed = isCase
            ? Math.min(item.quantity, Math.floor(remaining / containersPerCase)) * containersPerCase
            : Math.min(item.quantity, remaining)
          remainingByProductContainer.set(productContainerKey, remaining - emptiesUsed)
          return { ...item, emptyReturnedQuantity: emptiesUsed }
        })
    },
    [cart, selectedCartIds, user?.bottleBalances]
  )
  const selectedSubtotal = useMemo(
    () => selectedCartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    [selectedCartItems]
  )
  const selectedDepositCharged = useMemo(
    () => selectedCartItems.reduce((sum, i) => {
      if (i.itemType === 'MIXED_CASE') return sum + getMixedCaseDepositAmounts(i).charged
      return sum + getLineDepositAmounts(i).charged
    }, 0),
    [selectedCartItems]
  )
  const selectedDepositRefunded = useMemo(
    () => selectedCartItems.reduce((sum, i) => {
      if (i.itemType === 'MIXED_CASE') return sum + getMixedCaseDepositAmounts(i).refunded
      return sum + getLineDepositAmounts(i).refunded
    }, 0),
    [selectedCartItems]
  )
  const depositRefundOptions = useMemo<DepositRefundOption[]>(() => {
    const usedByContainer = new Map<string, number>()
    const usedByProductContainer = new Map<string, number>()
    selectedCartItems.forEach((item) => {
      if (item.itemType === 'MIXED_CASE') {
        ;(item.components || []).forEach((component: any) => {
          const containerTypeId = String(component.containerTypeId || '').trim()
          if (containerTypeId) {
            const used = Math.max(0, Number(component.emptyReturnedQuantity || 0))
            const productContainerKey = `${String(component.productId || '')}::${containerTypeId}`
            usedByContainer.set(containerTypeId, (usedByContainer.get(containerTypeId) || 0) + used)
            usedByProductContainer.set(productContainerKey, (usedByProductContainer.get(productContainerKey) || 0) + used)
          }
        })
        return
      }
      const containerTypeId = String(item.containerTypeId || '').trim()
      if (containerTypeId) {
        const used = Math.max(0, Number(item.emptyReturnedQuantity || 0))
        const productContainerKey = `${String(item.productId || '')}::${containerTypeId}`
        usedByContainer.set(containerTypeId, (usedByContainer.get(containerTypeId) || 0) + used)
        usedByProductContainer.set(productContainerKey, (usedByProductContainer.get(productContainerKey) || 0) + used)
      }
    })

    const balanceRows = (Array.isArray(user?.bottleBalances) ? user.bottleBalances : [])
      .flatMap(getProductDepositBalanceRows)
    const knownProductContainerKeys = new Set(
      balanceRows.map((balance: any) => `${String(balance?.productId || balance?.productIds?.[0] || '')}::${String(balance?.containerTypeId || '')}`)
    )
    const unmatchedUsedByContainer = new Map<string, number>()
    usedByContainer.forEach((totalUsed, containerTypeId) => {
      let matchedUsed = 0
      usedByProductContainer.forEach((quantity, productContainerKey) => {
        if (productContainerKey.endsWith(`::${containerTypeId}`) && knownProductContainerKeys.has(productContainerKey)) {
          matchedUsed += quantity
        }
      })
      unmatchedUsedByContainer.set(containerTypeId, Math.max(0, totalUsed - matchedUsed))
    })

    return balanceRows
      .flatMap((balance: any) => {
      const containerTypeId = String(balance?.containerTypeId || '').trim()
      const productOptions = Array.isArray(balance?.productOptions) && balance.productOptions.length > 0
        ? balance.productOptions
        : [{
          id: balance?.productIds?.[0],
          label: balance?.productLabel || balance?.productName,
        }]
      if (!containerTypeId) return []
      const availableBottles = Math.max(0, Math.floor(Number(balance?.bottlesAvailable ?? balance?.bottlesOutstanding ?? 0)))
      const parentContainerAvailable = Math.max(0, Math.floor(Number(balance?.containerBottlesAvailable ?? availableBottles)))
      // Fix: cart-level empty credits and manual refunds draw from the same
      // physical container pool, even when they refer to different products.
      const containerBottlesAvailable = Math.max(
        0,
        parentContainerAvailable - (usedByContainer.get(containerTypeId) || 0)
      )
      const isProductBalance = Array.isArray(balance?.productBalances) && balance.productBalances.length > 0
      const refundableBalance = Math.max(0, Number(
        isProductBalance
          ? balance?.depositAvailable
          : balance?.depositBalanceTotal ?? balance?.depositAvailable ?? balance?.depositBalance ?? 0
      ))
      // Every product option shares this container balance; checkout enforces the
      // combined limit while letting the customer identify the exact product.
      return productOptions.flatMap((productOption: any) => {
        const productId = String(productOption?.id || '').trim()
        if (!productId) return []
        const productContainerKey = `${productId}::${containerTypeId}`
        let used = isProductBalance
          ? (usedByProductContainer.get(productContainerKey) || 0)
          : (usedByContainer.get(containerTypeId) || 0)
        if (isProductBalance) {
          const unmatchedUsed = unmatchedUsedByContainer.get(containerTypeId) || 0
          const additionalUsed = Math.min(Math.max(0, availableBottles - used), unmatchedUsed)
          used += additionalUsed
          unmatchedUsedByContainer.set(containerTypeId, unmatchedUsed - additionalUsed)
        }
        const remainingAfterOrderDeposit = Math.max(0, availableBottles - used)
        const unitDetails = getDepositRefundUnitDetails(productOption, balance)
        if (unitDetails.depositPerUnit <= 0) return []
        const maxQuantity = getMaximumDepositRefundQuantity(
          remainingAfterOrderDeposit,
          refundableBalance,
          unitDetails
        )
        if (maxQuantity <= 0) return []
        return [{
          productId,
          productName: String(productOption?.label || productOption?.name || balance?.containerTypeName || 'Returnable product'),
          containerTypeId,
          containerTypeName: String(balance?.containerTypeName || 'Returnable container'),
          ...unitDetails,
          maxQuantity,
          containerBottlesAvailable,
        }]
      })
    })
  }, [selectedCartItems, user?.bottleBalances])
  const depositCreditAmount = useMemo(
    () => Math.round(depositRefundLines.reduce((total, line) => total + (line.quantity * line.depositPerUnit), 0) * 100) / 100,
    [depositRefundLines]
  )
  const discountCasesAffected = useMemo(
    () => selectedCartItems.reduce((sum, item) => {
      const isMixedCase = item.itemType === 'MIXED_CASE'
      const normalizedUnit = String(item.unit || '').trim().toLowerCase()
      // Packs count toward the discount minimum alongside standard and mixed cases.
      const isCaseOrPack = normalizedUnit === 'case' || normalizedUnit === 'pack'
      return isMixedCase || isCaseOrPack
        ? sum + Math.max(0, Number(item.quantity || 0))
        : sum
    }, 0),
    [selectedCartItems]
  )
  const checkoutDiscountBreakdown = useMemo(() => {
    const normalizedOption = String(customerDiscountOption || 'NO_DISCOUNT').toUpperCase()
    const normalizedStatus = String(customerDiscountStatus || 'REMOVED').toUpperCase()
    const isActive = normalizedStatus === 'ACTIVE'
    const presetPercentMap: Record<string, number> = {
      NO_DISCOUNT: 0,
      DISCOUNT_5: 5,
      DISCOUNT_10: 10,
      DISCOUNT_15: 15,
      DISCOUNT_20: 20,
      DISCOUNT_25: 25,
    }
    let name = 'No Discount'
    let discountType = 'NO_DISCOUNT'
    let discountPercent = 0
    let amountPerCase = 0
    if (isActive) {
      if (normalizedOption in presetPercentMap) {
        discountPercent = presetPercentMap[normalizedOption] || 0
        discountType = discountPercent > 0 ? 'PERCENTAGE' : 'NO_DISCOUNT'
        if (normalizedOption !== 'NO_DISCOUNT') name = `${discountPercent}% Discount`
      } else if (normalizedOption === 'OTHER') {
        name = 'Other (Manual)'
        amountPerCase = Math.max(0, Number(customerDiscountAmountPerCase || 0))
        discountPercent = Math.max(0, Number(customerDiscountPercent || 0))
        discountType = amountPerCase > 0 ? 'AMOUNT_PER_CASE' : 'PERCENTAGE'
      }
    }
    const perCaseDiscount = discountType === 'AMOUNT_PER_CASE'
      ? amountPerCase
      : 0
    const percentageDiscountTotal = selectedCartItems.reduce((sum, item) => {
      const qty = Math.max(0, Number(item?.quantity || 0))
      const unitPrice = Math.max(0, Number(item?.unitPrice || 0))
      return sum + (unitPrice * qty * (discountPercent / 100))
    }, 0)
    const totalDiscountRaw = discountType === 'AMOUNT_PER_CASE'
      ? (amountPerCase * discountCasesAffected)
      : percentageDiscountTotal
    // The configured discount becomes eligible at the 50-case minimum.
    const isDiscountEligible = discountCasesAffected >= 50
    const totalDiscount = isActive && isDiscountEligible
      ? Math.min(selectedSubtotal, Math.max(0, totalDiscountRaw))
      : 0
    return {
      name: isDiscountEligible ? name : 'No Discount',
      discountType: isDiscountEligible ? discountType : 'NO_DISCOUNT',
      discountPercent: isDiscountEligible ? discountPercent : 0,
      amountPerCase: isDiscountEligible ? amountPerCase : 0,
      perCaseDiscount: isActive && isDiscountEligible
        ? (discountType === 'AMOUNT_PER_CASE'
          ? perCaseDiscount
          : (discountCasesAffected > 0 ? totalDiscount / discountCasesAffected : 0))
        : 0,
      casesAffected: isDiscountEligible ? discountCasesAffected : 0,
      totalDiscount,
      // Fix: the payable total includes the new deposit after any existing-empty credit.
      finalTotal: Math.max(0, selectedSubtotal - totalDiscount + selectedDepositCharged - selectedDepositRefunded - depositCreditAmount),
    }
  }, [
    customerDiscountOption,
    customerDiscountStatus,
    customerDiscountAmountPerCase,
    customerDiscountPercent,
    discountCasesAffected,
    selectedCartItems,
    selectedSubtotal,
    selectedDepositCharged,
    selectedDepositRefunded,
    depositCreditAmount,
  ])
  const selectedCount = useMemo(() => selectedCartItems.length, [selectedCartItems])
  // Stock is checked in the browser so an order that the server would reject is
  // blocked before it is submitted, with the shortfall named on the line item.
  const insufficientStockItems = useMemo(
    () =>
      selectedCartItems.filter((item) => {
        const available = getCartItemAvailable(item)
        if (available === null) return false
        return available <= 0 || Math.max(0, Math.floor(Number(item?.quantity || 0))) > available
      }),
    [selectedCartItems]
  )
  const insufficientStockProductIds = useMemo(
    () => new Set(insufficientStockItems.map((item) => String(item.productId))),
    [insufficientStockItems]
  )
  const canPlaceOrder = useMemo(
    () => {
      const deliveryDateText = String(deliveryDate || '').trim()
      if (!deliveryDateText) return false
      const parsedDate = parseDateOnly(deliveryDateText)
      if (!parsedDate) return false
      if (insufficientStockItems.length > 0) return false
      return parsedDate >= getLocalDateOnly() && selectedCartItems.length > 0
    },
    [selectedCartItems.length, deliveryDate, insufficientStockItems.length]
  )
  const allCartSelected = useMemo(
    () => cart.length > 0 && cart.every((item) => selectedCartIds.has(item.productId)),
    [cart, selectedCartIds]
  )

  useEffect(() => {
    setSelectedCartIds((prev) => {
      const existing = new Set(cart.map((item) => item.productId))
      const next = new Set<string>()
      for (const id of prev) {
        if (existing.has(id)) next.add(id)
      }
      if (next.size === prev.size) return prev
      return next
    })
  }, [cart])

  const placeOrder = async () => {
    if (
      !shippingName ||
      !shippingPhone ||
      !shippingStreetName ||
      !shippingCity ||
      !shippingProvince ||
      !shippingZipCode
    ) {
      toast.error('Please complete all detailed shipping fields')
      return
    }
    const shippingNameError = validatePersonName(shippingName)
    if (shippingNameError) {
      // Fix: reject numeric shipping contact names before checkout.
      toast.error(shippingNameError)
      return
    }
    if (selectedCartItems.length === 0) {
      toast.error('Your cart is empty')
      return
    }
    if (insufficientStockItems.length > 0) {
      const first = insufficientStockItems[0]
      const available = getCartItemAvailable(first) ?? 0
      toast.error(
        available <= 0
          ? `${first.name || 'An item'} is out of stock. Remove it to continue.`
          : `Only ${available} ${first.unit || 'case'}(s) of ${first.name || 'an item'} are available. Lower the quantity to continue.`
      )
      setActiveView('cart')
      return
    }
    if (!String(deliveryDate || '').trim()) {
      toast.error('Please select a delivery date before placing your order')
      return
    }
    const parsedDeliveryDate = parseDateOnly(deliveryDate)
    if (!parsedDeliveryDate) {
      toast.error('Please select a valid delivery date')
      return
    }
    if (parsedDeliveryDate < getLocalDateOnly()) {
      toast.error('Delivery date cannot be before today')
      return
    }
    if (shippingLatitude === null || shippingLongitude === null) {
      toast.error('Please pin your delivery address on the map before placing your order')
      setIsAddressDialogOpen(true)
      return
    }
    if (!isInServiceArea(shippingLatitude, shippingLongitude)) {
      toast.error(SERVICE_AREA_MESSAGE)
      setIsAddressDialogOpen(true)
      return
    }

    setIsPlacingOrder(true)
    const cartSnapshot = [...cart]
    const selectedIdsSnapshot = new Set(selectedCartIds)
    try {
      const orderPayload = {
        shippingName,
        shippingPhone,
        shippingAddress: composedShippingAddress,
        shippingCity,
        shippingProvince,
        shippingZipCode,
        shippingCountry,
        shippingLatitude,
        shippingLongitude,
        notes,
        deliveryDate: deliveryDate || null,
        discountPreview: {
          type: checkoutDiscountBreakdown.discountType,
          name: checkoutDiscountBreakdown.name,
          percent: checkoutDiscountBreakdown.discountPercent,
          amountPerCase: checkoutDiscountBreakdown.amountPerCase,
          perCaseDiscount: checkoutDiscountBreakdown.perCaseDiscount,
          casesAffected: checkoutDiscountBreakdown.casesAffected,
          totalDiscount: checkoutDiscountBreakdown.totalDiscount,
        },
        // The server prices these product-specific lines authoritatively. Sending
        // a duplicated cached total can reject a valid order after packaging data refreshes.
        depositRefundLines: depositRefundLines.map((line) => ({
          productId: line.productId,
          containerTypeId: line.containerTypeId,
          // Fix: the API stores bottle equivalents but prices explicit cases and
          // bottles separately, so preserve the selected packaging unit here.
          ...serializeDepositRefundQuantity(line),
        })),
        items: selectedCartItems.map((item) =>
          item.itemType === 'MIXED_CASE'
            ? {
              itemType: 'MIXED_CASE',
              caseCapacity: item.caseCapacity,
              quantity: item.quantity,
              emptyReturnedQuantity: item.emptyReturnedQuantity || 0,
              components: (item.components || []).map((component) => ({
                productId: component.productId,
                quantity: component.quantityPerCase,
                emptyReturnedQuantity: component.emptyReturnedQuantity || 0,
              })),
            }
            : {
              itemType: 'STANDARD_CASE',
              productId: item.productId,
              quantity: item.quantity,
              // Server recalculates this from the live balance; sending it keeps
              // the request transparent for receipts and debugging.
              emptyReturnedQuantity: item.emptyReturnedQuantity || 0,
            }
        ),
      }
      const payloadKey = JSON.stringify(orderPayload)
      if (!checkoutRequestRef.current || checkoutRequestRef.current.payloadKey !== payloadKey) {
        checkoutRequestRef.current = {
          payloadKey,
          requestId: createClientRequestId(),
        }
      }
      const { response, data } = await createCustomerOrder({
        ...orderPayload,
        requestId: checkoutRequestRef.current.requestId,
      })
      if (!response.ok || data?.success === false) {
        const errorMessage = String(data?.error || data?.message || '').trim()
        throw new Error(errorMessage || `Failed to place order (HTTP ${response.status})`)
      }
      setLastPlacedOrderNumber(String(data?.order?.purchaseRequestNumber || data?.order?.orderNumber || data?.order?.id || '').trim())
      setIsOrderConfirmationOpen(true)
      if (data?.order) {
        setOrders((prev) => [data.order, ...prev.filter((order) => order.id !== data.order.id)])
      }
      const selectedIds = new Set(selectedCartItems.map((item) => item.productId))
      setCart((prev) => prev.filter((item) => !selectedIds.has(item.productId)))
      setSelectedCartIds((prev) => {
        const next = new Set(prev)
        selectedIds.forEach((id) => next.delete(id))
        return next
      })
      // The credit and the note belong to the completed request and must not carry into the next order.
      setDepositRefundLines([])
      setNotes('')
      // Refresh once in background via shared sync channel.
      emitDataSync(['orders', 'customers', 'auth', 'user'])
      void fetchProducts()
      void loadCustomerProfile()
      try {
        const authMeRes = await fetch('/api/auth/me', { cache: 'no-store' })
        const authMeData = await authMeRes.json().catch(() => ({}))
        if (authMeRes.ok && authMeData?.user) {
          setUser(authMeData.user)
        }
      } catch {}
      setOrdersTab('ALL')
      setOrdersSearch('')
      setActiveView('purchase-requests')
      checkoutRequestRef.current = null
    } catch (e: any) {
      setCart(cartSnapshot)
      setSelectedCartIds(selectedIdsSnapshot)
      toast.error(e?.message || 'Failed to place order')
    } finally {
      setIsPlacingOrder(false)
    }
  }
  const addToCartDirect = (product: Product, qty: number) => {
    const available = getAvailableQty(product)
    if (available <= 0) {
      toast.error('This item is out of stock')
      return
    }
    const safeQty = Math.max(1, Math.min(available, Math.floor(Number(qty) || 1)))
    addToCart(product, safeQty)
    toast.success('Added to cart', { duration: 1000 })
  }

  const buyAgainFromOrder = async (order: any) => {
    const orderItems = Array.isArray(order?.items) ? order.items : []
    if (orderItems.length === 0) {
      toast.error('No items found in this order')
      return
    }

    let addedCount = 0
    let skippedCount = 0
    let missingProductRefCount = 0
    let productNotFoundCount = 0
    let outOfStockCount = 0
    const catalogProducts = (await fetchProducts()) || products

    for (const item of orderItems) {
      const itemType = String(item?.itemType || item?.item_type || '').trim().toUpperCase()
      if (itemType === 'MIXED_CASE') {
        const components = Array.isArray(item?.components) ? item.components : []
        const caseCapacity = Math.max(0, Math.floor(Number(item?.caseCapacity || item?.case_capacity || 0)))
        const qty = Math.max(1, Math.floor(Number(item?.quantity || 1)))
        if (caseCapacity <= 0 || components.length < 2) {
          skippedCount += 1
          missingProductRefCount += 1
          continue
        }

        try {
          const { response, data } = await quoteMixedCase({
            caseCapacity,
            quantity: qty,
            components: components.map((component: any) => ({
              productId: String(component?.productId || component?.product?.id || ''),
              quantity: Math.max(0, Math.floor(Number(component?.quantityPerCase || component?.quantity || 0))),
            })),
          })
          if (!response.ok || data?.success === false || !data?.quote) {
            throw new Error(data?.error || 'Mixed Case is unavailable')
          }

          const quote = data.quote
          const quoteComponents = Array.isArray(quote?.components) ? quote.components : []
          const componentProducts = quoteComponents.map((component: any) =>
            catalogProducts.find((product) => String(product.id) === String(component?.productId))
          )
          if (quoteComponents.length < 2 || componentProducts.some((product: Product | undefined) => !product)) {
            skippedCount += 1
            productNotFoundCount += 1
            continue
          }

          const maxCases = Math.min(...quoteComponents.map((component: any) => {
            const product = catalogProducts.find((row) => String(row.id) === String(component?.productId))
            return Math.floor(
              Number(product?.availableBaseUnits || 0) /
              Math.max(1, Number(component?.quantityPerCase || 1))
            )
          }))
          if (!Number.isFinite(maxCases) || maxCases < qty) {
            skippedCount += 1
            outOfStockCount += 1
            continue
          }

          const cartKey = `mixed:${createClientRequestId()}`
          const firstProduct = componentProducts[0]
          // Store each selected product with the quote for the mixed-case image pair.
          const mixedComponents = quoteComponents.map((component: any, index: number) => ({
            ...component,
            product: componentProducts[index] || null,
          }))
          const mixedItem: CartItem = {
            productId: cartKey,
            itemType: 'MIXED_CASE',
            name: `Mixed Case — ${Number(quote.caseCapacity || caseCapacity)} units`,
            sku: 'MIXED-CASE',
            imageUrl: firstProduct?.imageUrl || null,
            unit: 'mixed case',
            sizeLabel: `${Number(quote.caseCapacity || caseCapacity)} units`,
            unitPrice: Number(quote.unitPrice || 0),
            quantity: Number(quote.caseCount || qty),
            available: maxCases,
            caseCapacity: Number(quote.caseCapacity || caseCapacity),
            components: mixedComponents,
          }
          setCart((prev) => [...prev, mixedItem])
          setSelectedCartIds((prev) => new Set(prev).add(cartKey))
          addedCount += 1
        } catch (error: any) {
          skippedCount += 1
          if (/out of stock|insufficient|inventory/i.test(String(error?.message || ''))) outOfStockCount += 1
          else productNotFoundCount += 1
        }
        continue
      }

      const productId = String(item?.product?.id || item?.productId || '').trim()
      const qty = Math.max(1, Math.floor(Number(item?.quantity || 1)))
      if (!productId) {
        skippedCount += 1
        missingProductRefCount += 1
        continue
      }

      const catalogProduct = catalogProducts.find((p) => String(p.id) === productId)
      if (!catalogProduct) {
        skippedCount += 1
        productNotFoundCount += 1
        continue
      }

      const available = getAvailableQty(catalogProduct)
      if (available <= 0) {
        skippedCount += 1
        outOfStockCount += 1
        continue
      }

      addToCart(catalogProduct, Math.min(qty, available))
      addedCount += 1
    }

    if (addedCount === 0) {
      if (outOfStockCount > 0 && productNotFoundCount === 0 && missingProductRefCount === 0) {
        toast.error('Product unavailable: out of stock')
      } else if (productNotFoundCount > 0 || missingProductRefCount > 0) {
        toast.error('Product unavailable')
      } else {
        toast.error('Unable to add item right now')
      }
      return
    }

    if (skippedCount > 0) {
      toast.message(`${addedCount} item(s) added, ${skippedCount} item(s) unavailable`)
    } else {
      toast.success('Items added to cart')
    }
    setActiveView('cart')
  }

  return {
    addToCartDirect,
    allCartSelected,
    buyAgainFromOrder,
    canPlaceOrder,
    cartCount,
    checkoutDiscountBreakdown,
    depositCreditAmount,
    depositRefundOptions,
    discountCasesAffected,
    getAvailableQty,
    getCartItemAvailable,
    insufficientStockItems,
    openMixedCaseBuilder,
    placeOrder,
    removeFromCart,
    removeSelectedFromCart,
    saveMixedCase,
    selectedCartItems,
    selectedCount,
    selectedDepositCharged,
    selectedDepositRefunded,
    selectedSubtotal,
    updateCartQty,
  }
}
