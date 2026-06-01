'use client'

import { useEffect, useMemo, useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Home, Package, User } from 'lucide-react'
import { Poppins } from 'next/font/google'
import { useAuth } from '@/app/page'
import { clearTabAuthToken } from '@/lib/client-auth'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { toast } from 'sonner'
import { CustomerProfileView } from './sections/profile/profile-view'
import { CustomerFeedbackView } from './sections/feedback/feedback-view'
import { CustomerHomeView } from './sections/home/home-view'
import { CustomerCartView } from './sections/cart/cart-view'
import { CustomerCheckoutView } from './sections/checkout/checkout-view'
import { CustomerOrdersView } from './sections/orders/orders-view'
import { CustomerTrackView } from './sections/track/track-view'
import { CustomerProfileDialog } from './sections/profile/profile-dialog'
import { CustomerAvatarCropDialog } from './sections/profile/avatar-crop-dialog'
import { CustomerAddressDialog } from './sections/checkout/address-dialog'
import { CustomerOrderDetailsDialog } from './sections/orders/order-details-dialog'
import { CustomerReceiptDialog } from './sections/orders/receipt-dialog'
import { CustomerRatingDialog } from './sections/orders/rating-dialog'
import { CustomerPortalHeader } from './sections/layout/portal-header'
import { CustomerBottomNav } from './sections/layout/bottom-nav'
import { useCustomerPortalState } from './sections/layout/portal-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  cancelCustomerOrder,
  createCustomerOrder,
  fetchAllCustomerOrders,
  fetchCustomerTracking,
  fetchReplacementsMeta,
  fetchLegacyCustomerReplacements,
  submitCustomerReplacementRequest,
  uploadReplacementEvidence,
} from './sections/orders/orders-api'
import { fetchCustomerProducts } from './sections/shared/products-api'
import { fetchCustomerProfile, updateCustomerProfile, uploadCustomerAvatar } from './sections/profile/profile-api'
import { fetchFeedbackMeta, submitOrderFeedback } from './sections/feedback/feedback-api'
import {
  extractCustomerPayload,
  formatPeso,
  getProductImage,
  getReplacementBadgeClass,
  getReplacementRank,
  getReplacementStatusLabel,
  parseReplacementMeta,
} from './sections/shared/customer-common'
import type {
  CartItem,
  CustomerOrdersTab,
  DeliveryIssueRecord,
  DeliveryIssueSummary,
  DriverTrackingItem,
  Order,
  OrderItem,
  Product,
} from './sections/shared/customer-types'
import {
  formatOrderStatus,
  getOrderStageIndex,
  isOrderCancellable,
  isOrderDelivered,
  isOrderTrackable,
  normalizeDeliveryStatus,
  orderStages,
} from './sections/orders/order-status'
import { downloadOrderReceipt } from './sections/orders/receipt-utils'
import { isWithinNegrosOccidental } from './sections/checkout/location-utils'
import { isValidPhilippinePhone } from '@/lib/philippine-phone'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const getLocalDateOnly = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

