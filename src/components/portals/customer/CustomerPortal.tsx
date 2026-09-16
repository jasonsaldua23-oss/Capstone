'use client'

import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NativeOfflineNotice } from '@/components/shared/native-offline-notice'
import { useAuth } from '@/app/page'
import { clearTabAuthToken } from '@/lib/client-auth'
import { subscribeDataSync } from '@/lib/data-sync'
import { toast } from 'sonner'
import { CustomerProfileView } from './sections/profile/profile-view'
import { CustomerFeedbackView } from './sections/feedback/feedback-view'
import { CustomerHomeView } from './sections/home/home-view'
import { CustomerCartView } from './sections/cart/cart-view'
import { MixedCaseBuilderDialog } from './sections/cart/mixed-case-builder-dialog'
import { CustomerCheckoutView, type DepositRefundLine } from './sections/checkout/checkout-view'
import { CustomerOrdersView } from './sections/orders/orders-view'
import { CustomerOrderDetailPage } from './sections/orders/order-detail-page'
import { CustomerPurchaseRequestView } from './sections/purchase-requests/purchase-request-view'
import { CustomerPurchaseRequestDetailPage } from './sections/purchase-requests/purchase-request-detail-page'
import { CustomerTrackView } from './sections/track/track-view'
import { CustomerProfileDialog } from './sections/profile/profile-dialog'
import { CustomerAvatarCropDialog } from './sections/profile/avatar-crop-dialog'
import { CustomerAddressDialog } from './sections/checkout/address-dialog'
import { CustomerEditAddressPage } from './sections/profile/edit-address-page'
import { CustomerReceiptDialog } from './sections/orders/receipt-dialog'
import { CustomerRatingDialog } from './sections/orders/rating-dialog'
import { CustomerPortalHeader } from './sections/layout/portal-header'
import { CustomerBottomNav } from './sections/layout/bottom-nav'
import { useCustomerPortalState } from './sections/layout/portal-state'
import { PullToRefresh } from '../shared/pull-to-refresh'
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
  buildOrderActionReason,
  CUSTOMER_ORDER_REASONS,
  OrderReasonCheckboxes,
} from '@/components/portals/shared/order-reason-checkboxes'
import { fetchAllCustomerOrders, fetchCustomerTracking, fetchReplacementsMeta, fetchLegacyCustomerReplacements } from './sections/orders/orders-api'
import { fetchCustomerProducts } from './sections/shared/products-api'
import { fetchFeedbackMeta } from './sections/feedback/feedback-api'
import { formatPeso, getProductImage, getReplacementBadgeClass, getReplacementRank, getReplacementStatusLabel, parseReplacementMeta } from './sections/shared/customer-common'
import type { CustomerOrdersTab, DeliveryIssueRecord, DeliveryIssueSummary, DriverTrackingItem, Order, Product } from './sections/shared/customer-types'
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
import { useServiceArea } from '@/lib/service-area'
import { parseDateOnly } from './customer-portal-utils'
import { useCustomerCart } from './sections/cart/use-customer-cart'
import { useCustomerAddress } from './sections/address/use-customer-address'
import { useCustomerProfileAvatar } from './sections/profile/use-customer-profile-avatar'
import { useCustomerOrderActions } from './sections/orders/use-customer-order-actions'

const poppins = { className: '' }

export function CustomerPortal() {
  const { user, setUser, logout } = useAuth()
  const [pendingCancelOrder, setPendingCancelOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  const [selectedCancellationReasons, setSelectedCancellationReasons] = useState<string[]>([])
  const [otherCancellationReason, setOtherCancellationReason] = useState('')
  const [isCancellingOrder, setIsCancellingOrder] = useState(false)
  const [pendingCancelReplacement, setPendingCancelReplacement] = useState<{
    id: string
    replacementNumber: string
  } | null>(null)
  const [isCancellingReplacement, setIsCancellingReplacement] = useState(false)
  const [isOrderConfirmationOpen, setIsOrderConfirmationOpen] = useState(false)
  const [lastPlacedOrderNumber, setLastPlacedOrderNumber] = useState('')
  const [reviewByOrderId, setReviewByOrderId] = useState<Record<string, any>>({})
  const [customerDiscountOption, setCustomerDiscountOption] = useState('NO_DISCOUNT')
  const [customerDiscountStatus, setCustomerDiscountStatus] = useState('REMOVED')
  const [customerDiscountPercent, setCustomerDiscountPercent] = useState(0)
  const [customerDiscountAmountPerCase, setCustomerDiscountAmountPerCase] = useState(0)
  // Added: keep the exact product empties promised for collection with this order.
  const [depositRefundLines, setDepositRefundLines] = useState<DepositRefundLine[]>([])
  const [productCategoryFilter, setProductCategoryFilter] = useState('ALL')
  const [reviewDetailsOrder, setReviewDetailsOrder] = useState<Order | null>(null)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [orderFilterStatus, setOrderFilterStatus] = useState('ALL')
  const [orderFilterDateFrom, setOrderFilterDateFrom] = useState('')
  const [orderFilterDateTo, setOrderFilterDateTo] = useState('')
  const [backView, setBackView] = useState<string>('orders')
  const [backAddressView, setBackAddressView] = useState<string>('profile')
  const [headerUnreadCount, setHeaderUnreadCount] = useState(0)
  // Fix: the bell must refresh even before the notification/profile page mounts.
  useEffect(() => {
    let disposed = false
    const refreshUnread = async () => {
      try {
        const response = await fetch('/api/notifications', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json()
        if (!disposed) setHeaderUnreadCount(Number(payload.unreadCount) || 0)
      } catch { /* Preserve the last known count during a temporary outage. */ }
    }
    void refreshUnread()
    // A notification raised on any device reaches the badge as soon as it is stored.
    const unsubscribeUnread = subscribeDataSync(({ scopes }) => {
      if (scopes.includes('notifications')) void refreshUnread()
    })
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshUnread() }, 60000)
    window.addEventListener('focus', refreshUnread)
    return () => { disposed = true; unsubscribeUnread(); window.clearInterval(interval); window.removeEventListener('focus', refreshUnread) }
  }, [user?.id])
  const notifInitialSubViewRef = useRef<'real-notifications' | 'menu'>('menu')
  const [profileViewKey, setProfileViewKey] = useState(0)

  // Navigate to the full-page order detail from any view
  const openOrderDetail = (order: any, fromView = 'orders') => {
    setSelectedOrder(order)
    setBackView(fromView)
    setActiveView('order-detail')
  }

  const openPRDetail = (order: any) => {
    setSelectedOrder(order)
    setBackView('purchase-requests')
    setActiveView('purchase-request-detail')
  }

  const openEditAddressPage = (fromView = activeView) => {
    setIsAddressDialogOpen(false)
    setBackAddressView(fromView !== 'edit-address' ? fromView : 'profile')
    setActiveView('edit-address')
  }

  const handleSetIsAddressDialogOpen = (open: boolean) => {
    if (open) {
      openEditAddressPage()
    } else {
      setIsAddressDialogOpen(false)
    }
  }
  const { isInServiceArea } = useServiceArea()
  const checkoutRequestRef = useRef<{ payloadKey: string; requestId: string } | null>(null)
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
    isMixedCaseBuilderOpen,
    setIsMixedCaseBuilderOpen,
    editingMixedCase,
    setEditingMixedCase,
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
    profileFirstName,
    setProfileFirstName,
    profileMiddleName,
    setProfileMiddleName,
    profileLastName,
    setProfileLastName,
    profileSuffix,
    setProfileSuffix,
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

  const {
    composedShippingAddress,
    handleOutsideServiceArea,
    handlePinnedLocation,
    loadCustomerProfile,
    saveAddressToProfile,
    searchAddressInNegrosOccidental,
    useCurrentLocation,
  } = useCustomerAddress({
    activeView,
    addressSearch,
    customerId,
    isAddressDialogOpen,
    isInServiceArea,
    isResolvingPinnedAddress,
    profileFirstName,
    profileLastName,
    profileMiddleName,
    profileSuffix,
    setAddressSearchResults,
    setCustomerDiscountAmountPerCase,
    setCustomerDiscountOption,
    setCustomerDiscountPercent,
    setCustomerDiscountStatus,
    setIsResolvingPinnedAddress,
    setIsSavingAddress,
    setIsSearchingAddress,
    setProfileAvatar,
    setProfileAvatarFile,
    setProfileEmail,
    setProfileFirstName,
    setProfileLastName,
    setProfileMiddleName,
    setProfileName,
    setProfilePhone,
    setProfileSuffix,
    setShippingBarangay,
    setShippingCity,
    setShippingCountry,
    setShippingHouseNumber,
    setShippingLatitude,
    setShippingLongitude,
    setShippingPhone,
    setShippingProvince,
    setShippingStreetName,
    setShippingSubdivision,
    setShippingZipCode,
    shippingBarangay,
    shippingCity,
    shippingCountry,
    shippingHouseNumber,
    shippingLatitude,
    shippingLongitude,
    shippingName,
    shippingPhone,
    shippingProvince,
    shippingStreetName,
    shippingSubdivision,
    shippingZipCode,
  })
  useEffect(() => {
    setShippingName(user?.name || '')
    setProfileName(user?.name || '')
    setProfileFirstName(String((user as any)?.firstName || '').trim())
    setProfileMiddleName(String((user as any)?.middleName || '').trim())
    setProfileLastName(String((user as any)?.lastName || '').trim())
    setProfileSuffix(String((user as any)?.suffix || '').trim())
    setProfileEmail(user?.email || '')
    setProfileAvatar((user as any)?.avatar ? String((user as any).avatar) : null)
  }, [user])

  const fetchOrders = useCallback(async (silent = false) => {
    try {
      const requestOrders = () => fetchAllCustomerOrders(100)

      let { response, data } = await requestOrders()

      if (response?.status === 401 || response?.status === 403) {
        clearTabAuthToken()
          ; ({ response, data } = await requestOrders())
      }

      if (!response?.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to fetch orders')
      }
      const freshOrders = Array.isArray(data?.orders) ? data.orders : []
      setOrders(freshOrders)
      setSelectedOrder((prev: any) => {
        if (!prev) return null
        const fresh = freshOrders.find((o: any) => o.id === prev.id)
        return fresh ? { ...prev, ...fresh } : prev
      })
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

  const fetchProducts = useCallback(async (silent = false): Promise<Product[] | null> => {
    // Background stock refreshes must not replace the catalog with a loading state.
    if (!silent) setIsProductsLoading(true)
    try {
      const { response, data: payload } = await fetchCustomerProducts()
      if (!response?.ok) throw new Error('Failed to fetch products')
      const sourceProducts: Product[] = Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload?.data)
          ? payload.data
          : []
      // Out-of-stock products stay in the catalog: the storefront shows them last
      // with a Sold Out label rather than hiding what the warehouse still carries.
      const visibleProducts = sourceProducts.filter((p) => (p as any)?.isActive !== false)
      setProducts(visibleProducts)
      return visibleProducts
    } catch (error) {
      console.warn('Failed to load products:', error)
      return null
    } finally {
      if (!silent) setIsProductsLoading(false)
    }
  }, [setIsProductsLoading, setProducts])

  const handlePortalPullRefresh = useCallback(async () => {
    await Promise.allSettled([
      fetchOrders(true),
      fetchProducts(),
      fetchOrderMeta(),
      loadCustomerProfile(true),
    ])
  }, [fetchOrders, fetchProducts, fetchOrderMeta, loadCustomerProfile])

  useEffect(() => {
    fetchOrders()
    fetchProducts()
    fetchOrderMeta()
  }, [fetchOrderMeta, fetchOrders, fetchProducts])

  useEffect(() => {
    const refreshOrders = async (includeMeta = false) => {
      if (isRefreshingOrdersRef.current) return
      isRefreshingOrdersRef.current = true
      try {
        await fetchOrders(true)
        if (includeMeta) {
          await fetchOrderMeta()
        }
      } catch (error: any) {
        console.warn('Failed to load orders:', error)
      } finally {
        isRefreshingOrdersRef.current = false
      }
    }

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes || []
      const shouldRefreshTrack = activeView === 'track' && !isSelectedTrackingOrderDelivered
      const shouldRefreshOrdersView = [
        'orders',
        'purchase-requests',
        'purchase-request-detail',
        'order-detail',
      ].includes(activeView)
      if (
        (scopes.includes('orders') || scopes.includes('trips') || scopes.includes('replacements')) &&
        (shouldRefreshOrdersView || shouldRefreshTrack)
      ) {
        void refreshOrders(true)
      }
      // Reservations and order cancellations can change sellable stock without a product edit.
      if (scopes.some((scope) => ['inventory', 'products', 'stock-batches', 'orders'].includes(scope))) {
        void fetchProducts()
      }
      if (scopes.some((scope) => ['customers', 'auth', 'user', 'orders'].includes(scope))) {
        void (async () => {
          try {
            const authMeRes = await fetch('/api/auth/me', { cache: 'no-store' })
            const authMeData = await authMeRes.json().catch(() => ({}))
            if (authMeRes.ok && authMeData?.user) {
              setUser(authMeData.user)
            }
          } catch {}
        })()
      }
    })

    const onFocus = () => {
      // Recheck catalog and mixed-case availability when returning from another portal/tab.
      void fetchProducts()
      if (
        ['orders', 'purchase-requests', 'purchase-request-detail', 'order-detail'].includes(activeView) ||
        (activeView === 'track' && !isSelectedTrackingOrderDelivered)
      ) {
        refreshOrders(true)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void fetchProducts()
      if (
        document.visibilityState === 'visible' &&
        (['orders', 'purchase-requests', 'purchase-request-detail', 'order-detail'].includes(activeView) ||
          (activeView === 'track' && !isSelectedTrackingOrderDelivered))
      ) {
        refreshOrders(true)
      }
    }

    // Cross-device changes now arrive as sync events (see lib/sync-hub.ts), which
    // is both faster and far cheaper than re-fetching orders and the whole catalog
    // on a 2-4s timer. This slow sweep only covers a stamp endpoint that is down.
    const fallbackSweepInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void fetchProducts(true)
      if (['orders', 'purchase-requests', 'purchase-request-detail', 'order-detail', 'track'].includes(activeView)) {
        void refreshOrders(true)
      }
    }, 60000)

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      clearInterval(fallbackSweepInterval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeView, fetchOrderMeta, fetchOrders, fetchProducts, isSelectedTrackingOrderDelivered])

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
      // 'tracking' is the driver's position moving; the other two are the delivery
      // around it changing. Both belong on this screen while it is open.
      if (scopes.includes('orders') || scopes.includes('trips') || scopes.includes('tracking')) {
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

  // Returns the stock a cart line is limited to, or null when the line carries
  // no availability figure at all (the server stays the final authority there).
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

  const isReplacementOrder = (order: any): boolean =>
    String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(order?.isScheduledReplacement)

  const isApprovedPurchaseOrder = (order: any): boolean => {
    if (isReplacementOrder(order)) return true
    const reqStatus = String(order?.requestStatus || order?.approvalStatus || '').trim().toUpperCase()
    // Existing cancelled POs can retain a cancelled request status; their PO identity survives.
    return Boolean(order?.purchaseOrderNumber) || reqStatus === 'APPROVED'
  }

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Unapproved purchase requests remain in Purchase Request navigation
      if (!isApprovedPurchaseOrder(order)) return false

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
      const itemNames = (order.items || []).map((item) => [
        item.itemType === 'MIXED_CASE' ? 'Mixed Case' : item.product?.name || '',
        ...(item.components || []).flatMap((component) => [component.productName, component.productSku || '']),
      ].join(' ')).join(' ')
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

  const downloadReceipt = downloadOrderReceipt

  const {
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
  } = useCustomerCart({
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
  })

  const {
    confirmCancelOrder,
    confirmCancelReplacement,
    openRatingDialog,
    openTrackView,
    requestCancelOrder,
    requestCancelReplacement,
    submitRating,
    submitReplacementRequest,
  } = useCustomerOrderActions({
    deliveryRatingValue,
    fetchOrderMeta,
    notes,
    orders,
    otherCancellationReason,
    pendingCancelOrder,
    pendingCancelReplacement,
    ratingDialogOrder,
    reviewedOrderIds,
    selectedCancellationReasons,
    selectedOrder,
    setActiveView,
    setDeliveryIssueRecords,
    setDeliveryRatingValue,
    setIsCancellingOrder,
    setIsCancellingReplacement,
    setIsSubmittingRating,
    setOrders,
    setOtherCancellationReason,
    setPendingCancelOrder,
    setPendingCancelReplacement,
    setRatingComment,
    setRatingDialogOrder,
    setReviewDetailsOrder,
    setReviewedOrderIds,
    setSelectedCancellationReasons,
    setSelectedOrder,
    setSelectedTrackingOrderId,
  })

  const {
    avatarPreviewUrl,
    createCroppedAvatarFile,
    handleAvatarUpload,
    handleCropPointerDown,
    handleCropPointerMove,
    handleCropPointerUp,
    openAvatarCropDialog,
    saveProfile,
  } = useCustomerProfileAvatar({
    activeView,
    avatarCropSource,
    avatarCropX,
    avatarCropY,
    avatarCropZoom,
    backAddressView,
    backView,
    cropDragRef,
    customerId,
    loadCustomerProfile,
    profileAvatar,
    profileAvatarFile,
    profileEmail,
    profileFirstName,
    profileLastName,
    profileMiddleName,
    profilePhone,
    profileSuffix,
    setActiveView,
    setAvatarCropFile,
    setAvatarCropSource,
    setAvatarCropX,
    setAvatarCropY,
    setAvatarCropZoom,
    setIsAvatarCropDialogOpen,
    setIsDraggingCrop,
    setIsSavingProfile,
    setProfileAvatar,
    setProfileAvatarFile,
    setProfileEmail,
    setProfileFirstName,
    setProfileLastName,
    setProfileMiddleName,
    setProfileName,
    setProfilePhone,
    setProfileSuffix,
    setSelectedOrder,
    setShippingName,
    setShippingPhone,
    setUser,
    user,
  })

  return (
    // Fix: use the live viewport height and allow the content beside navigation to shrink.
    <div className={`${poppins.className} responsive-workspace h-[100dvh] overflow-hidden bg-[#eef2f7]`}>
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-transparent md:max-w-none md:rounded-none md:border-0 md:shadow-none">
        <div className="relative z-[1] flex h-full min-h-0 flex-col">
          <CustomerPortalHeader
            activeView={activeView}
            setActiveView={setActiveView}
            cartCount={cartCount}
            avatarPreviewUrl={avatarPreviewUrl}
            profileName={profileName}
            user={user}
            setIsAddressDialogOpen={handleSetIsAddressDialogOpen}
            handleLogout={handleLogout}
            onOpenNotifications={() => {
              notifInitialSubViewRef.current = 'real-notifications'
              setProfileViewKey((k) => k + 1)
              setActiveView('profile')
            }}
            unreadCount={headerUnreadCount}
          />

          <NativeOfflineNotice />
          <div className="flex min-h-0 flex-1">
            <CustomerBottomNav activeView={activeView} setActiveView={setActiveView} setSelectedOrder={setSelectedOrder} />
            <PullToRefresh
              onRefresh={() => window.location.reload()}
              className="flex-1 min-h-0 min-w-0 w-full"
            >
            <AnimatePresence mode="wait" initial={false}>
              <motion.main
                key={activeView}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="flex-1 min-h-0 min-w-0 w-full space-y-4 px-2 pb-24 pt-0 sm:px-3 md:px-6 md:pb-8 md:pt-2"
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
                    onOpenMixedCase={() => openMixedCaseBuilder()}
                  />
                )}

                {activeView === 'cart' && (
                  <CustomerCartView
                    setActiveView={setActiveView}
                    cart={cart}
                    setIsAddressDialogOpen={handleSetIsAddressDialogOpen}
                    shippingBarangay={shippingBarangay}
                    shippingCity={shippingCity}
                    shippingProvince={shippingProvince}
                    selectedCartIds={selectedCartIds}
                    setSelectedCartIds={setSelectedCartIds}
                    getProductImage={getProductImage}
                    updateCartQty={updateCartQty}
                    removeFromCart={removeFromCart}
                    removeSelectedFromCart={removeSelectedFromCart}
                    getCartItemAvailable={getCartItemAvailable}
                    allCartSelected={allCartSelected}
                    selectedCount={selectedCount}
                    selectedSubtotal={selectedSubtotal}
                    formatPeso={formatPeso}
                    onEditMixedCase={(item) => openMixedCaseBuilder(item)}
                  />
                )}

                {activeView === 'checkout' && (
                  <CustomerCheckoutView
                    setActiveView={setActiveView}
                    selectedCartItems={selectedCartItems}
                    shippingName={shippingName}
                    setIsAddressDialogOpen={handleSetIsAddressDialogOpen}
                    shippingPhone={shippingPhone}
                    composedShippingAddress={composedShippingAddress}
                    getProductImage={getProductImage}
                    formatPeso={formatPeso}
                    selectedSubtotal={selectedSubtotal}
                    selectedDepositCharged={selectedDepositCharged}
                    selectedDepositRefunded={selectedDepositRefunded}
                    depositCreditAmount={depositCreditAmount}
                    depositRefundLines={depositRefundLines}
                    setDepositRefundLines={setDepositRefundLines}
                    depositRefundOptions={depositRefundOptions}
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
                    insufficientStockItems={insufficientStockItems}
                  />
                )}

                {activeView === 'purchase-requests' && (
                  <CustomerPurchaseRequestView
                    orders={orders}
                    isLoading={isLoading}
                    formatPeso={formatPeso}
                    getProductImage={getProductImage}
                    cancelOrder={requestCancelOrder}
                    isOrderCancellable={isOrderCancellable}
                    setActiveView={setActiveView}
                    setSelectedOrder={setSelectedOrder}
                    openPRDetail={openPRDetail}
                  />
                )}

                {activeView === 'purchase-request-detail' && selectedOrder && (
                  <CustomerPurchaseRequestDetailPage
                    order={selectedOrder}
                    onBack={() => {
                      setSelectedOrder(null)
                      setActiveView('purchase-requests')
                    }}
                    formatPeso={formatPeso}
                    getProductImage={getProductImage}
                    cancelOrder={requestCancelOrder}
                    isOrderCancellable={isOrderCancellable}
                    setActiveView={setActiveView}
                    setSelectedOrder={setSelectedOrder}
                  />
                )}

                {activeView === 'order-detail' && selectedOrder && (
                  <CustomerOrderDetailPage
                    order={selectedOrder}
                    onBack={() => {
                      setSelectedOrder(null)
                      setActiveView(backView)
                    }}
                    setIsReceiptDialogOpen={setIsReceiptDialogOpen}
                    setSelectedOrder={setSelectedOrder}
                    formatOrderStatus={formatOrderStatus}
                    orderStages={orderStages}
                    getOrderStageIndex={getOrderStageIndex}
                    getProductImage={getProductImage}
                    formatPeso={formatPeso}
                    deliveryIssueRecords={deliveryIssueRecords}
                    getReplacementStatusLabel={getReplacementStatusLabel}
                    getReplacementBadgeClass={getReplacementBadgeClass}
                    isOrderDelivered={isOrderDelivered}
                    isOrderTrackable={isOrderTrackable}
                    openTrackView={openTrackView}
                    buyAgainFromOrder={buyAgainFromOrder}
                    isOrderCancellable={isOrderCancellable}
                    cancelOrder={requestCancelOrder}
                    reviewedOrderIds={reviewedOrderIds}
                    openRatingDialog={openRatingDialog}
                    openReviewDetails={(order: Order) => setReviewDetailsOrder(order)}
                    submitReplacementRequest={submitReplacementRequest}
                    requestCancelReplacement={requestCancelReplacement}
                  />
                )}

                {activeView === 'edit-address' && (
                  <CustomerEditAddressPage
                    onBack={() => setActiveView(backAddressView)}
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
                    profileFirstName={profileFirstName}
                    setProfileFirstName={setProfileFirstName}
                    profileMiddleName={profileMiddleName}
                    setProfileMiddleName={setProfileMiddleName}
                    profileLastName={profileLastName}
                    setProfileLastName={setProfileLastName}
                    profileSuffix={profileSuffix}
                    setProfileSuffix={setProfileSuffix}
                    shippingPhone={shippingPhone}
                    setShippingPhone={setShippingPhone}
                    handlePinnedLocation={handlePinnedLocation}
                    handleOutsideServiceArea={handleOutsideServiceArea}
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
                    requestCancelReplacement={requestCancelReplacement}
                    openRatingDialog={openRatingDialog}
                    reviewByOrderId={reviewByOrderId}
                    openReviewDetails={(order: Order) => setReviewDetailsOrder(order)}
                    setSelectedOrder={setSelectedOrder}
                    openOrderDetail={(order: any) => openOrderDetail(order, 'orders')}
                    isOrderTrackable={isOrderTrackable}
                    openTrackView={openTrackView}
                    buyAgainFromOrder={buyAgainFromOrder}
                    getProductImage={getProductImage}
                    formatPeso={formatPeso}
                    openFilterDialog={() => setIsFilterDialogOpen(true)}
                    setIsReceiptDialogOpen={setIsReceiptDialogOpen}
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
                    key={profileViewKey}
                    avatarPreviewUrl={avatarPreviewUrl}
                    profileName={profileName}
                    setProfileName={setProfileName}
                    profileFirstName={profileFirstName}
                    setProfileFirstName={setProfileFirstName}
                    profileMiddleName={profileMiddleName}
                    setProfileMiddleName={setProfileMiddleName}
                    profileLastName={profileLastName}
                    setProfileLastName={setProfileLastName}
                    profileSuffix={profileSuffix}
                    setProfileSuffix={setProfileSuffix}
                    profileEmail={profileEmail}
                    setProfileEmail={setProfileEmail}
                    profilePhone={profilePhone}
                    setProfilePhone={setProfilePhone}
                    composedShippingAddress={composedShippingAddress}
                    shippingCity={shippingCity}
                    shippingProvince={shippingProvince}
                    shippingZipCode={shippingZipCode}
                    user={user}
                    isSavingProfile={isSavingProfile}
                    avatarInputRef={avatarInputRef}
                    openAvatarCropDialog={openAvatarCropDialog}
                    setIsProfileDialogOpen={setIsProfileDialogOpen}
                    setIsAddressDialogOpen={handleSetIsAddressDialogOpen}
                    onLogout={handleLogout}
                    saveProfile={saveProfile}
                    initialSubView={notifInitialSubViewRef.current}
                    onUnreadCountChange={(count) => setHeaderUnreadCount(count)}
                    onDidMount={() => { notifInitialSubViewRef.current = 'menu' }}
                    onUserUpdate={setUser}
                    onNavigateNotification={(n) => {
                      const refType = String(n?.referenceType || n?.reference_type || '').toLowerCase()
                      const refId = String(n?.referenceId || n?.reference_id || '').trim()
                      const notifType = String(n?.type || '').toUpperCase()
                      const title = String(n?.title || '').toLowerCase()
                      const message = String(n?.message || '').toLowerCase()

                      if (
                        title.includes('purchase request') ||
                        title.includes('request approved') ||
                        title.includes('request rejected') ||
                        refType === 'purchase_request' ||
                        (refType === 'order' && (title.includes('request') || message.includes('request')))
                      ) {
                        const matched = orders.find((o) => o.id === refId || o.purchaseRequestNumber === refId || o.orderNumber === refId)
                        if (matched) {
                          openPRDetail(matched)
                        } else {
                          setActiveView('purchase-requests')
                        }
                        return
                      }

                      if (refType === 'replacement' || notifType === 'REPLACEMENT' || title.includes('replacement') || message.includes('replacement')) {
                        // Try to find and open the specific replacement order
                        const matched = orders.find((o) => {
                          const isRepl = isReplacementOrder(o)
                          return isRepl && (o.id === refId || o.orderNumber === refId || String(o.orderNumber || '').includes(refId))
                        })
                        if (matched) {
                          openOrderDetail(matched, 'orders')
                        } else {
                          setOrdersTab('REPLACEMENT')
                          setActiveView('orders')
                        }
                        return
                      }

                      if (refType === 'order' || notifType === 'ORDER' || title.includes('order') || message.includes('order') || title.includes('delivery')) {
                        const matched = orders.find((o) => o.id === refId || o.orderNumber === refId || o.purchaseOrderNumber === refId)
                        if (matched) {
                          openOrderDetail(matched, 'profile')
                        } else {
                          setActiveView('orders')
                        }
                        return
                      }

                      if (refType === 'trip' || title.includes('out for delivery') || title.includes('driver')) {
                        setActiveView('track')
                        return
                      }

                      setActiveView('orders')
                    }}
                  />
                )}
              </motion.main>
            </AnimatePresence>
            </PullToRefresh>
          </div>

          <CustomerProfileDialog
            isProfileDialogOpen={isProfileDialogOpen}
            setIsProfileDialogOpen={setIsProfileDialogOpen}
            profileName={profileName}
            setProfileName={setProfileName}
            profileFirstName={profileFirstName}
            setProfileFirstName={setProfileFirstName}
            profileMiddleName={profileMiddleName}
            setProfileMiddleName={setProfileMiddleName}
            profileLastName={profileLastName}
            setProfileLastName={setProfileLastName}
            profileSuffix={profileSuffix}
            setProfileSuffix={setProfileSuffix}
            profileEmail={profileEmail}
            setProfileEmail={setProfileEmail}
            profilePhone={profilePhone}
            setProfilePhone={setProfilePhone}
            composedShippingAddress={composedShippingAddress}
            shippingCity={shippingCity}
            shippingProvince={shippingProvince}
            shippingZipCode={shippingZipCode}
            setIsAddressDialogOpen={handleSetIsAddressDialogOpen}
            saveProfile={saveProfile}
            isSavingProfile={isSavingProfile}
            avatarPreviewUrl={avatarPreviewUrl}
            user={user}
            avatarInputRef={avatarInputRef}
            openAvatarCropDialog={openAvatarCropDialog}
          />

          <MixedCaseBuilderDialog
            open={isMixedCaseBuilderOpen}
            onOpenChange={(open) => {
              setIsMixedCaseBuilderOpen(open)
              if (!open) setEditingMixedCase(null)
            }}
            products={products}
            editingItem={editingMixedCase}
            onSave={saveMixedCase}
            formatPeso={formatPeso}
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

          {activeView !== 'edit-address' && (
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
              profileFirstName={profileFirstName}
              setProfileFirstName={setProfileFirstName}
              profileMiddleName={profileMiddleName}
              setProfileMiddleName={setProfileMiddleName}
              profileLastName={profileLastName}
              setProfileLastName={setProfileLastName}
              profileSuffix={profileSuffix}
              setProfileSuffix={setProfileSuffix}
              shippingPhone={shippingPhone}
              setShippingPhone={setShippingPhone}
              addressSearch={addressSearch}
              isSearchingAddress={isSearchingAddress}
              searchAddressInNegrosOccidental={searchAddressInNegrosOccidental}
              addressSearchResults={addressSearchResults}
              handlePinnedLocation={handlePinnedLocation}
              handleOutsideServiceArea={handleOutsideServiceArea}
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
          )}

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
              if (!open) {
                setPendingCancelOrder(null)
                setSelectedCancellationReasons([])
                setOtherCancellationReason('')
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel Order?</AlertDialogTitle>
                <AlertDialogDescription>
                  You are about to cancel {pendingCancelOrder?.orderNumber || 'this order'}. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <OrderReasonCheckboxes
                options={CUSTOMER_ORDER_REASONS}
                selectedReasons={selectedCancellationReasons}
                otherReason={otherCancellationReason}
                onSelectedReasonsChange={setSelectedCancellationReasons}
                onOtherReasonChange={setOtherCancellationReason}
                label="Cancellation reason (required)"
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isCancellingOrder}>Keep Order</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault()
                    void confirmCancelOrder()
                  }}
                  className="bg-red-600 hover:bg-red-700"
                  disabled={isCancellingOrder || !buildOrderActionReason(selectedCancellationReasons, otherCancellationReason)}
                >
                  {isCancellingOrder ? 'Cancelling...' : 'Yes, Cancel Order'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={Boolean(pendingCancelReplacement)}
            onOpenChange={(open) => {
              if (!open && !isCancellingReplacement) setPendingCancelReplacement(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel Replacement Request?</AlertDialogTitle>
                <AlertDialogDescription>
                  You can cancel {pendingCancelReplacement?.replacementNumber || 'this replacement request'} only while it is still pending. Once it is under review, cancellation is no longer allowed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isCancellingReplacement}>Keep Request</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault()
                    void confirmCancelReplacement()
                  }}
                  className="bg-red-600 hover:bg-red-700"
                  disabled={isCancellingReplacement}
                >
                  {isCancellingReplacement ? 'Cancelling...' : 'Yes, Cancel Replacement'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog open={isOrderConfirmationOpen} onOpenChange={setIsOrderConfirmationOpen}>
            <DialogContent className="w-[92vw] max-w-[360px] rounded-2xl border border-emerald-100 bg-white p-4 shadow-xl md:max-w-sm md:p-6">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-emerald-700">Purchase Request Submitted</DialogTitle>
                <DialogDescription className="text-sm text-slate-600">
                  {lastPlacedOrderNumber
                    ? `Your purchase request ${lastPlacedOrderNumber} has been submitted and is currently pending review by warehouse staff.`
                    : 'Your purchase request has been submitted and is currently pending review by warehouse staff.'}
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