const parseDateOnly = (value: string) => {
  const [yearText, monthText, dayText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}


export function CustomerPortal() {
  const { user, setUser, logout } = useAuth()
  const [pendingCancelOrder, setPendingCancelOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [isCancellingOrder, setIsCancellingOrder] = useState(false)
  const [isOrderConfirmationOpen, setIsOrderConfirmationOpen] = useState(false)
  const [lastPlacedOrderNumber, setLastPlacedOrderNumber] = useState('')
  const [reviewByOrderId, setReviewByOrderId] = useState<Record<string, any>>({})
  const [customerDiscountOption, setCustomerDiscountOption] = useState('NO_DISCOUNT')
  const [customerDiscountStatus, setCustomerDiscountStatus] = useState('REMOVED')
  const [customerDiscountPercent, setCustomerDiscountPercent] = useState(0)
  const [customerDiscountAmountPerCase, setCustomerDiscountAmountPerCase] = useState(0)
  const [productCategoryFilter, setProductCategoryFilter] = useState('ALL')
  const [reviewDetailsOrder, setReviewDetailsOrder] = useState<Order | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [orderFilterStatus, setOrderFilterStatus] = useState('ALL')
  const [orderFilterDateFrom, setOrderFilterDateFrom] = useState('')
  const [orderFilterDateTo, setOrderFilterDateTo] = useState('')
  const manualAddressPinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualAddressPinAbortRef = useRef<AbortController | null>(null)
  const lastManualAddressQueryRef = useRef('')
  const {
    activeView,
    setActiveView,
    orders,
    setOrders,
    selectedOrder,
    setSelectedOrder,
    isReceiptDialogOpen,
    setIsReceiptDialogOpen,
    isLoading,
    setIsLoading,
    isRefreshingOrdersRef,
    products,
    setProducts,
    isProductsLoading,
    setIsProductsLoading,
    productSearch,
    setProductSearch,
    isAddToCartDialogOpen,
    setIsAddToCartDialogOpen,
    pendingCartProduct,
    setPendingCartProduct,
    pendingCartQty,
    setPendingCartQty,
    cart,
    setCart,
    selectedCartIds,
    setSelectedCartIds,
    isPlacingOrder,
    setIsPlacingOrder,
    shippingName,
    setShippingName,
    shippingPhone,
    setShippingPhone,
    shippingHouseNumber,
    setShippingHouseNumber,
    shippingStreetName,
    setShippingStreetName,
    shippingSubdivision,
    setShippingSubdivision,
    shippingBarangay,
    setShippingBarangay,
    shippingCity,
    setShippingCity,
    shippingProvince,
    setShippingProvince,
    shippingZipCode,
    setShippingZipCode,
    shippingCountry,
    setShippingCountry,
    shippingLatitude,
    setShippingLatitude,
    shippingLongitude,
    setShippingLongitude,
    secondaryShippingName,
    setSecondaryShippingName,
    secondaryShippingPhone,
    setSecondaryShippingPhone,
    secondaryShippingHouseNumber,
    setSecondaryShippingHouseNumber,
    secondaryShippingStreetName,
    setSecondaryShippingStreetName,
    secondaryShippingSubdivision,
    setSecondaryShippingSubdivision,
    secondaryShippingBarangay,
    setSecondaryShippingBarangay,
    secondaryShippingCity,
    setSecondaryShippingCity,
    secondaryShippingProvince,
    setSecondaryShippingProvince,
    secondaryShippingZipCode,
    setSecondaryShippingZipCode,
    secondaryShippingCountry,
    setSecondaryShippingCountry,
    secondaryShippingLatitude,
    setSecondaryShippingLatitude,
    secondaryShippingLongitude,
    setSecondaryShippingLongitude,
    selectedDeliveryAddress,
    setSelectedDeliveryAddress,
    isAddressDialogOpen,
    setIsAddressDialogOpen,
    isResolvingPinnedAddress,
    setIsResolvingPinnedAddress,
    addressSearch,
    setAddressSearch,
    isSearchingAddress,
    setIsSearchingAddress,
    addressSearchResults,
    setAddressSearchResults,
    notes,
    setNotes,
    deliveryDate,
    setDeliveryDate,
    ordersSearch,
    setOrdersSearch,
    ordersTab,
    setOrdersTab,
    isSavingAddress,
    setIsSavingAddress,
    trackingByOrderId,
    setTrackingByOrderId,
    isTrackingLoading,
    setIsTrackingLoading,
    selectedTrackingOrderId,
    setSelectedTrackingOrderId,
    setDriverLocationLabelByOrderId,
    reverseGeocodeCacheRef,
    deliveredTrackingSnapshotRef,
    reviewedOrderIds,
    setReviewedOrderIds,
    orderRatings,
    setOrderRatings,
    deliveryIssueRecords,
    setDeliveryIssueRecords,
    ratingDialogOrder,
    setRatingDialogOrder,
    deliveryRatingValue,
    setDeliveryRatingValue,
    ratingComment,
    setRatingComment,
    isSubmittingRating,
    setIsSubmittingRating,
    isProfileDialogOpen,
    setIsProfileDialogOpen,
    profileName,
    setProfileName,
    profileEmail,
    setProfileEmail,
    profilePhone,
    setProfilePhone,
    profileAvatar,
    setProfileAvatar,
    profileAvatarFile,
    setProfileAvatarFile,
    isSavingProfile,
    setIsSavingProfile,
    avatarInputRef,
    isAvatarCropDialogOpen,
    setIsAvatarCropDialogOpen,
    avatarCropSource,
    setAvatarCropSource,
    avatarCropFile,
    setAvatarCropFile,
    avatarCropZoom,
    setAvatarCropZoom,
    avatarCropX,
    setAvatarCropX,
    avatarCropY,
    setAvatarCropY,
    avatarCropImageRef,
    isDraggingCrop,
    setIsDraggingCrop,
    cropDragRef,
  } = useCustomerPortalState(user)

  const customerId = (user as any)?.userId || (user as any)?.id || ''
  const selectedTrackingOrder = useMemo(
    () => orders.find((order) => order.id === selectedTrackingOrderId) || null,
    [orders, selectedTrackingOrderId]
  )
  const isSelectedTrackingOrderDelivered = useMemo(
    () =>
      Boolean(
        selectedTrackingOrder &&
        String(
          normalizeDeliveryStatus(selectedTrackingOrder.status, selectedTrackingOrder.paymentStatus)
        ).toUpperCase() === 'DELIVERED'
      ),
    [selectedTrackingOrder]
  )

  useEffect(() => {
    setIsReceiptDialogOpen(false)
  }, [selectedOrder?.id])

  useEffect(() => {
    const imageElement = avatarCropImageRef.current
    if (!imageElement || !avatarCropSource) return

    imageElement.style.transform = `translate(${avatarCropX}px, ${avatarCropY}px) scale(${avatarCropZoom})`
    imageElement.style.transformOrigin = 'center center'
  }, [avatarCropSource, avatarCropX, avatarCropY, avatarCropZoom])

  const hydrateAddressFromProfile = (customer: any) => {
    const rawAddress = String(customer?.address || '').trim()
    const city = String(customer?.city || '').trim()
    const state = String(customer?.province || '').trim() || 'Negros Occidental'
    const zipCode = String(customer?.zipCode || '').trim()

    const parts = rawAddress
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    const normalizeToken = (value: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()
    const isCountryLike = (value: string) => /philippines/i.test(String(value || ''))
    const isPostalLike = (value: string) => /^\d{4}$/.test(String(value || '').trim())
    const isHouseLike = (value: string) => /^(\d+|#|lot|blk|block)\b/i.test(String(value || '').trim())
    const isBarangayLike = (value: string) => /\b(barangay|brgy\.?|poblacion)\b/i.test(String(value || ''))
    const isSubdivisionLike = (value: string) =>
      /\b(subdivision|homes?|villages?|heights?|plains?|residences?)\b/i.test(String(value || ''))

    const tokens = [...parts]
    if (tokens.length > 0 && isCountryLike(tokens[tokens.length - 1])) tokens.pop()
    if (tokens.length > 0 && isPostalLike(tokens[tokens.length - 1])) tokens.pop()
    if (tokens.length > 0 && normalizeToken(tokens[tokens.length - 1]) === normalizeToken(state)) tokens.pop()
    if (city && tokens.length > 0 && normalizeToken(tokens[tokens.length - 1]) === normalizeToken(city)) tokens.pop()

    let houseNumber = ''
    let streetName = ''
    let subdivision = ''
    let barangay = String(customer?.barangay || customer?.brgy || '').trim()

    if (tokens.length === 1) {
      streetName = tokens[0] || ''
    } else if (tokens.length >= 2) {
      if (isHouseLike(tokens[0])) {
        houseNumber = tokens[0] || ''
        streetName = tokens[1] || ''
      } else {
        streetName = tokens[0] || ''
      }

      const remaining = tokens.slice(isHouseLike(tokens[0]) ? 2 : 1)
      const barangayCandidate =
        remaining.find((token) => isBarangayLike(token)) ||
        remaining.find((token) => !isSubdivisionLike(token)) ||
        ''
      if (!barangay && barangayCandidate && !isSubdivisionLike(barangayCandidate)) {
        barangay = barangayCandidate
      }

      // Optional field: only populate when token explicitly looks like subdivision.
      const subdivisionCandidate = remaining.find(
        (token) => isSubdivisionLike(token) && !isBarangayLike(token)
      )
      if (subdivisionCandidate) {
        subdivision = subdivisionCandidate
      }
    }

    const hydratedPhone = String(customer?.phone || '').trim()
    setShippingPhone(hydratedPhone)
    setShippingHouseNumber(houseNumber)
    setShippingStreetName(streetName)
    setShippingSubdivision(subdivision)
    setShippingBarangay(barangay)
    setShippingCity(city)
    setShippingProvince(state)
    setShippingZipCode(zipCode)
    setShippingCountry('Philippines')
    setShippingLatitude(typeof customer?.latitude === 'number' ? customer.latitude : null)
    setShippingLongitude(typeof customer?.longitude === 'number' ? customer.longitude : null)
    setProfileName(String(customer?.name || '').trim())
    setProfileEmail(String(customer?.email || '').trim())
    setProfilePhone(hydratedPhone)
    setProfileAvatar(customer?.avatar ? String(customer.avatar) : null)
    setProfileAvatarFile(null)
    setCustomerDiscountOption(String(customer?.discountOption || 'NO_DISCOUNT').toUpperCase())
    setCustomerDiscountStatus(String(customer?.discountStatus || 'REMOVED').toUpperCase())
    setCustomerDiscountPercent(Number(customer?.discountPercent || 0))
    setCustomerDiscountAmountPerCase(Number(customer?.discountAmountPerCase || 0))
  }

  useEffect(() => {
    setShippingName(user?.name || '')
    setProfileName(user?.name || '')
    setProfileEmail(user?.email || '')
    setProfileAvatar((user as any)?.avatar ? String((user as any).avatar) : null)
  }, [user])

  const loadCustomerProfile = useCallback(async (silent = true) => {
    if (!customerId) return
    try {
      const { response, data: payload } = await fetchCustomerProfile(customerId)
      if (!response?.ok) throw new Error('Failed to load customer profile')
      const customer = extractCustomerPayload(payload)
      if (!customer) throw new Error('Customer profile is missing')
      hydrateAddressFromProfile(customer)
    } catch (error: any) {
      console.warn('Failed to load customer profile:', error)
    }
  }, [customerId])

  useEffect(() => {
    loadCustomerProfile()
  }, [loadCustomerProfile])

  const fetchOrders = useCallback(async (silent = false) => {
    try {
      const requestOrders = () => fetchAllCustomerOrders(100)

      let { response, data } = await requestOrders()

      if (response?.status === 401 || response?.status === 403) {
        clearTabAuthToken()
        ;({ response, data } = await requestOrders())
      }

      if (!response?.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to fetch orders')
      }
      setOrders(Array.isArray(data?.orders) ? data.orders : [])
    } catch (error: any) {
      console.warn('Failed to load orders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchOrderMeta = useCallback(async () => {
    const [feedbackResult, replacementResult] = await Promise.allSettled([
      fetchFeedbackMeta(),
      fetchReplacementsMeta(),
    ])

    if (feedbackResult.status === 'fulfilled') {
      const { response: feedbackResponse, data: feedbackPayload } = feedbackResult.value
      if (feedbackResponse?.ok) {
        const feedbacks = Array.isArray(feedbackPayload?.feedbacks)
          ? feedbackPayload.feedbacks
          : Array.isArray(feedbackPayload?.feedback)
            ? feedbackPayload.feedback
            : []
        const reviewed = new Set<string>()
        const ratingsByOrder: Record<string, number> = {}
        const reviewMap: Record<string, any> = {}
        for (const item of feedbacks) {
          const orderId = String(item?.orderId || item?.order_id || item?.order?.id || '').trim()
          if (!orderId) continue
          reviewed.add(orderId)
          const rawRating = Number(item?.rating)
          if (Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 5) {
            ratingsByOrder[orderId] = Math.round(rawRating)
          }
          const existing = reviewMap[orderId]
          const existingTime = new Date(existing?.createdAt || existing?.created_at || 0).getTime()
          const nextTime = new Date(item?.createdAt || item?.created_at || 0).getTime()
          if (!existing || nextTime >= existingTime) {
            reviewMap[orderId] = item
          }
        }
        setReviewedOrderIds(reviewed)
        setOrderRatings(ratingsByOrder)
        setReviewByOrderId(reviewMap)
      }
    }

    if (replacementResult.status === 'fulfilled') {
      const { response: replacementResponse, data: replacementPayload } = replacementResult.value
      if (replacementResponse?.ok) {
        const replacements = Array.isArray(replacementPayload?.replacements)
          ? (replacementPayload.replacements as DeliveryIssueRecord[])
          : []
        setDeliveryIssueRecords(replacements)
        return
      }
    }

    const { response: legacyResponse, data: legacyPayload } = await fetchLegacyCustomerReplacements()
    const replacements = legacyResponse?.ok && Array.isArray(legacyPayload?.replacements)
      ? (legacyPayload.replacements as DeliveryIssueRecord[])
      : []
    setDeliveryIssueRecords(replacements)
  }, [])

  const fetchProducts = async () => {
    setIsProductsLoading(true)
    try {
      const { response, data: payload } = await fetchCustomerProducts()
      if (!response?.ok) throw new Error('Failed to fetch products')
      const sourceProducts: Product[] = Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload?.data)
          ? payload.data
          : []
      setProducts(
        sourceProducts.filter((p) => {
          if ((p as any)?.isActive === false) return false
          const explicitAvailable = Number((p as any)?.availableQuantity)
          if (Number.isFinite(explicitAvailable)) return explicitAvailable > 0
          const inventory = Array.isArray(p.inventory) ? p.inventory : []
          if (inventory.length === 0) return true
          const available = inventory.reduce((sum, inv) => sum + Math.max(0, inv.quantity - inv.reservedQuantity), 0)
          return available > 0
        })
      )
    } catch (error) {
      console.warn('Failed to load products:', error)
    } finally {
      setIsProductsLoading(false)
    }
  }

  useEffect(() => {
    fetchOrders()
    fetchProducts()
    fetchOrderMeta()
  }, [fetchOrderMeta, fetchOrders])

  useEffect(() => {
    const refreshOrders = async (includeMeta = false) => {
      if (isRefreshingOrdersRef.current) return
      isRefreshingOrdersRef.current = true
      try {
        await fetchOrders(true)
        if (includeMeta) {
          await fetchOrderMeta()
        }
      } finally {
        isRefreshingOrdersRef.current = false
      }
    }

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes || []
      const shouldRefreshTrack = activeView === 'track' && !isSelectedTrackingOrderDelivered
      const shouldRefreshOrdersView = activeView === 'orders'
      if (
        (scopes.includes('orders') || scopes.includes('trips') || scopes.includes('replacements')) &&
        (shouldRefreshOrdersView || shouldRefreshTrack)
      ) {
        void refreshOrders(true)
      }
    })

    const onFocus = () => {
      if (activeView === 'orders' || (activeView === 'track' && !isSelectedTrackingOrderDelivered)) {
        refreshOrders(true)
      }
    }

    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        (activeView === 'orders' || (activeView === 'track' && !isSelectedTrackingOrderDelivered))
      ) {
        refreshOrders(true)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeView, fetchOrderMeta, fetchOrders, isSelectedTrackingOrderDelivered])

  const submitReplacementRequest = useCallback(async (
    orderId: string,
    numberDamagedItems: number,
    damageType: string,
    description: string,
    files: File[],
    replacementLines?: Array<{
      originalOrderItemId: string
      originalProductId?: string
      replacementProductId?: string
      originalProductName?: string
      originalProductSku?: string
      originalProductSize?: string
      replacementProductName?: string
      replacementProductSku?: string
      replacementProductSize?: string
      inputMode?: 'case' | 'bottle'
      lineInputMode?: 'case' | 'bottle'
      quantityPerCase?: number
      qtyPerUnit?: number
      quantityToReplace: number
      quantityToReplaceCases?: number
      quantityToReplaceUnits?: number
      quantityToReplaceBottles?: number
      reason: string
      description?: string
    }>,
  ) => {
    if (!orderId) throw new Error('Order reference is missing')
    if (!Number.isFinite(numberDamagedItems) || numberDamagedItems <= 0) {
      throw new Error('Number of damaged items must be greater than zero')
    }
    if (!damageType.trim()) throw new Error('Reason / type of damage is required')
    if (!files.length) throw new Error('At least one evidence file is required')
    const uploaded: string[] = []
    for (const file of files) {
      const { response, data } = await uploadReplacementEvidence(file)
      if (!response.ok || data?.success === false || !data?.fileUrl) {
        throw new Error(data?.error || 'Failed to upload replacement evidence')
      }
      uploaded.push(String(data.fileUrl))
    }
    const { response, data } = await submitCustomerReplacementRequest({
      orderId,
      numberDamagedItems: Math.floor(numberDamagedItems),
      damageType: damageType.trim(),
      description: description.trim(),
      evidence: uploaded,
      replacementLines,
    })
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || 'Failed to submit replacement request')
    }
    await fetchOrderMeta()
    emitDataSync(['replacements'])
    toast.success('Replacement request submitted')
  }, [fetchOrderMeta])

  useEffect(() => {
    if (activeView !== 'track') return

    let mounted = true
    const deliveredOrderIds = new Set(
      orders
        .filter((order) => String(normalizeDeliveryStatus(order.status, order.paymentStatus)).toUpperCase() === 'DELIVERED')
        .map((order) => order.id)
    )

    const fetchTracking = async () => {
      setIsTrackingLoading(true)
      try {
        const { response, data } = await fetchCustomerTracking()
        if (!response.ok) throw new Error('Failed to load tracking')
        const list: DriverTrackingItem[] = data?.tracking || []
        if (!mounted) return
        setTrackingByOrderId((previous) => {
          const next: Record<string, DriverTrackingItem> = {}

          for (const item of list) {
            const isDelivered = deliveredOrderIds.has(item.orderId)
            if (!isDelivered) {
              next[item.orderId] = item
              continue
            }

            const frozen = deliveredTrackingSnapshotRef.current[item.orderId] || previous[item.orderId]
            const hasFrozenCoordinates = typeof frozen?.latitude === 'number' && typeof frozen?.longitude === 'number'

            if (hasFrozenCoordinates) {
              next[item.orderId] = {
                ...item,
                latitude: frozen.latitude,
                longitude: frozen.longitude,
                source: frozen.source,
                updatedAt: frozen.updatedAt || item.updatedAt,
                routePoints:
                  Array.isArray(frozen.routePoints) && frozen.routePoints.length > 0
                    ? frozen.routePoints
                    : item.routePoints,
              }
              deliveredTrackingSnapshotRef.current[item.orderId] = next[item.orderId]
              continue
            }

            next[item.orderId] = item
            const hasCurrentCoordinates = typeof item.latitude === 'number' && typeof item.longitude === 'number'
            if (hasCurrentCoordinates) {
              deliveredTrackingSnapshotRef.current[item.orderId] = item
            }
          }

          for (const orderId of deliveredOrderIds) {
            if (!next[orderId] && deliveredTrackingSnapshotRef.current[orderId]) {
              next[orderId] = deliveredTrackingSnapshotRef.current[orderId]
            }
          }

          for (const orderId of Object.keys(deliveredTrackingSnapshotRef.current)) {
            if (!deliveredOrderIds.has(orderId)) {
              delete deliveredTrackingSnapshotRef.current[orderId]
            }
          }

          return next
        })
      } catch {
        if (mounted) {
          setTrackingByOrderId({})
        }
      } finally {
        if (mounted) {
          setIsTrackingLoading(false)
        }
      }
    }

    const refreshTrackingIfVisible = () => {
      if (document.visibilityState !== 'visible') return
      void fetchTracking()
    }

    fetchTracking()
    if (isSelectedTrackingOrderDelivered) {
      return () => {
        mounted = false
      }
    }

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes || []
      if (scopes.includes('orders') || scopes.includes('trips')) {
        refreshTrackingIfVisible()
      }
    })

    const onFocus = () => refreshTrackingIfVisible()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshTrackingIfVisible()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      mounted = false
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeView, orders, isSelectedTrackingOrderDelivered])

  useEffect(() => {
    if (activeView !== 'track' || !selectedTrackingOrderId) return

    const tracking = trackingByOrderId[selectedTrackingOrderId]
    const hasDriverCoordinates =
      typeof tracking?.latitude === 'number' &&
      typeof tracking?.longitude === 'number'
    if (!hasDriverCoordinates) return

    const lat = Number(tracking?.latitude)
    const lng = Number(tracking?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`
    const cached = reverseGeocodeCacheRef.current.get(cacheKey)
    if (cached) {
      setDriverLocationLabelByOrderId((prev) => (
        prev[selectedTrackingOrderId] === cached ? prev : { ...prev, [selectedTrackingOrderId]: cached }
      ))
      return
    }

    const controller = new AbortController()
    const fetchLabel = async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&addressdetails=1&countrycodes=ph&zoom=18`,
          { signal: controller.signal }
        )
        if (!response.ok) return
        const payload = await response.json().catch(() => ({}))
        const address = payload?.address || {}
        const barangay = String(address?.suburb || address?.village || address?.hamlet || address?.quarter || address?.neighbourhood || '').trim()
        const city = String(address?.city || address?.town || address?.municipality || address?.county || '').trim()
        const province = String(address?.state || address?.region || '').trim()
        const composed = [barangay, city, province].filter(Boolean).join(', ')
        const fallback = String(payload?.display_name || '').split(',').slice(0, 3).map((part: string) => part.trim()).filter(Boolean).join(', ')
        const label = composed || fallback || 'Driver live location'
        reverseGeocodeCacheRef.current.set(cacheKey, label)
        setDriverLocationLabelByOrderId((prev) => ({ ...prev, [selectedTrackingOrderId]: label }))
      } catch {
        // Best effort only for location label.
      }
    }

    void fetchLabel()
    return () => controller.abort()
  }, [activeView, selectedTrackingOrderId, trackingByOrderId])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
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
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            imageUrl: product.imageUrl || null,
            unit: product.unit,
            sizeLabel: getProductSizeLabel(product),
            category: String((product as any)?.category?.name || (product as any)?.category || '').trim() || undefined,
            unitPrice: product.price,
            quantity: Math.min(qty, available),
            available,
          },
        ]
      }
      if (existing.quantity >= available) return prev
      return prev.map((i) =>
        i.productId === product.id
          ? {
              ...i,
              quantity: Math.min(existing.quantity + qty, available),
              available,
              imageUrl: i.imageUrl || product.imageUrl || null,
              sizeLabel: i.sizeLabel || getProductSizeLabel(product),
              category:
                String((i as any)?.category || '').trim() ||
                String((product as any)?.category?.name || (product as any)?.category || '').trim() ||
                undefined,
            }
          : i
      )
    })
  }

  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0) return
    setCart((prev) =>
      prev.map((item) => {
        const currentSize = String((item as any)?.sizeLabel || '').trim()
        const product = products.find((p) => String(p.id) === String(item.productId))
        const nextCategory =
          String((item as any)?.category || '').trim() ||
          String((product as any)?.category?.name || (product as any)?.category || '').trim() ||
          undefined
        if (currentSize && currentSize.toUpperCase() !== 'N/A') {
          return { ...item, category: nextCategory }
        }
        if (!product) {
          return { ...item, sizeLabel: String(item.unit || 'case').trim() || 'case', category: nextCategory }
        }
        return { ...item, sizeLabel: getProductSizeLabel(product), category: nextCategory }
      })
    )
  }, [products, setCart])

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
        .map((i) => (i.productId === productId ? { ...i, quantity: Math.max(0, Math.min(qty, i.available)) } : i))
        .filter((i) => i.quantity > 0)
    )
  }

  const cartCount = useMemo(() => cart.reduce((sum, i) => sum + i.quantity, 0), [cart])
  const selectedCartItems = useMemo(
    () => cart.filter((item) => selectedCartIds.has(item.productId)),
    [cart, selectedCartIds]
  )
  const selectedSubtotal = useMemo(
    () => selectedCartItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    [selectedCartItems]
  )
  const discountCasesAffected = useMemo(
    () => selectedCartItems.reduce((sum, i) => sum + Math.max(0, Number(i.quantity || 0)), 0),
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
    const totalDiscount = isActive ? Math.min(selectedSubtotal, Math.max(0, totalDiscountRaw)) : 0
    return {
      name,
      discountType,
      discountPercent,
      amountPerCase,
      perCaseDiscount: isActive
        ? (discountType === 'AMOUNT_PER_CASE'
          ? perCaseDiscount
          : (discountCasesAffected > 0 ? totalDiscount / discountCasesAffected : 0))
        : 0,
      casesAffected: discountCasesAffected,
      totalDiscount,
      finalTotal: Math.max(0, selectedSubtotal - totalDiscount),
    }
  }, [
    customerDiscountOption,
    customerDiscountStatus,
    customerDiscountAmountPerCase,
    customerDiscountPercent,
    discountCasesAffected,
    selectedCartItems,
    selectedSubtotal,
  ])
  const selectedCount = useMemo(() => selectedCartItems.length, [selectedCartItems])
  const canPlaceOrder = useMemo(
    () => {
      const deliveryDateText = String(deliveryDate || '').trim()
      if (!deliveryDateText) return false
      const parsedDate = parseDateOnly(deliveryDateText)
      if (!parsedDate) return false
      return parsedDate >= getLocalDateOnly() && selectedCartItems.length > 0
    },
    [selectedCartItems.length, deliveryDate]
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
      for (const item of cart) {
        if (!prev.has(item.productId)) next.add(item.productId)
      }
      return next
    })
  }, [cart])

  const productCategoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(
        products
          .map((product: any) => String(product?.category?.name || product?.category || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))
    return ['ALL', ...categories]
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase().trim()
    return products.filter((p: any) => {
      const matchesSearch =
        !q ||
        String(p?.name || '').toLowerCase().includes(q) ||
        String(p?.sku || '').toLowerCase().includes(q)
      if (!matchesSearch) return false
      if (productCategoryFilter === 'ALL') return true
      const category = String(p?.category?.name || p?.category || '').trim()
      return category === productCategoryFilter
    })
  }, [products, productSearch, productCategoryFilter])

  const composedShippingAddress = useMemo(() => {
    return [
      shippingHouseNumber,
      shippingStreetName,
      shippingSubdivision,
      shippingBarangay,
      shippingCity,
      shippingProvince || 'Negros Occidental',
      shippingZipCode,
      'Philippines',
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ')
  }, [
    shippingHouseNumber,
    shippingStreetName,
    shippingSubdivision,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    shippingZipCode,
  ])

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const normalized = String(normalizeDeliveryStatus(order.status, order.paymentStatus)).toUpperCase()
      const orderDate = new Date(order.createdAt)

      if (orderFilterStatus !== 'ALL' && normalized !== orderFilterStatus) return false

      if (orderFilterDateFrom) {
        const from = parseDateOnly(orderFilterDateFrom)
        if (from) {
          const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0)
          if (orderDate.getTime() < fromStart.getTime()) return false
        }
      }

      if (orderFilterDateTo) {
        const to = parseDateOnly(orderFilterDateTo)
        if (to) {
          const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999)
          if (orderDate.getTime() > toEnd.getTime()) return false
        }
      }

      return true
    })
  }, [orders, orderFilterStatus, orderFilterDateFrom, orderFilterDateTo])

  const deliveryIssuesByOrderId = useMemo(() => {
    const byOrderId: Record<string, DeliveryIssueSummary> = {}

    for (const item of deliveryIssueRecords) {
      const orderId = String(item?.orderId || '').trim()
      if (!orderId) continue

      const meta = parseReplacementMeta(item?.notes)
      const hasEvidence = Boolean(String(item?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim())
      const rawStatus = String(item?.status || '').toUpperCase()
      const label = getReplacementStatusLabel(item?.status)

      const reason = String(item?.description || item?.reason || 'Replacement case reported').trim()
      const nextSummary: DeliveryIssueSummary = { orderId, label, reason, hasEvidence, rawStatus }
      const existing = byOrderId[orderId]
      if (!existing || getReplacementRank(nextSummary.label) >= getReplacementRank(existing.label)) {
        byOrderId[orderId] = nextSummary
      }
    }

    return byOrderId
  }, [deliveryIssueRecords, orders])

  const sortedFilteredOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime()
      const bTime = new Date(b.createdAt).getTime()
      return bTime - aTime
    })
  }, [filteredOrders])

  const ordersTabOptions: Array<{ id: CustomerOrdersTab; label: string }> = [
    { id: 'ALL', label: 'All' },
    { id: 'DELIVERED', label: 'Delivered' },
    { id: 'TO_REVIEW', label: 'To Review' },
    { id: 'REPLACEMENT', label: 'Replacement' },
  ]

  const isReplacementOrder = (order: any): boolean =>
    String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(order?.isScheduledReplacement)

  const tabFilteredOrders = useMemo(() => {
    if (ordersTab === 'ALL') return sortedFilteredOrders.filter((order) => !isReplacementOrder(order))

    return sortedFilteredOrders.filter((order) => {
      const normalized = String(normalizeDeliveryStatus(order.status, order.paymentStatus)).toUpperCase()
      const replacementOrder = isReplacementOrder(order)
      if (ordersTab === 'TO_REVIEW') {
        return !replacementOrder && normalized === 'DELIVERED' && !reviewedOrderIds.has(order.id)
      }
      if (ordersTab === 'REPLACEMENT') {
        return replacementOrder
      }
      if (ordersTab === 'DELIVERED') {
        return !replacementOrder && normalized === 'DELIVERED'
      }

      return true
    })
  }, [sortedFilteredOrders, ordersTab, reviewedOrderIds])

  const visibleOrders = useMemo(() => {
    const query = ordersSearch.trim().toLowerCase()
    if (!query) return tabFilteredOrders

    return tabFilteredOrders.filter((order) => {
      const itemNames = (order.items || []).map((item) => item.product?.name || '').join(' ')
      const orderStatus = formatOrderStatus(order.status, order.paymentStatus).toLowerCase()
      const orderDate = new Date(order.createdAt).toLocaleDateString().toLowerCase()
      return (
        String(order.orderNumber || '').toLowerCase().includes(query) ||
        String(order.shippingAddress || '').toLowerCase().includes(query) ||
        itemNames.toLowerCase().includes(query)
        || orderStatus.includes(query)
        || orderDate.includes(query)
      )
    })
  }, [tabFilteredOrders, ordersSearch])

  const visibleReplacementRecords = useMemo(() => {
    const query = ordersSearch.trim().toLowerCase()
    const sorted = [...deliveryIssueRecords].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
    // Keep only the latest replacement per order to avoid showing stale prior cases.
    const latestByOrder = new Map<string, any>()
    for (const record of sorted) {
      const key = String(record?.orderId || record?.orderNumber || '').trim().toUpperCase()
      if (!key) continue
      if (!latestByOrder.has(key)) latestByOrder.set(key, record)
    }
    const latestOnly = Array.from(latestByOrder.values())
    if (!query) return latestOnly
    return latestOnly.filter((record) => {
      const haystack = [
        record.orderNumber,
        record.replacementNumber,
        record.originalProductName,
        record.originalProductSku,
        record.replacementProductName,
        record.replacementProductSku,
        record.reason,
        record.description,
        getReplacementStatusLabel(record.status),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [deliveryIssueRecords, ordersSearch])

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
    if (selectedCartItems.length === 0) {
      toast.error('Your cart is empty')
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
    if (!isWithinNegrosOccidental(shippingLatitude, shippingLongitude)) {
      toast.error('Delivery address must be within Negros Occidental, Philippines')
      setIsAddressDialogOpen(true)
      return
    }

    setIsPlacingOrder(true)
    const cartSnapshot = [...cart]
    const selectedIdsSnapshot = new Set(selectedCartIds)
    try {
      const { response, data } = await createCustomerOrder({
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
        items: selectedCartItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      })
      if (!response.ok || data?.success === false) {
        const errorMessage = String(data?.error || data?.message || '').trim()
        throw new Error(errorMessage || `Failed to place order (HTTP ${response.status})`)
      }
      setLastPlacedOrderNumber(String(data?.order?.orderNumber || data?.order?.id || '').trim())
      setIsOrderConfirmationOpen(true)
      if (data?.order) {
        setOrders((prev) => [data.order, ...prev])
      }
      const selectedIds = new Set(selectedCartItems.map((item) => item.productId))
      setCart((prev) => prev.filter((item) => !selectedIds.has(item.productId)))
      setSelectedCartIds((prev) => {
        const next = new Set(prev)
        selectedIds.forEach((id) => next.delete(id))
        return next
      })
      // Refresh once in background via shared sync channel.
      emitDataSync(['orders'])
      setOrdersTab('ALL')
      setOrdersSearch('')
      setActiveView('orders')
    } catch (e: any) {
      setCart(cartSnapshot)
      setSelectedCartIds(selectedIdsSnapshot)
      toast.error(e?.message || 'Failed to place order')
    } finally {
      setIsPlacingOrder(false)
    }
  }

  const downloadReceipt = downloadOrderReceipt

  const openTrackView = (orderId: string) => {
    setSelectedTrackingOrderId(orderId)
    setActiveView('track')
  }


  const openRatingDialog = (order: Order, initialDeliveryRating = 5) => {
    if (reviewedOrderIds.has(order.id)) {
      setReviewDetailsOrder(order)
      return
    }
    setRatingDialogOrder(order)
    setDeliveryRatingValue(Math.max(1, Math.min(5, Math.round(initialDeliveryRating))))
    setRatingComment('')
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

  const buyAgainFromOrder = (order: any) => {
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

    orderItems.forEach((item: any) => {
      const productId = String(item?.product?.id || item?.productId || '').trim()
      const qty = Math.max(1, Number(item?.quantity || 1))
      if (!productId) {
        skippedCount += 1
        missingProductRefCount += 1
        return
      }

      const catalogProduct = products.find((p) => String(p.id) === productId)
      if (!catalogProduct) {
        skippedCount += 1
        productNotFoundCount += 1
        return
      }

      const available = getAvailableQty(catalogProduct)
      if (available <= 0) {
        skippedCount += 1
        outOfStockCount += 1
        return
      }

      addToCart(catalogProduct, Math.min(qty, available))
      addedCount += 1
    })

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

  const submitRating = async (selectedFeedbackOptions: string[] = []) => {
    if (!ratingDialogOrder?.id) return false
    if (deliveryRatingValue === 0) {
      toast.error('Please select a rating')
      return false
    }
    if (reviewedOrderIds.has(ratingDialogOrder.id)) {
      toast.info('You already rated this order')
      setRatingDialogOrder(null)
      return false
    }

    setIsSubmittingRating(true)
    try {
      const overallRating = Math.max(1, Math.min(5, Math.round(deliveryRatingValue)))
      const selectedReasons = Array.from(
        new Set(
          selectedFeedbackOptions
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      )
      const composedMessage = selectedReasons.map((reason) => `- ${reason}`).join('\n')
      const { response, payload } = await submitOrderFeedback({
        orderId: ratingDialogOrder.id,
        rating: overallRating,
        type: overallRating <= 2 ? 'COMPLAINT' : overallRating === 3 ? 'SUGGESTION' : 'COMPLIMENT',
        subject: `Order Review - ${ratingDialogOrder.orderNumber}`,
        message: composedMessage,
      })
      if (response.status === 409) {
        setReviewedOrderIds((prev) => {
          const next = new Set(prev)
          next.add(ratingDialogOrder.id)
          return next
        })
        void fetchOrderMeta()
        toast.info('This order is already rated')
        setRatingDialogOrder(null)
        setRatingComment('')
        setDeliveryRatingValue(5)
        return true
      }

      if (!response.ok || payload?.success === false) {
        const backendMessage = String(payload?.error || payload?.message || '').trim()
        const statusHint = response?.status ? ` (${response.status})` : ''
        throw new Error((backendMessage || 'Failed to submit rating') + statusHint)
      }

      setReviewedOrderIds((prev) => {
        const next = new Set(prev)
        next.add(ratingDialogOrder.id)
        return next
      })
      void fetchOrderMeta()
      toast.success('Review submitted successfully')
      setRatingDialogOrder(null)
      setRatingComment('')
      setDeliveryRatingValue(5)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit rating')
      return false
    } finally {
      setIsSubmittingRating(false)
    }
  }

  const requestCancelOrder = (orderId: string) => {
    const source = orders.find((item) => item.id === orderId) || (selectedOrder?.id === orderId ? selectedOrder : null)
    const orderNumber = String(source?.orderNumber || 'this order')
    setPendingCancelOrder({ id: orderId, orderNumber })
  }

  const confirmCancelOrder = async () => {
    const orderId = pendingCancelOrder?.id
    if (!orderId) return
    setIsCancellingOrder(true)
    try {
      const { response, payload } = await cancelCustomerOrder(orderId)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to cancel order')
      }
      const updatedOrder = payload?.order || { id: orderId, status: 'CANCELLED', paymentStatus: 'cancelled' }
      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, ...updatedOrder, status: 'CANCELLED', paymentStatus: 'cancelled' } : order))
      )
      setSelectedOrder((prev) =>
        prev?.id === orderId ? { ...prev, ...updatedOrder, status: 'CANCELLED', paymentStatus: 'cancelled' } : prev
      )
      toast.success('Order cancelled successfully')
      // Refresh once in background via shared sync channel.
      emitDataSync(['orders'])
      setPendingCancelOrder(null)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel order')
    } finally {
      setIsCancellingOrder(false)
    }
  }

  const saveAddressToProfile = async () => {
    if (!customerId) {
      toast.error('Unable to save address right now')
      return false
    }
    if (
      !shippingStreetName ||
      !shippingCity ||
      !shippingProvince ||
      !shippingZipCode
    ) {
      toast.error('Please complete street, city, province, and postal code before saving')
      return false
    }
    if (shippingLatitude === null || shippingLongitude === null) {
      toast.error('Please pin your address on the map before saving')
      return false
    }
    if (!isWithinNegrosOccidental(shippingLatitude, shippingLongitude)) {
      toast.error('Pinned location must be within Negros Occidental, Philippines')
      return false
    }
    const normalizedShippingPhone = String(shippingPhone || '').replace(/\D/g, '')
    if (!normalizedShippingPhone || !isValidPhilippinePhone(normalizedShippingPhone)) {
      toast.error('Please enter a valid Philippine mobile number before saving')
      return false
    }

    setIsSavingAddress(true)
    try {
      const { response, payload: data } = await updateCustomerProfile(customerId, {
        address: composedShippingAddress,
        barangay: shippingBarangay,
        subdivision: shippingSubdivision,
        streetName: shippingStreetName,
        houseNumber: shippingHouseNumber,
        city: shippingCity,
        province: shippingProvince || 'Negros Occidental',
        zipCode: shippingZipCode,
        country: 'Philippines',
        latitude: shippingLatitude,
        longitude: shippingLongitude,
        phone: normalizedShippingPhone,
      })
      if (!response.ok || data?.success === false) throw new Error(data?.error || 'Failed to save')
      const updatedCustomer = extractCustomerPayload(data)
      if (updatedCustomer) {
        hydrateAddressFromProfile(updatedCustomer)
      }
      await loadCustomerProfile()
      toast.success('Address saved successfully')
      return true
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save address')
      return false
    } finally {
      setIsSavingAddress(false)
    }
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        if (!isWithinNegrosOccidental(lat, lng)) {
          toast.error('Current location is outside Negros Occidental, Philippines')
          return
        }
        await handlePinnedLocation(lat, lng)
        toast.success('Current location pinned')
      },
      () => {
        toast.error('Failed to get your current location')
      }
    )
  }

  const handlePinnedLocation = async (lat: number, lng: number) => {
    setShippingLatitude(lat)
    setShippingLongitude(lng)
    setIsResolvingPinnedAddress(true)

    try {
      const fetchReverse = async (zoom: number) => {
        const reverseResponse = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&countrycodes=ph&zoom=${zoom}`,
          {
            headers: {
              Accept: 'application/json',
            },
          }
        )
        if (!reverseResponse.ok) {
          throw new Error('Reverse geocoding failed')
        }
        return reverseResponse.json()
      }

      const data = await fetchReverse(18)

      const addr = data?.address || {}
      const displayName = String(data?.display_name || '')
      const displayParts = displayName
        .split(',')
        .map((part: string) => part.trim())
        .filter(Boolean)
      const postcodeFromDisplay = displayName.match(/\b\d{4}\b/)?.[0] || ''
      const normalizeAddressToken = (value: string) =>
        String(value || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .trim()
      const isPostalLike = (value: string) => /^\d{4}$/.test(String(value || '').trim())
      const isCountryLike = (value: string) => /philippines/i.test(String(value || ''))
      const isBarangayLike = (value: string) => /\b(barangay|brgy\.?|poblacion)\b/i.test(String(value || ''))
      const isSubdivisionLike = (value: string) =>
        /\b(subdivision|homes?|villages?|heights?|plains?|residences?)\b/i.test(String(value || ''))
      const isStreetLike = (value: string) =>
        /\b(street|st\.?|road|rd\.?|avenue|ave\.?|highway|hwy|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|way|purok\s*\d*)\b/i.test(String(value || ''))

      const barangayFromDisplay =
        displayParts.find((part: string) => /^(barangay|brgy\.?)\s+/i.test(part)) ||
        displayParts.find((part: string) => /\b(barangay|brgy\.?)\b/i.test(part)) ||
        ''

      const houseNumber = String(addr.house_number || '').trim()
      const streetName = String(
        addr.road ||
          addr.residential ||
          addr.pedestrian ||
          addr.path ||
          addr.footway ||
          addr.street ||
          displayParts[0] ||
          ''
      ).trim()
      let subdivision = String(
        addr.subdivision ||
          // Keep optional subdivision conservative: only explicit subdivision-like fields.
          addr.allotments ||
          addr.village ||
          ''
      ).trim()
      if (subdivision && !isSubdivisionLike(subdivision)) {
        subdivision = ''
      }
      let city = String(
        addr.city ||
          addr.town ||
          addr.municipality ||
          ''
      ).trim()
      let province = String(addr.state || addr.region || '').trim()
      const postcode = String(addr.postcode || postcodeFromDisplay || '').trim()
      const country = String(addr.country || 'Philippines').trim()

      if (!province) {
        province =
          displayParts.find((part: string) => /negros occidental/i.test(part)) ||
          displayParts.find((part: string) => /province|occidental/i.test(part)) ||
          'Negros Occidental'
      }

      if (!city) {
        const provinceIndex = displayParts.findIndex(
          (part: string) => normalizeAddressToken(part) === normalizeAddressToken(province)
        )
        if (provinceIndex > 0) {
          city = displayParts[provinceIndex - 1] || ''
        } else {
          city =
            displayParts.find((part: string) => /city|municipality|silay|bacolod|talisay|bago|cadiz|escalante|victorias|himamaylan|kabankalan|sagay|san carlos|la carlota/i.test(part)) ||
            ''
        }
      }

      const localityTokens = displayParts.filter((part: string) => {
        const normalized = normalizeAddressToken(part)
        if (!normalized) return false
        if (isCountryLike(part)) return false
        if (isPostalLike(part)) return false
        if (normalizeAddressToken(part) === normalizeAddressToken(province)) return false
        if (city && normalizeAddressToken(part) === normalizeAddressToken(city)) return false
        if (streetName && normalizeAddressToken(part) === normalizeAddressToken(streetName)) return false
        if (isStreetLike(part)) return false
        return true
      })

      let barangay = String(
        addr.barangay ||
          addr.suburb ||
          addr.neighbourhood ||
          addr.quarter ||
          addr.city_district ||
          addr.hamlet ||
          barangayFromDisplay ||
          ''
      ).trim()

      // Prefer explicit barangay tokens from display name when available.
      if (barangayFromDisplay) {
        barangay = barangayFromDisplay
      }

      // If reverse geocoder omits barangay, infer it from display tokens nearest to city/province.
      if (!barangay) {
        const likelyBarangay =
          localityTokens.find((token) => /barangay|brgy|poblacion|purok|sitio/i.test(token)) ||
          localityTokens.find((token) => !isStreetLike(token) && !isSubdivisionLike(token)) ||
          ''
        barangay = String(likelyBarangay || '').trim()
      }

      // Never keep barangay-like text in subdivision.
      if (subdivision && isBarangayLike(subdivision)) {
        if (!barangay) barangay = subdivision
        subdivision = ''
      }

      // Avoid duplicate values between subdivision and barangay.
      if (
        subdivision &&
        barangay &&
        normalizeAddressToken(subdivision) === normalizeAddressToken(barangay)
      ) {
        subdivision = ''
      }

      // Avoid putting city value into barangay when reverse geocoder returns coarse data.
      if (barangay && city && normalizeAddressToken(barangay) === normalizeAddressToken(city)) {
        barangay = ''
      }
      if (barangay && streetName && normalizeAddressToken(barangay) === normalizeAddressToken(streetName)) {
        barangay = ''
      }
      if (barangay && isStreetLike(barangay)) {
        barangay = ''
      }
      if (barangay && isSubdivisionLike(barangay)) {
        if (!subdivision) subdivision = barangay
        barangay = ''
      }

      // Fallback: if barangay is still missing at high zoom (POI-level),
      // request a coarser reverse-geocode to recover locality-level barangay.
      if (!barangay) {
        try {
          const coarseData = await fetchReverse(15)
          const coarseAddr = coarseData?.address || {}
          const coarseDisplayName = String(coarseData?.display_name || '')
          const coarseDisplayParts = coarseDisplayName
            .split(',')
            .map((part: string) => part.trim())
            .filter(Boolean)
          const coarseBarangayFromDisplay =
            coarseDisplayParts.find((part: string) => /^(barangay|brgy\.?)\s+/i.test(part)) ||
            coarseDisplayParts.find((part: string) => /\b(barangay|brgy\.?|poblacion|sitio|purok)\b/i.test(part)) ||
            ''
          const coarseCandidate = String(
            coarseAddr.barangay ||
              coarseAddr.suburb ||
              coarseAddr.neighbourhood ||
              coarseAddr.quarter ||
              coarseAddr.city_district ||
              coarseAddr.hamlet ||
              coarseBarangayFromDisplay ||
              ''
          ).trim()
          if (
            coarseCandidate &&
            (!city || normalizeAddressToken(coarseCandidate) !== normalizeAddressToken(city)) &&
            (!streetName || normalizeAddressToken(coarseCandidate) !== normalizeAddressToken(streetName)) &&
            !isStreetLike(coarseCandidate) &&
            !isSubdivisionLike(coarseCandidate)
          ) {
            barangay = coarseCandidate
          }
        } catch {
          // Keep manual entry flow when coarse lookup fails.
        }
      }

      // Final fallback: use nearest locality token if still empty.
      if (!barangay) {
        const finalLocalityToken =
          localityTokens.find((token) => /barangay|brgy|poblacion|sitio|purok/i.test(token)) ||
          localityTokens.find((token) => !isStreetLike(token) && !isSubdivisionLike(token)) ||
          ''
        if (
          finalLocalityToken &&
          (!city || normalizeAddressToken(finalLocalityToken) !== normalizeAddressToken(city)) &&
          (!streetName || normalizeAddressToken(finalLocalityToken) !== normalizeAddressToken(streetName))
        ) {
          barangay = String(finalLocalityToken).trim()
        }
      }

      setShippingHouseNumber(houseNumber)
      setShippingStreetName(streetName)
      setShippingSubdivision(subdivision)
      setShippingBarangay(barangay)
      setShippingCity(city)
      setShippingProvince(province)
      setShippingZipCode(postcode)
      setShippingCountry(country)
    } catch {
      toast.error('Pinned location set, but address auto-fill failed. You can fill fields manually.')
    } finally {
      setIsResolvingPinnedAddress(false)
    }
  }

  useEffect(() => {
    if (!isAddressDialogOpen) return
    if (isResolvingPinnedAddress) return

    const street = String(shippingStreetName || '').trim()
    const barangay = String(shippingBarangay || '').trim()
    const city = String(shippingCity || '').trim()
    const province = String(shippingProvince || '').trim()
    const zip = String(shippingZipCode || '').trim()
    const country = String(shippingCountry || 'Philippines').trim()
    const house = String(shippingHouseNumber || '').trim()
    const subdivision = String(shippingSubdivision || '').trim()

    if (!street || !city || !province) return

    const addressParts = [house, street, subdivision, barangay, city, province, zip, country]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
    const query = addressParts.join(', ')
    if (!query || query === lastManualAddressQueryRef.current) return

    if (manualAddressPinDebounceRef.current) {
      clearTimeout(manualAddressPinDebounceRef.current)
    }

    manualAddressPinDebounceRef.current = setTimeout(async () => {
      try {
        if (manualAddressPinAbortRef.current) {
          manualAddressPinAbortRef.current.abort()
        }
        const controller = new AbortController()
        manualAddressPinAbortRef.current = controller

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        )
        if (!response.ok) return

        const data = await response.json()
        const top = Array.isArray(data) ? data[0] : null
        const lat = Number(top?.lat)
        const lng = Number(top?.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
        if (!isWithinNegrosOccidental(lat, lng)) return

        const sameLat = shippingLatitude !== null && Math.abs(shippingLatitude - lat) < 0.00001
        const sameLng = shippingLongitude !== null && Math.abs(shippingLongitude - lng) < 0.00001
        if (sameLat && sameLng) {
          lastManualAddressQueryRef.current = query
          return
        }

        setShippingLatitude(lat)
        setShippingLongitude(lng)
        lastManualAddressQueryRef.current = query
      } catch {
        // Keep manual typing flow uninterrupted when geocoding fails.
      }
    }, 700)

    return () => {
      if (manualAddressPinDebounceRef.current) {
        clearTimeout(manualAddressPinDebounceRef.current)
        manualAddressPinDebounceRef.current = null
      }
    }
  }, [
    isAddressDialogOpen,
    isResolvingPinnedAddress,
    shippingHouseNumber,
    shippingStreetName,
    shippingSubdivision,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    shippingZipCode,
    shippingCountry,
    shippingLatitude,
    shippingLongitude,
    setShippingLatitude,
    setShippingLongitude,
  ])

  useEffect(() => {
    return () => {
      if (manualAddressPinDebounceRef.current) {
        clearTimeout(manualAddressPinDebounceRef.current)
      }
      if (manualAddressPinAbortRef.current) {
        manualAddressPinAbortRef.current.abort()
      }
    }
  }, [])

  const searchAddressInNegrosOccidental = async () => {
    const query = addressSearch.trim()
    if (!query) {
      toast.error('Type an address to search')
      return
    }

    setIsSearchingAddress(true)
    try {
      const [localResponse, broadResponse] = await Promise.all([
        fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=15&addressdetails=1&q=${encodeURIComponent(
            `${query}, Negros Occidental, Philippines`
          )}`
        ),
        fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=15&addressdetails=1&q=${encodeURIComponent(
            `${query}, Philippines`
          )}`
        ),
      ])

      if (!localResponse.ok && !broadResponse.ok) throw new Error('Search failed')

      type SearchAddress = {
        house_number?: string
        road?: string
        pedestrian?: string
        path?: string
        barangay?: string
        village?: string
        suburb?: string
        neighbourhood?: string
        city?: string
        town?: string
        municipality?: string
        province?: string
      }
      type SearchItem = {
        display_name: string
        lat: string
        lon: string
        address?: SearchAddress
      }

      const localData: SearchItem[] = localResponse.ok ? await localResponse.json() : []
      const broadData: SearchItem[] = broadResponse.ok ? await broadResponse.json() : []
      const data = [...localData, ...broadData]

      const results = (data || [])
        .map((item) => ({
          displayName: (() => {
            const addr = item.address || {}
            const isSubdivisionLike = (value: string) =>
              /\b(subdivision|homes?|villages?|heights?|plains?|residences?)\b/i.test(String(value || ''))
            const street = [addr.house_number, addr.road || addr.pedestrian || addr.path].filter(Boolean).join(' ')
            const barangay = addr.barangay || ''
            const subdivision = isSubdivisionLike(String(addr.village || '')) ? String(addr.village) : ''
            const area = addr.suburb || addr.neighbourhood || subdivision || ''
            const city = addr.city || addr.town || addr.municipality || ''
            const province = addr.province || ''
            const parts = [street, barangay, area, city, province].filter(Boolean)
            return parts.length > 0 ? parts.join(', ') : item.display_name
          })(),
          latitude: Number(item.lat),
          longitude: Number(item.lon),
        }))
        .filter(
          (item) =>
            Number.isFinite(item.latitude) &&
            Number.isFinite(item.longitude) &&
            isWithinNegrosOccidental(item.latitude, item.longitude)
        )
        .filter((item, index, arr) => arr.findIndex((x) => x.latitude === item.latitude && x.longitude === item.longitude) === index)
        .slice(0, 10)

      setAddressSearchResults(results)
      if (results.length === 0) {
        toast.error('No matching address found in Negros Occidental')
      }
    } catch {
      toast.error('Failed to search address')
      setAddressSearchResults([])
    } finally {
      setIsSearchingAddress(false)
    }
  }

  const avatarPreviewUrl = useMemo(() => {
    if (profileAvatarFile) return URL.createObjectURL(profileAvatarFile)
    return profileAvatar
  }, [profileAvatar, profileAvatarFile])

  useEffect(() => {
    if (!profileAvatarFile) return
    return () => {
      if (avatarPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }
    }
  }, [avatarPreviewUrl, profileAvatarFile])

  const uploadProfileAvatar = async (file: File) => {
    const { response, payload } = await uploadCustomerAvatar(file)
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload profile photo')
    }
    return String(payload.imageUrl)
  }

  const saveProfile = async () => {
    if (!customerId) {
      toast.error('Unable to save profile right now')
      return false
    }
    if (!profileName.trim()) {
      toast.error('Name is required')
      return false
    }
    if (!profileEmail.trim()) {
      toast.error('Email is required')
      return false
    }
    const normalizedProfilePhone = String(profilePhone || '').replace(/\D/g, '')
    if (!normalizedProfilePhone || !isValidPhilippinePhone(normalizedProfilePhone)) {
      toast.error('Please enter a valid Philippine mobile number before saving')
      return false
    }

    setIsSavingProfile(true)
    try {
      let avatarToSave = profileAvatar
      if (profileAvatarFile) {
        avatarToSave = await uploadProfileAvatar(profileAvatarFile)
      }

      const { response, payload } = await updateCustomerProfile(customerId, {
        name: profileName.trim(),
        email: profileEmail.trim(),
        phone: normalizedProfilePhone,
        avatar: avatarToSave,
      })
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      const updatedCustomer = extractCustomerPayload(payload)
      if (updatedCustomer) {
        setProfileName(String(updatedCustomer.name || '').trim())
        setProfileEmail(String(updatedCustomer.email || '').trim())
        setProfilePhone(String(updatedCustomer.phone || '').trim())
        setProfileAvatar(updatedCustomer.avatar ? String(updatedCustomer.avatar) : null)
        setProfileAvatarFile(null)
        if (updatedCustomer.phone !== undefined) {
          setShippingPhone(String(updatedCustomer.phone || '').trim())
        }
        if (updatedCustomer.name) {
          setShippingName(String(updatedCustomer.name).trim())
        }
        if (user) {
          setUser({
            ...(user as any),
            name: String(updatedCustomer.name || profileName).trim(),
            email: String(updatedCustomer.email || profileEmail).trim(),
            avatar: updatedCustomer.avatar ? String(updatedCustomer.avatar) : null,
          })
        }
      }

      await loadCustomerProfile()
      toast.success('Profile updated successfully')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
      return false
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleAvatarUpload = async (file: File | null) => {
    if (!file) return
    if (!customerId) {
      toast.error('Unable to upload photo right now')
      return
    }

    setIsSavingProfile(true)
    try {
      const avatarUrl = await uploadProfileAvatar(file)
      const { response, payload } = await updateCustomerProfile(customerId, { avatar: avatarUrl })
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile photo')
      }

      setProfileAvatar(avatarUrl)
      if (user) {
        setUser({
          ...(user as any),
          avatar: avatarUrl,
        })
      }
      await loadCustomerProfile()
      toast.success('Profile photo updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile photo')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const openAvatarCropDialog = async (file: File | null) => {
    if (!file) return
    try {
      const objectUrl = URL.createObjectURL(file)
      setAvatarCropFile(file)
      setAvatarCropSource(objectUrl)
      setAvatarCropZoom(1)
      setAvatarCropX(0)
      setAvatarCropY(0)
      setIsAvatarCropDialogOpen(true)
    } catch {
      toast.error('Failed to open image cropper')
    }
  }

  const createCroppedAvatarFile = async (): Promise<File | null> => {
    if (!avatarCropSource) return null

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = avatarCropSource
    })

    const outputSize = 512
    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof (ctx as any).clearRect !== 'function' || typeof (ctx as any).drawImage !== 'function') {
      toast.error('Image editor is unavailable on this device. Please try another photo.')
      return null
    }

    const baseScale = Math.max(outputSize / image.width, outputSize / image.height)
    const scale = baseScale * avatarCropZoom
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const x = (outputSize - drawWidth) / 2 + avatarCropX
    const y = (outputSize - drawHeight) / 2 + avatarCropY

    try {
      ctx.clearRect(0, 0, outputSize, outputSize)
      ctx.drawImage(image, x, y, drawWidth, drawHeight)
    } catch {
      toast.error('Failed to process the selected image.')
      return null
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.92)
    })
    if (!blob) return null
    return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
  }

  const clampCropOffset = (value: number) => Math.max(-160, Math.min(160, value))

  const handleCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!avatarCropSource) return
    cropDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      initialX: avatarCropX,
      initialY: avatarCropY,
    }
    setIsDraggingCrop(true)
  }

  const handleCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropDragRef.current.active) return
    const dx = event.clientX - cropDragRef.current.startX
    const dy = event.clientY - cropDragRef.current.startY
    setAvatarCropX(clampCropOffset(cropDragRef.current.initialX + dx))
    setAvatarCropY(clampCropOffset(cropDragRef.current.initialY + dy))
  }

  const handleCropPointerUp = () => {
    if (!cropDragRef.current.active) return
    cropDragRef.current.active = false
    setIsDraggingCrop(false)
  }

  return (
    <div className={`${poppins.className} h-[100dvh] overflow-hidden bg-[#d7dce3] md:bg-[#d8dce2]`}>
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-transparent md:h-screen md:max-w-none md:rounded-none md:border-0 md:shadow-none">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-20 h-56 w-56 rounded-full bg-sky-200/35 blur-3xl" />
        <div className="absolute -bottom-16 -right-16 h-72 w-72 rounded-full bg-lime-200/30 blur-3xl" />
      </div>
      <div className="relative z-[1] flex h-full min-h-0 flex-col">
      <CustomerPortalHeader
        activeView={activeView}
        setActiveView={setActiveView}
        cartCount={cartCount}
        avatarPreviewUrl={avatarPreviewUrl}
        profileName={profileName}
        user={user}
        setIsAddressDialogOpen={setIsAddressDialogOpen}
        handleLogout={handleLogout}
      />

      <div className="flex min-h-0 flex-1">
      <CustomerBottomNav activeView={activeView} setActiveView={setActiveView} />
      <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={activeView}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="flex-1 min-h-0 w-full overflow-y-auto space-y-4 px-2 pb-24 pt-0 sm:px-3 md:px-6 md:pb-8 md:pt-2"
      >
        {activeView === 'home' && (
          <CustomerHomeView
            customerName={String(user?.name || profileName || '').trim()}
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            productCategoryFilter={productCategoryFilter}
            setProductCategoryFilter={setProductCategoryFilter}
            productCategoryOptions={productCategoryOptions}
            isProductsLoading={isProductsLoading}
            filteredProducts={filteredProducts}
            getAvailableQty={getAvailableQty}
            addToCartDirect={addToCartDirect}
            getProductImage={getProductImage}
            formatPeso={formatPeso}
            cart={cart}
            onOpenCart={() => setActiveView('cart')}
          />
        )}

        {activeView === 'cart' && (
          <CustomerCartView
            setActiveView={setActiveView}
            cart={cart}
            setIsAddressDialogOpen={setIsAddressDialogOpen}
            shippingBarangay={shippingBarangay}
            shippingCity={shippingCity}
            shippingProvince={shippingProvince}
            selectedCartIds={selectedCartIds}
            setSelectedCartIds={setSelectedCartIds}
            getProductImage={getProductImage}
            updateCartQty={updateCartQty}
            allCartSelected={allCartSelected}
            selectedCount={selectedCount}
            selectedSubtotal={selectedSubtotal}
            formatPeso={formatPeso}
          />
        )}

        {activeView === 'checkout' && (
          <CustomerCheckoutView
            setActiveView={setActiveView}
            selectedCartItems={selectedCartItems}
            shippingName={shippingName}
            setIsAddressDialogOpen={setIsAddressDialogOpen}
            shippingPhone={shippingPhone}
            composedShippingAddress={composedShippingAddress}
            getProductImage={getProductImage}
            formatPeso={formatPeso}
            selectedSubtotal={selectedSubtotal}
            discountName={checkoutDiscountBreakdown.name}
            discountType={checkoutDiscountBreakdown.discountType}
            discountPercent={checkoutDiscountBreakdown.discountPercent}
            discountAmountPerCase={checkoutDiscountBreakdown.amountPerCase}
            discountPerCase={checkoutDiscountBreakdown.perCaseDiscount}
            discountCasesAffected={checkoutDiscountBreakdown.casesAffected}
            totalDiscount={checkoutDiscountBreakdown.totalDiscount}
            finalTotal={checkoutDiscountBreakdown.finalTotal}
            notes={notes}
            setNotes={setNotes}
            deliveryDate={deliveryDate}
            setDeliveryDate={setDeliveryDate}
            placeOrder={placeOrder}
            isPlacingOrder={isPlacingOrder}
            canPlaceOrder={canPlaceOrder}
          />
        )}

        {activeView === 'orders' && (
          <CustomerOrdersView
            ordersSearch={ordersSearch}
            setOrdersSearch={setOrdersSearch}
            ordersTabOptions={ordersTabOptions}
            ordersTab={ordersTab}
            setOrdersTab={setOrdersTab}
            isLoading={isLoading}
            visibleReplacementRecords={visibleReplacementRecords}
            orders={orders}
            getReplacementStatusLabel={getReplacementStatusLabel}
            getReplacementBadgeClass={getReplacementBadgeClass}
            visibleOrders={visibleOrders}
            deliveryIssuesByOrderId={deliveryIssuesByOrderId}
            deliveryIssueRecords={deliveryIssueRecords}
            normalizeDeliveryStatus={normalizeDeliveryStatus}
            reviewedOrderIds={reviewedOrderIds}
            orderRatings={orderRatings}
            formatOrderStatus={formatOrderStatus}
            isOrderCancellable={isOrderCancellable}
            cancelOrder={requestCancelOrder}
            openRatingDialog={openRatingDialog}
            reviewByOrderId={reviewByOrderId}
            openReviewDetails={(order: Order) => setReviewDetailsOrder(order)}
            setSelectedOrder={setSelectedOrder}
            isOrderTrackable={isOrderTrackable}
            openTrackView={openTrackView}
            buyAgainFromOrder={buyAgainFromOrder}
            getProductImage={getProductImage}
            formatPeso={formatPeso}
            openFilterDialog={() => setIsFilterDialogOpen(true)}
          />
        )}

        {activeView === 'track' && (
          <CustomerTrackView
            orders={orders}
            selectedTrackingOrderId={selectedTrackingOrderId}
            setActiveView={setActiveView}
            trackingByOrderId={trackingByOrderId}
            normalizeDeliveryStatus={normalizeDeliveryStatus}
            getOrderStageIndex={getOrderStageIndex}
            formatOrderStatus={formatOrderStatus}
            isTrackingLoading={isTrackingLoading}
            formatPeso={formatPeso}
          />
        )}

        {activeView === 'feedback' && <CustomerFeedbackView />}

        {activeView === 'profile' && (
          <CustomerProfileView
            avatarPreviewUrl={avatarPreviewUrl}
            profileName={profileName}
            profileEmail={profileEmail}
            profilePhone={profilePhone}
            composedShippingAddress={composedShippingAddress}
            shippingCity={shippingCity}
            shippingProvince={shippingProvince}
            shippingZipCode={shippingZipCode}
            user={user}
            isSavingProfile={isSavingProfile}
            avatarInputRef={avatarInputRef}
            openAvatarCropDialog={openAvatarCropDialog}
            setIsProfileDialogOpen={setIsProfileDialogOpen}
          />
        )}
      </motion.main>
      </AnimatePresence>
      </div>

      <CustomerProfileDialog
        isProfileDialogOpen={isProfileDialogOpen}
        setIsProfileDialogOpen={setIsProfileDialogOpen}
        profileName={profileName}
        setProfileName={setProfileName}
        profileEmail={profileEmail}
        setProfileEmail={setProfileEmail}
        profilePhone={profilePhone}
        setProfilePhone={setProfilePhone}
        composedShippingAddress={composedShippingAddress}
        shippingCity={shippingCity}
        shippingProvince={shippingProvince}
        shippingZipCode={shippingZipCode}
        setIsAddressDialogOpen={setIsAddressDialogOpen}
        saveProfile={saveProfile}
        isSavingProfile={isSavingProfile}
        avatarPreviewUrl={avatarPreviewUrl}
        user={user}
        avatarInputRef={avatarInputRef}
        openAvatarCropDialog={openAvatarCropDialog}
      />

      <CustomerAvatarCropDialog
        isAvatarCropDialogOpen={isAvatarCropDialogOpen}
        setIsAvatarCropDialogOpen={setIsAvatarCropDialogOpen}
        avatarCropSource={avatarCropSource}
        setAvatarCropSource={setAvatarCropSource}
        setAvatarCropFile={setAvatarCropFile}
        isDraggingCrop={isDraggingCrop}
        handleCropPointerDown={handleCropPointerDown}
        handleCropPointerMove={handleCropPointerMove}
        handleCropPointerUp={handleCropPointerUp}
        avatarCropImageRef={avatarCropImageRef}
        avatarCropZoom={avatarCropZoom}
        setAvatarCropZoom={setAvatarCropZoom}
        isSavingProfile={isSavingProfile}
        createCroppedAvatarFile={createCroppedAvatarFile}
        avatarCropFile={avatarCropFile}
        handleAvatarUpload={handleAvatarUpload}
      />

      <CustomerAddressDialog
        isAddressDialogOpen={isAddressDialogOpen}
        setIsAddressDialogOpen={setIsAddressDialogOpen}
        setShippingHouseNumber={setShippingHouseNumber}
        setShippingStreetName={setShippingStreetName}
        setShippingSubdivision={setShippingSubdivision}
        setShippingBarangay={setShippingBarangay}
        setShippingCity={setShippingCity}
        setShippingProvince={setShippingProvince}
        setShippingZipCode={setShippingZipCode}
        setShippingLatitude={setShippingLatitude}
        setShippingLongitude={setShippingLongitude}
        setAddressSearch={setAddressSearch}
        setAddressSearchResults={setAddressSearchResults}
        shippingName={shippingName}
        setShippingName={setShippingName}
        shippingPhone={shippingPhone}
        setShippingPhone={setShippingPhone}
        addressSearch={addressSearch}
        isSearchingAddress={isSearchingAddress}
        searchAddressInNegrosOccidental={searchAddressInNegrosOccidental}
        addressSearchResults={addressSearchResults}
        handlePinnedLocation={handlePinnedLocation}
        shippingHouseNumber={shippingHouseNumber}
        shippingStreetName={shippingStreetName}
        shippingSubdivision={shippingSubdivision}
        shippingBarangay={shippingBarangay}
        shippingCity={shippingCity}
        shippingProvince={shippingProvince}
        shippingZipCode={shippingZipCode}
        shippingCountry={shippingCountry}
        composedShippingAddress={composedShippingAddress}
        useCurrentLocation={useCurrentLocation}
        shippingLatitude={shippingLatitude}
        shippingLongitude={shippingLongitude}
        isResolvingPinnedAddress={isResolvingPinnedAddress}
        saveAddressToProfile={saveAddressToProfile}
        isSavingAddress={isSavingAddress}
      />

      <CustomerOrderDetailsDialog
        selectedOrder={selectedOrder}
        setSelectedOrder={setSelectedOrder}
        setIsReceiptDialogOpen={setIsReceiptDialogOpen}
        downloadReceipt={downloadReceipt}
        formatOrderStatus={formatOrderStatus}
        orderStages={orderStages}
        getOrderStageIndex={getOrderStageIndex}
        getProductImage={getProductImage}
        formatPeso={formatPeso}
        deliveryIssueRecords={deliveryIssueRecords}
        getReplacementStatusLabel={getReplacementStatusLabel}
        getReplacementBadgeClass={getReplacementBadgeClass}
        isOrderTrackable={isOrderTrackable}
        openTrackView={openTrackView}
        isOrderCancellable={isOrderCancellable}
        cancelOrder={requestCancelOrder}
        isOrderDelivered={isOrderDelivered}
        submitReplacementRequest={submitReplacementRequest}
      />

      <CustomerReceiptDialog
        selectedOrder={selectedOrder}
        isReceiptDialogOpen={isReceiptDialogOpen}
        setIsReceiptDialogOpen={setIsReceiptDialogOpen}
        isOrderDelivered={isOrderDelivered}
        formatPeso={formatPeso}
        downloadReceipt={downloadReceipt}
      />

      <CustomerRatingDialog
        ratingDialogOrder={ratingDialogOrder}
        setRatingDialogOrder={setRatingDialogOrder}
        deliveryRatingValue={deliveryRatingValue}
        setDeliveryRatingValue={setDeliveryRatingValue}
        ratingComment={ratingComment}
        setRatingComment={setRatingComment}
        isSubmittingRating={isSubmittingRating}
        submitRating={submitRating}
      />

      <Dialog open={!!reviewDetailsOrder} onOpenChange={(open) => !open && setReviewDetailsOrder(null)}>
        {reviewDetailsOrder ? (() => {
          const review = reviewByOrderId[reviewDetailsOrder.id] || null
          const ratingValue = Number(review?.rating || orderRatings[reviewDetailsOrder.id] || 0)
          const stars = Math.max(0, Math.min(5, Math.round(ratingValue)))
          const createdAtText = review?.createdAt ? new Date(review.createdAt).toLocaleString() : 'N/A'
          const subject = String(review?.subject || '').trim()
          const message = String(review?.message || '').trim()
          return (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Review Details - {reviewDetailsOrder.orderNumber}</DialogTitle>
                <DialogDescription>Submitted review details</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="rounded-md border bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">Rating</p>
                  <p className="font-semibold text-slate-900">
                    {'★'.repeat(stars)}{'☆'.repeat(Math.max(5 - stars, 0))} ({stars}/5)
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Submitted: {createdAtText}</p>
                </div>
                <div className="rounded-md border bg-white px-3 py-2">
                  <p className="text-xs text-slate-500">Your Feedback</p>
                  {subject ? <p className="font-medium text-slate-900">{subject}</p> : null}
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">{message || 'No feedback message'}</p>
                </div>
              </div>
            </DialogContent>
          )
        })() : null}
      </Dialog>

      <AlertDialog
        open={Boolean(pendingCancelOrder)}
        onOpenChange={(open) => {
          if (!open) setPendingCancelOrder(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Order?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to cancel {pendingCancelOrder?.orderNumber || 'this order'}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancellingOrder}>Keep Order</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmCancelOrder()
              }}
              className="bg-red-600 hover:bg-red-700"
              disabled={isCancellingOrder}
            >
              {isCancellingOrder ? 'Cancelling...' : 'Yes, Cancel Order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isOrderConfirmationOpen} onOpenChange={setIsOrderConfirmationOpen}>
        <DialogContent className="w-[92vw] max-w-[360px] rounded-2xl border border-emerald-100 bg-white p-4 shadow-xl md:max-w-sm md:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-emerald-700">Order Placed Successfully</DialogTitle>
            <DialogDescription className="text-sm text-slate-600">
              {lastPlacedOrderNumber
                ? `Your order ${lastPlacedOrderNumber} has been submitted and is now being processed.`
                : 'Your order has been submitted and is now being processed.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button className="h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => setIsOrderConfirmationOpen(false)}>
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter Orders</DialogTitle>
            <DialogDescription>Refine the list by status and date range.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Status</label>
              <select
                value={orderFilterStatus}
                onChange={(event) => setOrderFilterStatus(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800"
                title="Order status filter"
              >
                <option value="ALL">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="PROCESSING">Processing</option>
                <option value="OUT_FOR_DELIVERY">Out for delivery</option>
                <option value="DELIVERED">Delivered</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Date from</label>
                <input
                  type="date"
                  value={orderFilterDateFrom}
                  onChange={(event) => setOrderFilterDateFrom(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Date to</label>
                <input
                  type="date"
                  value={orderFilterDateTo}
                  onChange={(event) => setOrderFilterDateTo(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setOrderFilterStatus('ALL')
                  setOrderFilterDateFrom('')
                  setOrderFilterDateTo('')
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-500"
                onClick={() => setIsFilterDialogOpen(false)}
              >
                Apply
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      </div>
      </div>
    </div>
  )
}
