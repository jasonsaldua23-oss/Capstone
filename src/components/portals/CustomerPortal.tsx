'use client'

import { useState, useEffect, useMemo, useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/app/page'
import { clearTabAuthToken } from '@/lib/client-auth'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Package,
  MapPin,
  User,
  LogOut,
  Truck,
  MessageSquare,
  CheckCircle,
  Clock,
  Search,
  Loader2,
  Home,
  Settings,
  Phone,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  LocateFixed,
  ArrowLeft,
  ChevronRight,
  Camera,
  Star,
  Download,
  FileText,
} from 'lucide-react'

interface Order {
  id: string
  orderNumber: string
  status: string
  paymentStatus?: string | null
  paymentMethod?: string | null
  shippingName?: string | null
  shippingPhone?: string | null
  shippingState?: string | null
  shippingZipCode?: string | null
  shippingCountry?: string | null
  subtotal?: number | null
  tax?: number | null
  shippingCost?: number | null
  discount?: number | null
  totalAmount: number
  createdAt: string
  deliveryDate?: string | null
  deliveredAt: string | null
  shippingLatitude?: number | null
  shippingLongitude?: number | null
  shippingAddress: string
  shippingCity: string
  items: OrderItem[]
}

interface OrderItem {
  id: string
  product: {
    name: string
    sku: string
    imageUrl?: string | null
  }
  quantity: number
  unitPrice: number
  totalPrice?: number | null
}

interface Product {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  unit: string
  price: number
  inventory?: Array<{
    quantity: number
    reservedQuantity: number
  }>
}

interface CartItem {
  productId: string
  name: string
  sku: string
  imageUrl?: string | null
  unit: string
  unitPrice: number
  quantity: number
  available: number
}

type PaymentMethod = 'COD' | 'GCASH' | 'MAYA' | 'BANK_TRANSFER'
type CustomerOrdersTab = 'ALL' | 'TO_PAY' | 'TO_SHIP' | 'TO_RECEIVE' | 'TO_REVIEW' | 'REPLACEMENT' | 'DELIVERED'
interface DriverTrackingItem {
  orderId: string
  orderNumber: string
  status: string
  tripNumber: string | null
  driverName: string | null
  driverPhone: string | null
  latitude: number | null
  longitude: number | null
  source: 'driver_gps' | 'trip_stop' | 'shipping_address' | 'unavailable'
  updatedAt: string | null
  recipientName?: string | null
  deliveryPhoto?: string | null
  deliveredMessage?: string | null
  routePoints?: Array<{
    latitude: number
    longitude: number
    recordedAt: string
  }>
}

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)
const DriverRouteMap = dynamic(
  () => import('@/components/maps/DriverRouteMap').then((mod) => mod.DriverRouteMap),
  { ssr: false }
)

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatPeso = (value: number) => {
  return pesoFormatter.format(Number(value || 0))
}

const formatPdfMoney = (value: number) => {
  const amount = Number(value || 0)
  return `PHP ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const createPdfBlob = (bytes: Uint8Array): Blob => {
  // Ensure BlobPart receives a true ArrayBuffer (not SharedArrayBuffer-like)
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return new Blob([arrayBuffer], { type: 'application/pdf' })
}

export function CustomerPortal() {
  const { user, setUser, logout } = useAuth()
  const [activeView, setActiveView] = useState('home')
  const [orders, setOrders] = useState<Order[]>([])
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [products, setProducts] = useState<Product[]>([])
  const [isProductsLoading, setIsProductsLoading] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedCartIds, setSelectedCartIds] = useState<Set<string>>(new Set())
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)

  const [shippingName, setShippingName] = useState(user?.name || '')
  const [shippingPhone, setShippingPhone] = useState('')
  const [shippingHouseNumber, setShippingHouseNumber] = useState('')
  const [shippingStreetName, setShippingStreetName] = useState('')
  const [shippingSubdivision, setShippingSubdivision] = useState('')
  const [shippingBarangay, setShippingBarangay] = useState('')
  const [shippingCity, setShippingCity] = useState('')
  const [shippingState, setShippingState] = useState('Negros Occidental')
  const [shippingZipCode, setShippingZipCode] = useState('')
  const [shippingCountry, setShippingCountry] = useState('Philippines')
  const [shippingLatitude, setShippingLatitude] = useState<number | null>(null)
  const [shippingLongitude, setShippingLongitude] = useState<number | null>(null)

  const [secondaryShippingName, setSecondaryShippingName] = useState('')
  const [secondaryShippingPhone, setSecondaryShippingPhone] = useState('')
  const [secondaryShippingHouseNumber, setSecondaryShippingHouseNumber] = useState('')
  const [secondaryShippingStreetName, setSecondaryShippingStreetName] = useState('')
  const [secondaryShippingSubdivision, setSecondaryShippingSubdivision] = useState('')
  const [secondaryShippingBarangay, setSecondaryShippingBarangay] = useState('')
  const [secondaryShippingCity, setSecondaryShippingCity] = useState('')
  const [secondaryShippingState, setSecondaryShippingState] = useState('Negros Occidental')
  const [secondaryShippingZipCode, setSecondaryShippingZipCode] = useState('')
  const [secondaryShippingCountry, setSecondaryShippingCountry] = useState('Philippines')
  const [secondaryShippingLatitude, setSecondaryShippingLatitude] = useState<number | null>(null)
  const [secondaryShippingLongitude, setSecondaryShippingLongitude] = useState<number | null>(null)

  const [selectedDeliveryAddress, setSelectedDeliveryAddress] = useState<'primary' | 'secondary'>('primary')
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false)
  const [isResolvingPinnedAddress, setIsResolvingPinnedAddress] = useState(false)
  const [addressSearch, setAddressSearch] = useState('')
  const [isSearchingAddress, setIsSearchingAddress] = useState(false)
  const [addressSearchResults, setAddressSearchResults] = useState<
    Array<{ displayName: string; latitude: number; longitude: number }>
  >([])
  const [notes, setNotes] = useState('')
  const [deliveryDate, setDeliveryDate] = useState<string>('')
  const [ordersSearch, setOrdersSearch] = useState('')
  const [ordersTab, setOrdersTab] = useState<CustomerOrdersTab>('ALL')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD')
  const [isSavingAddress, setIsSavingAddress] = useState(false)
  const [trackingByOrderId, setTrackingByOrderId] = useState<Record<string, DriverTrackingItem>>({})
  const [isTrackingLoading, setIsTrackingLoading] = useState(false)
  const [selectedTrackingOrderId, setSelectedTrackingOrderId] = useState<string | null>(null)
  const [reviewedOrderIds, setReviewedOrderIds] = useState<Set<string>>(new Set())
  const [orderRatings, setOrderRatings] = useState<Record<string, number>>({})
  const [replacementOrderIds, setReplacementOrderIds] = useState<Set<string>>(new Set())
  const [ratingDialogOrder, setRatingDialogOrder] = useState<Order | null>(null)
  const [ratingValue, setRatingValue] = useState(5)
  const [ratingMessage, setRatingMessage] = useState('')
  const [isSubmittingRating, setIsSubmittingRating] = useState(false)
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [isAvatarCropDialogOpen, setIsAvatarCropDialogOpen] = useState(false)
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null)
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null)
  const [avatarCropZoom, setAvatarCropZoom] = useState(1)
  const [avatarCropX, setAvatarCropX] = useState(0)
  const [avatarCropY, setAvatarCropY] = useState(0)
  const [isDraggingCrop, setIsDraggingCrop] = useState(false)
  const cropDragRef = useRef<{
    active: boolean
    startX: number
    startY: number
    initialX: number
    initialY: number
  }>({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 })

  const customerId = (user as any)?.userId || (user as any)?.id || ''

  useEffect(() => {
    setIsReceiptDialogOpen(false)
  }, [selectedOrder?.id])

  const hydrateAddressFromProfile = (customer: any) => {
    const rawAddress = String(customer?.address || '').trim()
    const city = String(customer?.city || '').trim()
    const state = String(customer?.state || '').trim() || 'Negros Occidental'
    const zipCode = String(customer?.zipCode || '').trim()

    const parts = rawAddress
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    let houseNumber = ''
    let streetName = ''
    let subdivision = ''
    let barangay = ''

    if (parts.length >= 4) {
      houseNumber = parts[0] || ''
      streetName = parts[1] || ''
      subdivision = parts[2] || ''
      barangay = parts[3] || ''
    } else if (parts.length >= 2) {
      streetName = parts[0] || ''
      barangay = parts[1] || ''
    } else if (parts.length === 1) {
      streetName = parts[0] || ''
    }

    setShippingPhone(String(customer?.phone || '').trim())
    setShippingHouseNumber(houseNumber)
    setShippingStreetName(streetName)
    setShippingSubdivision(subdivision)
    setShippingBarangay(barangay)
    setShippingCity(city)
    setShippingState(state)
    setShippingZipCode(zipCode)
    setShippingCountry('Philippines')
    setShippingLatitude(typeof customer?.latitude === 'number' ? customer.latitude : null)
    setShippingLongitude(typeof customer?.longitude === 'number' ? customer.longitude : null)
    setProfileName(String(customer?.name || '').trim())
    setProfileEmail(String(customer?.email || '').trim())
    setProfilePhone(String(customer?.phone || '').trim())
    setProfileAvatar(customer?.avatar ? String(customer.avatar) : null)
    setProfileAvatarFile(null)
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
      const response = await fetch(`/api/customers/${customerId}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Failed to load customer profile')
      const payload = await response.json().catch(() => ({}))
      const customer = payload?.data
      if (!customer) throw new Error('Customer profile is missing')
      hydrateAddressFromProfile(customer)
    } catch (error: any) {
      if (!silent) {
        toast.error(error?.message || 'Failed to load customer profile')
      }
    }
  }, [customerId])

  useEffect(() => {
    loadCustomerProfile()
  }, [loadCustomerProfile])

  const fetchOrders = useCallback(async (silent = false) => {
    try {
      const requestOrders = () => fetch('/api/customer/orders', { cache: 'no-store', credentials: 'include' })

      let response = await requestOrders()
      let data = await response.json().catch(() => ({}))

      if (response.status === 401 || response.status === 403) {
        clearTabAuthToken()
        response = await requestOrders()
        data = await response.json().catch(() => ({}))
      }

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to fetch orders')
      }
      setOrders(data.orders || [])
    } catch (error: any) {
      setOrders([])
      if (!silent) {
        toast.error(error?.message || 'Failed to load orders')
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchOrderMeta = useCallback(async () => {
    try {
      const [feedbackResponse, replacementResponse] = await Promise.all([
        fetch('/api/feedback?page=1&limit=500', { cache: 'no-store' }),
        fetch('/api/customer/replacements', { cache: 'no-store' }),
      ])

      if (feedbackResponse.ok) {
        const feedbackPayload = await feedbackResponse.json().catch(() => ({}))
        const feedbacks = Array.isArray(feedbackPayload?.feedbacks) ? feedbackPayload.feedbacks : []
        const reviewed = new Set<string>()
        const ratingsByOrder: Record<string, number> = {}
        for (const item of feedbacks) {
          const orderId = String(item?.orderId || item?.order?.id || '').trim()
          if (!orderId) continue
          reviewed.add(orderId)
          const rawRating = Number(item?.rating)
          if (Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 5) {
            ratingsByOrder[orderId] = Math.round(rawRating)
          }
        }
        setReviewedOrderIds(reviewed)
        setOrderRatings(ratingsByOrder)
      } else {
        setReviewedOrderIds(new Set())
        setOrderRatings({})
      }

      if (replacementResponse.ok) {
        const replacementPayload = await replacementResponse.json().catch(() => ({}))
        const replacements = Array.isArray(replacementPayload?.replacements) ? replacementPayload.replacements : []
        const replacementOrders = new Set<string>()
        for (const item of replacements) {
          const orderId = String(item?.orderId || '').trim()
          if (orderId) replacementOrders.add(orderId)
        }
        setReplacementOrderIds(replacementOrders)
      } else {
        setReplacementOrderIds(new Set())
      }
    } catch {
      setReviewedOrderIds(new Set())
      setOrderRatings({})
      setReplacementOrderIds(new Set())
    }
  }, [])

  const fetchProducts = async () => {
    setIsProductsLoading(true)
    try {
      const response = await fetch('/api/products?page=1&pageSize=100')
      if (!response.ok) throw new Error('Failed to fetch products')
      const payload = await response.json()
      const sourceProducts: Product[] = payload?.data || []
      setProducts(
        sourceProducts.filter((p) => {
          const available = (p.inventory || []).reduce((sum, inv) => sum + Math.max(0, inv.quantity - inv.reservedQuantity), 0)
          return available > 0
        })
      )
    } catch {
      toast.error('Failed to load products')
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
    const refreshOrders = () => {
      void fetchOrders(true)
      void fetchOrderMeta()
    }

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes || []
      if (scopes.includes('orders') || scopes.includes('trips') || scopes.includes('returns')) {
        refreshOrders()
      }
    })

    const onFocus = () => {
      if (activeView === 'orders' || activeView === 'track') {
        refreshOrders()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && (activeView === 'orders' || activeView === 'track')) {
        refreshOrders()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && (activeView === 'orders' || activeView === 'track')) {
        refreshOrders()
      }
    }, 10000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [activeView, fetchOrderMeta, fetchOrders])

  useEffect(() => {
    if (activeView !== 'track') return

    let mounted = true

    const fetchTracking = async () => {
      setIsTrackingLoading(true)
      try {
        const response = await fetch('/api/customer/tracking')
        if (!response.ok) throw new Error('Failed to load tracking')
        const data = await response.json()
        const list: DriverTrackingItem[] = data?.tracking || []
        if (!mounted) return
        const byOrderId = list.reduce<Record<string, DriverTrackingItem>>((acc, item) => {
          acc[item.orderId] = item
          return acc
        }, {})
        setTrackingByOrderId(byOrderId)
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

    fetchTracking()
    const interval = setInterval(fetchTracking, 15000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [activeView])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
  }

  const getAvailableQty = (product: Product) =>
    (product.inventory || []).reduce((sum, inv) => sum + Math.max(0, inv.quantity - inv.reservedQuantity), 0)

  const addToCart = (product: Product) => {
    const available = getAvailableQty(product)
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
            unitPrice: product.price,
            quantity: 1,
            available,
          },
        ]
      }
      if (existing.quantity >= available) return prev
      return prev.map((i) =>
        i.productId === product.id ? { ...i, quantity: i.quantity + 1, available, imageUrl: i.imageUrl || product.imageUrl || null } : i
      )
    })
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
  const selectedCount = useMemo(() => selectedCartItems.length, [selectedCartItems])
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

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase().trim()
    if (!q) return products
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
  }, [products, productSearch])

  const composedShippingAddress = useMemo(() => {
    return [
      shippingHouseNumber,
      shippingStreetName,
      shippingSubdivision,
      shippingBarangay,
      shippingCity,
      shippingState || 'Negros Occidental',
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
    shippingState,
    shippingZipCode,
  ])

  const filteredOrders = useMemo(() => orders, [orders])

  const sortedFilteredOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      const aTime = a.deliveryDate ? new Date(a.deliveryDate).getTime() : new Date(a.createdAt).getTime()
      const bTime = b.deliveryDate ? new Date(b.deliveryDate).getTime() : new Date(b.createdAt).getTime()
      return bTime - aTime
    })
  }, [filteredOrders])

  const ordersTabOptions: Array<{ id: CustomerOrdersTab; label: string }> = [
    { id: 'ALL', label: 'All' },
    { id: 'TO_PAY', label: 'To Pay' },
    { id: 'TO_SHIP', label: 'To Ship' },
    { id: 'TO_RECEIVE', label: 'To Receive' },
    { id: 'DELIVERED', label: 'Delivered' },
    { id: 'TO_REVIEW', label: 'To Review' },
    { id: 'REPLACEMENT', label: 'Replacement' },
  ]

  const tabFilteredOrders = useMemo(() => {
    if (ordersTab === 'ALL') return sortedFilteredOrders

    return sortedFilteredOrders.filter((order) => {
      const raw = String(order.status || '').toUpperCase()
      const paymentStatus = String(order.paymentStatus || '').toLowerCase()
      const paymentMethod = String(order.paymentMethod || '').toUpperCase()
      const isCodToPay = paymentMethod === 'COD' && paymentStatus !== 'paid'

      if (ordersTab === 'TO_PAY') {
        return ['PENDING', 'CONFIRMED'].includes(raw) || isCodToPay || paymentStatus === 'pending_approval'
      }
      if (ordersTab === 'TO_SHIP') {
        return ['PROCESSING', 'PACKED', 'READY_FOR_PICKUP'].includes(raw) && paymentStatus !== 'pending_approval'
      }
      if (ordersTab === 'TO_RECEIVE') {
        return ['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(raw)
      }
      if (ordersTab === 'TO_REVIEW') {
        return raw === 'DELIVERED' && !reviewedOrderIds.has(order.id)
      }
      if (ordersTab === 'REPLACEMENT') {
        return replacementOrderIds.has(order.id)
      }
      if (ordersTab === 'DELIVERED') {
        return raw === 'DELIVERED'
      }

      return true
    })
  }, [sortedFilteredOrders, ordersTab, reviewedOrderIds, replacementOrderIds])

  const visibleOrders = useMemo(() => {
    const query = ordersSearch.trim().toLowerCase()
    if (!query) return tabFilteredOrders

    return tabFilteredOrders.filter((order) => {
      const itemNames = (order.items || []).map((item) => item.product?.name || '').join(' ')
      return (
        order.orderNumber.toLowerCase().includes(query) ||
        order.shippingAddress.toLowerCase().includes(query) ||
        itemNames.toLowerCase().includes(query)
      )
    })
  }, [tabFilteredOrders, ordersSearch])

  const placeOrder = async () => {
    if (
      !shippingName ||
      !shippingPhone ||
      !shippingStreetName ||
      !shippingBarangay ||
      !shippingCity ||
      !shippingState ||
      !shippingZipCode
    ) {
      toast.error('Please complete all detailed shipping fields')
      return
    }
    if (selectedCartItems.length === 0) {
      toast.error('Your cart is empty')
      return
    }

    setIsPlacingOrder(true)
    try {
      const response = await fetch('/api/customer/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingName,
          shippingPhone,
          shippingAddress: composedShippingAddress,
          shippingCity,
          shippingState,
          shippingZipCode,
          shippingCountry,
          shippingLatitude,
          shippingLongitude,
          paymentMethod,
          notes,
          deliveryDate: deliveryDate || null,
          items: selectedCartItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) throw new Error(data?.error || 'Failed')
      toast.success('Order placed successfully')
      if (data?.order) {
        setOrders((prev) => [data.order, ...prev])
      }
      const selectedIds = new Set(selectedCartItems.map((item) => item.productId))
      setCart((prev) => prev.filter((item) => !selectedIds.has(item.productId)))
      await fetchOrders()
      emitDataSync(['orders'])
      await fetchOrderMeta()
      setOrdersTab('ALL')
      setOrdersSearch('')
      setActiveView('orders')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to place order')
    } finally {
      setIsPlacingOrder(false)
    }
  }

  const orderStages = ['Pending', 'Processing', 'Loaded', 'Out for Delivery', 'Delivered']

  const normalizeDeliveryStatus = (status: string, paymentStatus?: string | null) => {
    if (String(paymentStatus || '').toLowerCase() === 'pending_approval') return 'PENDING'
    const raw = String(status || '').toUpperCase()
    if (raw === 'PENDING') return 'PENDING'
    if (raw === 'CONFIRMED') return 'PROCESSING'
    if (raw === 'READY_FOR_PICKUP') return 'PACKED'
    if (raw === 'IN_TRANSIT' || raw === 'DISPATCHED') return 'OUT_FOR_DELIVERY'
    return raw
  }

  const getOrderStageIndex = (status: string, paymentStatus?: string | null) => {
    const normalized = normalizeDeliveryStatus(status, paymentStatus)
    if (normalized === 'PENDING') return 0
    if (normalized === 'PROCESSING') return 1
    if (normalized === 'PACKED') return 2
    if (normalized === 'OUT_FOR_DELIVERY') return 3
    if (normalized === 'DELIVERED') return 4
    return 0
  }

  const formatOrderStatus = (status: string, paymentStatus?: string | null) => {
    const normalized = normalizeDeliveryStatus(status, paymentStatus)
    if (normalized === 'PACKED') return 'LOADED'
    return normalized.replace(/_/g, ' ')
  }

  const isOrderDelivered = (order: Order | null) => {
    if (!order) return false
    return String(normalizeDeliveryStatus(order.status, order.paymentStatus)) === 'DELIVERED'
  }

  const escapeHtml = (value: string) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')

  const getOrderLineTotal = (item: OrderItem) => {
    const explicit = Number(item.totalPrice)
    if (Number.isFinite(explicit) && explicit > 0) return explicit
    return Number(item.unitPrice || 0) * Number(item.quantity || 0)
  }

  const downloadReceipt = async (order: Order) => {
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const subtotal = Number(order.subtotal ?? order.items.reduce((sum, item) => sum + getOrderLineTotal(item), 0))
      const tax = Number(order.tax ?? 0)
      const shippingCost = Number(order.shippingCost ?? 0)
      const discount = Number(order.discount ?? 0)
      const total = Number(order.totalAmount ?? subtotal + tax + shippingCost - discount)
      const issuedAt = new Date(order.deliveredAt || order.deliveryDate || order.createdAt)
      const receiptNumber = `RCT-${String(order.orderNumber || order.id)}`
      const fullAddress = [
        order.shippingAddress,
        order.shippingCity,
        order.shippingState,
        order.shippingZipCode,
        order.shippingCountry || 'Philippines',
      ]
        .filter(Boolean)
        .join(', ')

      const fileName = `Receipt-${order.orderNumber}.pdf`
      const pdf = await PDFDocument.create()
      const pageSize: [number, number] = [595.28, 841.89] // A4
      let page = pdf.addPage(pageSize)
      const fontRegular = await pdf.embedFont(StandardFonts.Helvetica)
      const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const margin = 40
      const contentWidth = page.getWidth() - margin * 2
      let y = page.getHeight() - margin

      const wrapText = (text: string, maxWidth: number, fontSize: number, font: any) => {
        const words = String(text || '').split(/\s+/)
        const lines: string[] = []
        let current = ''
        for (const word of words) {
          const next = current ? `${current} ${word}` : word
          if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
            current = next
          } else {
            if (current) lines.push(current)
            current = word
          }
        }
        if (current) lines.push(current)
        return lines.length ? lines : ['']
      }

      const ensureSpace = (needed: number) => {
        if (y - needed >= margin) return
        page = pdf.addPage(pageSize)
        y = page.getHeight() - margin
      }

      const drawText = (text: string, x: number, yy: number, size = 10, bold = false, color = rgb(0.2, 0.25, 0.32)) => {
        page.drawText(text, {
          x,
          y: yy,
          size,
          font: bold ? fontBold : fontRegular,
          color,
        })
      }

      drawText('LogiTrack Pro', margin, y, 14, true, rgb(0.06, 0.09, 0.16))
      drawText('Order Receipt', page.getWidth() - margin - fontBold.widthOfTextAtSize('Order Receipt', 10), y + 1, 10, true)
      y -= 16
      drawText('Official Delivery Receipt', margin, y, 9, false, rgb(0.39, 0.45, 0.55))
      y -= 14

      const badgeText = `Receipt No: ${receiptNumber} | Order No: ${order.orderNumber}`
      page.drawRectangle({
        x: margin,
        y: y - 7,
        width: contentWidth,
        height: 12,
        borderColor: rgb(0.88, 0.91, 0.94),
        borderWidth: 1,
        color: rgb(0.97, 0.98, 0.99),
      })
      drawText(badgeText, margin + 6, y - 2.5, 8.5, false, rgb(0.28, 0.33, 0.41))
      y -= 22

      const colGap = 10
      const colW = (contentWidth - colGap * 2) / 3
      drawText('Delivery Details', margin, y, 8.5, true, rgb(0.39, 0.45, 0.55))
      drawText('Sold By', margin + colW + colGap, y, 8.5, true, rgb(0.39, 0.45, 0.55))
      drawText('Order Details', margin + (colW + colGap) * 2, y, 8.5, true, rgb(0.39, 0.45, 0.55))
      y -= 11

      const addressLines = wrapText(fullAddress || '-', colW, 8.5, fontRegular)
      const orderDetails = [new Date(order.createdAt).toLocaleDateString(), issuedAt.toLocaleDateString()]
      const maxRows = Math.max(addressLines.length, 1, orderDetails.length)
      ensureSpace(maxRows * 11)
      for (let i = 0; i < maxRows; i++) {
        if (addressLines[i]) drawText(addressLines[i], margin, y - i * 10, 8.5, false)
        if (i === 0) drawText('LogiTrack Pro', margin + colW + colGap, y, 8.5, false)
        if (orderDetails[i]) drawText(orderDetails[i], margin + (colW + colGap) * 2, y - i * 10, 8.5, false)
      }
      y -= maxRows * 10 + 12

      ensureSpace(24)
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + contentWidth, y },
        thickness: 1,
        color: rgb(0.88, 0.91, 0.94),
      })
      y -= 12
      drawText('Item Description', margin, y, 8.5, true, rgb(0.39, 0.45, 0.55))
      drawText('Qty', page.getWidth() - margin - fontBold.widthOfTextAtSize('Qty', 8.5), y, 8.5, true, rgb(0.39, 0.45, 0.55))
      y -= 10

      for (const item of order.items || []) {
        const lineText = `${item.product?.name || 'Item'} (${item.product?.sku || '-'}) - ${formatPdfMoney(Number(item.unitPrice || 0))}`
        const lines = wrapText(lineText, contentWidth - 42, 8.5, fontRegular)
        const blockHeight = Math.max(lines.length * 10, 10)
        ensureSpace(blockHeight + 6)
        lines.forEach((line, idx) => drawText(line, margin, y - idx * 10, 8.5, false, rgb(0.12, 0.16, 0.23)))
        drawText(String(Number(item.quantity || 0)), page.getWidth() - margin - fontBold.widthOfTextAtSize(String(Number(item.quantity || 0)), 9), y, 9, true, rgb(0.12, 0.16, 0.23))
        y -= blockHeight + 4
      }

      y -= 4
      ensureSpace(30)
      const totalLabel = 'Total Price'
      const totalValue = formatPdfMoney(total)
      const totalBlockWidth = 180
      page.drawLine({
        start: { x: page.getWidth() - margin - totalBlockWidth, y },
        end: { x: page.getWidth() - margin, y },
        thickness: 1,
        color: rgb(0.8, 0.84, 0.9),
      })
      y -= 14
      drawText(totalLabel, page.getWidth() - margin - totalBlockWidth + 2, y, 11, true, rgb(0.06, 0.09, 0.16))
      drawText(totalValue, page.getWidth() - margin - fontBold.widthOfTextAtSize(totalValue, 11), y, 11, true, rgb(0.06, 0.09, 0.16))
      y -= 20

      const footer = 'This receipt serves as proof of payment and delivery. Thank you for your purchase.'
      const footerLines = wrapText(footer, contentWidth, 8, fontRegular)
      ensureSpace(footerLines.length * 9 + 6)
      footerLines.forEach((line, idx) => {
        const w = fontRegular.widthOfTextAtSize(line, 8)
        drawText(line, (page.getWidth() - w) / 2, y - idx * 8, 8, false, rgb(0.39, 0.45, 0.55))
      })

      const pdfBytes = await pdf.save()
      const blob = createPdfBlob(pdfBytes)

      const nav = navigator as any
      if (typeof nav?.msSaveOrOpenBlob === 'function') {
        nav.msSaveOrOpenBlob(blob, fileName)
      } else {
        let handled = false

        const canShareFiles =
          typeof nav?.canShare === 'function' &&
          typeof nav?.share === 'function' &&
          (() => {
            try {
              const file = new File([blob], fileName, { type: 'application/pdf' })
              return nav.canShare({ files: [file] })
            } catch {
              return false
            }
          })()

        if (canShareFiles) {
          try {
            const file = new File([blob], fileName, { type: 'application/pdf' })
            await nav.share({
              title: `Receipt ${order.orderNumber}`,
              text: `Receipt for ${order.orderNumber}`,
              files: [file],
            })
            handled = true
          } catch (shareError: any) {
            if (String(shareError?.name || '') !== 'AbortError') {
              console.error('Receipt share failed:', shareError)
            }
          }
        }

        if (!handled) {
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = fileName
          link.rel = 'noopener'
          link.style.display = 'none'
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          // Mobile fallback: open in a new tab if direct download is blocked.
          window.setTimeout(() => {
            const opened = window.open(url, '_blank')
            if (!opened) {
              window.location.href = url
            }
            window.setTimeout(() => URL.revokeObjectURL(url), 30000)
          }, 250)
        }
      }
      toast.success('Receipt downloaded')
    } catch (error) {
      console.error('Receipt download failed:', error)
      try {
        const { PDFDocument, StandardFonts } = await import('pdf-lib')
        const simple = await PDFDocument.create()
        const page = simple.addPage([595.28, 841.89])
        const font = await simple.embedFont(StandardFonts.Helvetica)
        page.drawText(`Receipt ${order.orderNumber}`, { x: 40, y: 800, size: 14, font })
        page.drawText(`Total Price: ${formatPdfMoney(Number(order.totalAmount || 0))}`, { x: 40, y: 780, size: 11, font })
        const fallbackBlob = createPdfBlob(await simple.save())
        const fallbackUrl = URL.createObjectURL(fallbackBlob)
        const opened = window.open(fallbackUrl, '_blank')
        if (!opened) {
          throw new Error('Popup blocked')
        }
      } catch (fallbackError) {
        console.error('Receipt fallback failed:', fallbackError)
        toast.error('Failed to download receipt. Please allow downloads/popups and try again.')
      }
    }
  }

  const openTrackView = (orderId: string) => {
    setSelectedTrackingOrderId(orderId)
    setActiveView('track')
  }

  const isOrderCancellable = (status: string, paymentStatus?: string | null) => {
    const raw = String(status || '').toUpperCase()
    if (raw === 'PROCESSING') {
      return String(paymentStatus || '').toLowerCase() === 'pending_approval'
    }
    return ['PENDING', 'CONFIRMED'].includes(raw)
  }

  const isOrderTrackable = (status: string) => {
    const raw = String(status || '').toUpperCase()
    return ['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(raw)
  }

  const openRatingDialog = (order: Order, initialRating = 5) => {
    if (reviewedOrderIds.has(order.id)) {
      toast.info('You already rated this order')
      return
    }
    setRatingDialogOrder(order)
    setRatingValue(Math.max(1, Math.min(5, Math.round(initialRating))))
    setRatingMessage('')
  }

  const submitRating = async () => {
    if (!ratingDialogOrder?.id) return
    if (reviewedOrderIds.has(ratingDialogOrder.id)) {
      toast.info('You already rated this order')
      setRatingDialogOrder(null)
      return
    }
    if (!ratingMessage.trim()) {
      toast.error('Please add a short feedback message')
      return
    }

    setIsSubmittingRating(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: ratingDialogOrder.id,
          rating: ratingValue,
          type: ratingValue <= 2 ? 'COMPLAINT' : ratingValue === 3 ? 'SUGGESTION' : 'COMPLIMENT',
          subject: `Order Rating - ${ratingDialogOrder.orderNumber}`,
          message: ratingMessage.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 409) {
        setReviewedOrderIds((prev) => {
          const next = new Set(prev)
          next.add(ratingDialogOrder.id)
          return next
        })
        await fetchOrderMeta()
        toast.info('This order is already rated')
        setRatingDialogOrder(null)
        setRatingMessage('')
        setRatingValue(5)
        return
      }

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to submit rating')
      }

      setReviewedOrderIds((prev) => {
        const next = new Set(prev)
        next.add(ratingDialogOrder.id)
        return next
      })
      await fetchOrderMeta()
      toast.success('Rating submitted successfully')
      setRatingDialogOrder(null)
      setRatingMessage('')
      setRatingValue(5)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit rating')
    } finally {
      setIsSubmittingRating(false)
    }
  }

  const cancelOrder = async (orderId: string) => {
    try {
      const response = await fetch(`/api/customer/orders/${orderId}/cancel`, {
        method: 'PATCH',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to cancel order')
      }
      toast.success('Order cancelled successfully')
      await fetchOrders()
      emitDataSync(['orders'])
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(null)
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel order')
    }
  }

  const getProductImage = (imageUrl?: string | null) => {
    if (imageUrl && String(imageUrl).trim().length > 0) return imageUrl
    return 'https://placehold.co/120x120/e2e8f0/475569?text=Product'
  }

  const NEGROS_OCCIDENTAL_BOUNDS = {
    minLat: 9.18,
    maxLat: 11.05,
    minLng: 122.22,
    maxLng: 123.35,
  }

  const isWithinNegrosOccidental = (lat: number, lng: number) =>
    lat >= NEGROS_OCCIDENTAL_BOUNDS.minLat &&
    lat <= NEGROS_OCCIDENTAL_BOUNDS.maxLat &&
    lng >= NEGROS_OCCIDENTAL_BOUNDS.minLng &&
    lng <= NEGROS_OCCIDENTAL_BOUNDS.maxLng

  const saveAddressToProfile = async () => {
    if (!customerId) {
      toast.error('Unable to save address right now')
      return false
    }
    if (
      !shippingStreetName ||
      !shippingBarangay ||
      !shippingCity ||
      !shippingState ||
      !shippingZipCode
    ) {
      toast.error('Please complete all detailed address fields before saving')
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

    setIsSavingAddress(true)
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: composedShippingAddress,
          city: shippingCity,
          state: shippingState || 'Negros Occidental',
          zipCode: shippingZipCode,
          country: 'Philippines',
          latitude: shippingLatitude,
          longitude: shippingLongitude,
          phone: shippingPhone,
        }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) throw new Error(data?.error || 'Failed to save')
      if (data?.data) {
        hydrateAddressFromProfile(data.data)
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
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&countrycodes=ph&zoom=18`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      )

      if (!response.ok) {
        throw new Error('Reverse geocoding failed')
      }

      const data = await response.json()
      const addr = data?.address || {}

      const houseNumber = addr.house_number || ''
      const streetName = addr.road || addr.pedestrian || addr.path || ''
      const subdivision = addr.suburb || addr.neighbourhood || addr.quarter || ''
      const barangay = addr.barangay || addr.city_district || addr.village || addr.hamlet || ''
      const city = addr.city || addr.town || addr.municipality || addr.village || ''
      const province = addr.state || 'Negros Occidental'
      const postcode = addr.postcode || ''

      if (houseNumber) setShippingHouseNumber(houseNumber)
      if (streetName) setShippingStreetName(streetName)
      if (subdivision) setShippingSubdivision(subdivision)
      if (barangay) setShippingBarangay(barangay)
      if (city) setShippingCity(city)
      setShippingState(province)
      if (postcode) setShippingZipCode(postcode)
      setShippingCountry('Philippines')
    } catch {
      toast.error('Pinned location set, but address auto-fill failed. You can fill fields manually.')
    } finally {
      setIsResolvingPinnedAddress(false)
    }
  }

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
        state?: string
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
            const street = [addr.house_number, addr.road || addr.pedestrian || addr.path].filter(Boolean).join(' ')
            const barangay = addr.barangay || addr.village || ''
            const area = addr.suburb || addr.neighbourhood || ''
            const city = addr.city || addr.town || addr.municipality || ''
            const state = addr.state || ''
            const parts = [street, barangay, area, city, state].filter(Boolean)
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
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/customer-avatar', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
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

    setIsSavingProfile(true)
    try {
      let avatarToSave = profileAvatar
      if (profileAvatarFile) {
        avatarToSave = await uploadProfileAvatar(profileAvatarFile)
      }

      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileName.trim(),
          email: profileEmail.trim(),
          phone: profilePhone.trim(),
          avatar: avatarToSave,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      const updatedCustomer = payload?.data
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
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: avatarUrl }),
      })
      const payload = await response.json().catch(() => ({}))
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
    if (!ctx) return null

    const baseScale = Math.max(outputSize / image.width, outputSize / image.height)
    const scale = baseScale * avatarCropZoom
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const x = (outputSize - drawWidth) / 2 + avatarCropX
    const y = (outputSize - drawHeight) / 2 + avatarCropY

    ctx.clearRect(0, 0, outputSize, outputSize)
    ctx.drawImage(image, x, y, drawWidth, drawHeight)

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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-cyan-50/40 to-white">
      <header className="sticky top-0 z-10 border-b border-cyan-200/60 bg-gradient-to-r from-teal-700 via-cyan-700 to-sky-700 text-white shadow-lg shadow-cyan-900/10">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6" />
            <div>
              <h1 className="font-bold">LogiTrack</h1>
              <p className="text-xs text-cyan-100">Customer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={`relative text-white hover:bg-cyan-700/60 ${activeView === 'cart' ? 'bg-cyan-700/60' : ''}`}
              onClick={() => setActiveView('cart')}
              title="Open cart"
            >
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">{cartCount}</span>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white hover:bg-cyan-700/60">
                  <Avatar className="h-8 w-8 border border-cyan-200/40">
                    {avatarPreviewUrl ? <AvatarImage src={avatarPreviewUrl} alt={profileName || user?.name || 'Profile'} /> : null}
                    <AvatarFallback className="bg-cyan-800 text-white">
                      {(profileName || user?.name || 'C').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setActiveView('profile')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setActiveView('profile')
                    setIsAddressDialogOpen(true)
                  }}
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  Shipping Address
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="space-y-4 p-4 pb-24">
        {activeView === 'home' && (
          <section className="-mx-4 -mt-4 bg-slate-100 pb-6">
            <div className="sticky top-[57px] z-[5] border-b border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products"
                  className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
              </div>
            </div>

            {isProductsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-700" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 px-1.5 pt-1.5">
                {filteredProducts.map((p) => {
                  return (
                    <Card key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-none">
                      <div className="relative">
                        <img
                          src={getProductImage(p.imageUrl)}
                          alt={p.name}
                          className="aspect-[3/4] w-full object-cover bg-white"
                        />
                      </div>

                      <CardContent className="space-y-1 p-2">
                        <p className="line-clamp-2 min-h-[2.2rem] text-[14px] leading-[1.1rem] text-slate-900">{p.name}</p>
                        <p className="text-[20px] font-bold leading-none text-rose-600">{formatPeso(p.price)}</p>
                        <div className="flex items-center justify-between pt-0.5">
                          <Button
                            size="sm"
                            className="ml-auto h-7 rounded-md bg-teal-700 px-2 text-[11px] text-white hover:bg-teal-800"
                            onClick={() => addToCart(p)}
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            Add
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {activeView === 'cart' && (
          <section className="-mx-4 -mt-4 bg-[#f5f5f5] pb-28">
            <div className="sticky top-[57px] z-[6] border-b bg-white px-3 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveView('home')}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">Shopping cart ({cart.length})</h2>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-sm text-gray-600"
                    onClick={() => setIsAddressDialogOpen(true)}
                  >
                    Edit
                  </Button>
                </div>
                <p className="pl-10 text-xs text-gray-500 truncate">{shippingBarangay || 'Barangay'}, {shippingCity || 'City'}, {shippingState || 'Province'}</p>
              </div>

            <div className="space-y-2 px-2 pt-2">
              {cart.map((item) => {
                const selected = selectedCartIds.has(item.productId)
                return (
                  <Card key={item.productId} className="border-0 shadow-none rounded-none">
                    <CardContent className="p-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCartIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(item.productId)) next.delete(item.productId)
                              else next.add(item.productId)
                              return next
                            })
                          }}
                          className={`mt-9 h-6 w-6 rounded-full border ${selected ? 'border-rose-500 bg-rose-500' : 'border-gray-300 bg-white'}`}
                          title="Select item"
                        />
                        <img
                          src={getProductImage(item.imageUrl)}
                          alt={item.name}
                          className="h-[92px] w-[92px] rounded-md border object-cover bg-white"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] text-slate-800">{item.name}</p>
                          <p className="mt-1 inline-block max-w-full truncate rounded border bg-gray-50 px-2 py-1 text-xs text-gray-600">{item.unit}</p>
                          <p className="mt-1 text-[29px] leading-none font-semibold text-rose-600">{formatPeso(item.unitPrice)}</p>
                          <div className="mt-1 flex items-center justify-between">
                            <div className="flex items-center rounded border">
                              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-none" onClick={() => updateCartQty(item.productId, item.quantity - 1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <div className="w-7 text-center text-sm">{item.quantity}</div>
                              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-none" onClick={() => updateCartQty(item.productId, item.quantity + 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

              {cart.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-slate-500">Your cart is empty.</div>
              )}
            </div>

            {cart.length > 0 ? (
              <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`h-6 w-6 rounded-full border ${allCartSelected ? 'border-rose-500 bg-rose-500' : 'border-gray-300 bg-white'}`}
                    onClick={() => {
                      setSelectedCartIds(allCartSelected ? new Set() : new Set(cart.map((item) => item.productId)))
                    }}
                    title="Select all"
                  />
                  <span className="text-sm text-gray-700">All</span>
                  <div className="ml-auto mr-2 text-xl font-semibold">{formatPeso(selectedSubtotal)}</div>
                  {selectedCount > 0 ? (
                    <Button
                      className="h-11 rounded-xl bg-rose-500 px-7 text-white hover:bg-rose-600"
                      onClick={() => setActiveView('checkout')}
                    >
                      Check out
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        )}

        {activeView === 'checkout' && (
          <section className="-mx-4 -mt-4 bg-[#f5f5f5] pb-28">
            <div className="sticky top-[57px] z-[6] border-b bg-white px-3 py-3">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveView('cart')}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <h2 className="text-lg font-semibold">Checkout</h2>
              </div>
            </div>

            {selectedCartItems.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                No selected items. Go back to cart and select item(s) to checkout.
              </div>
            ) : (
              <div className="space-y-3 p-3">
                <Card className="border-0 shadow-none">
                  <CardContent className="space-y-1 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-900">{shippingName || 'No recipient name set'}</p>
                      <Button variant="ghost" size="sm" onClick={() => setIsAddressDialogOpen(true)}>Edit</Button>
                    </div>
                    <p className="text-sm text-slate-600">{shippingPhone || 'No phone number set'}</p>
                    <p className="text-sm text-slate-700">
                      {composedShippingAddress || 'No delivery address set yet'}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    {selectedCartItems.map((item) => (
                      <div key={item.productId} className="flex gap-3">
                        <img
                          src={getProductImage(item.imageUrl)}
                          alt={item.name}
                          className="h-[74px] w-[74px] rounded-md border object-cover bg-white"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-800">{item.name}</p>
                          <p className="mt-1 inline-block max-w-full truncate rounded border bg-gray-50 px-2 py-1 text-xs text-gray-600">{item.unit}</p>
                          <p className="mt-1 text-xl font-semibold text-rose-600">{formatPeso(item.unitPrice)}</p>
                          <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-none">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Payment method</Label>
                      <p className="text-xs text-gray-500">{paymentMethod}</p>
                    </div>
                    <div className="grid gap-2">
                      {(['COD', 'GCASH', 'MAYA', 'BANK_TRANSFER'] as PaymentMethod[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPaymentMethod(m)}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                            paymentMethod === m ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-gray-200 bg-white text-slate-700'
                          }`}
                        >
                          <span>{m}</span>
                          <span className={`h-4 w-4 rounded-full border ${paymentMethod === m ? 'border-rose-500 bg-rose-500' : 'border-gray-300 bg-white'}`} />
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-none">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Subtotal</span>
                      <span>{formatPeso(selectedSubtotal)}</span>
                    </div>
                    <div className="h-px bg-gray-100" />
                    <div className="flex items-center justify-between font-semibold">
                      <span>Total ({selectedCartItems.length} item{selectedCartItems.length > 1 ? 's' : ''})</span>
                      <span className="text-rose-600">{formatPeso(selectedSubtotal)}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-none">
                  <CardContent className="space-y-2 p-4">
                    <Label className="text-sm font-medium">Order note (optional)</Label>
                    <Textarea placeholder="Add note for delivery" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    <Label className="text-sm font-medium">Delivery date</Label>
                    <Input
                      type="date"
                      value={deliveryDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={e => setDeliveryDate(e.target.value)}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {selectedCartItems.length > 0 ? (
              <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-white px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-500">Total ({selectedCartItems.length} item{selectedCartItems.length > 1 ? 's' : ''})</p>
                    <p className="text-2xl font-semibold text-rose-600">{formatPeso(selectedSubtotal)}</p>
                  </div>
                  <Button
                    className="h-11 rounded-xl bg-rose-500 px-8 text-white hover:bg-rose-600"
                    onClick={placeOrder}
                    disabled={isPlacingOrder}
                  >
                    {isPlacingOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Place order
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {activeView === 'orders' && (
          <section className="-mx-4 -mt-4 bg-slate-100 pb-6">
            <div className="border-b bg-white px-4 py-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                  value={ordersSearch}
                  onChange={(e) => setOrdersSearch(e.target.value)}
                  placeholder="Search your orders"
                  className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="mt-3 flex gap-5 overflow-x-auto text-sm">
                {ordersTabOptions.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setOrdersTab(tab.id)}
                    className={`whitespace-nowrap border-b-2 pb-2 ${
                      ordersTab === tab.id
                        ? 'border-slate-900 font-semibold text-slate-900'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-700" />
              </div>
            ) : visibleOrders.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">No orders found.</div>
            ) : (
              <div className="space-y-3 px-3 pt-3">
                {visibleOrders.map((o) => {
                  const normalizedStatus = String(normalizeDeliveryStatus(o.status, o.paymentStatus))
                  const firstItem = o.items?.[0]
                  const isDelivered = normalizedStatus === 'DELIVERED'
                  const isReviewed = reviewedOrderIds.has(o.id)
                  const submittedRating = Number(orderRatings[o.id] || 0)
                  const hasSubmittedRating = submittedRating >= 1 && submittedRating <= 5
                  const deliveryLabel = isDelivered
                    ? `${new Date(o.deliveredAt || o.deliveryDate || o.createdAt).toLocaleDateString()} Delivered`
                    : o.deliveryDate
                      ? `${new Date(o.deliveryDate).toLocaleDateString()} ${formatOrderStatus(o.status, o.paymentStatus)}`
                      : 'Delivery status updated'

                  return (
                    <div
                      key={o.id}
                      onClick={() => setSelectedOrder(o)}
                      className="rounded-md border border-slate-200 bg-white"
                    >
                      <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                        <div className="min-w-0 truncate font-medium text-slate-800">{o.orderNumber}</div>
                        <div className="ml-2 shrink-0 text-sm text-slate-700">{formatOrderStatus(o.status, o.paymentStatus).toLowerCase()}</div>
                      </div>

                      <div className="mx-3 mt-3 flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-slate-500" />
                          <span>{deliveryLabel}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>

                      <div className="flex items-start gap-3 px-3 py-3">
                        <img
                          src={getProductImage(firstItem?.product?.imageUrl)}
                          alt={firstItem?.product?.name || 'Product'}
                          className="h-12 w-12 rounded border border-slate-200 object-cover bg-white"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-900">{firstItem?.product?.name || 'Order items'}</p>
                          <p className="mt-1 text-xs text-slate-500">x{firstItem?.quantity || 0}</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{formatPeso(o.totalAmount)}</p>
                      </div>

                      {isDelivered && hasSubmittedRating ? (
                        <div className="-mt-1 px-3 pb-2 text-xs text-amber-700">
                          Rated: {'★'.repeat(submittedRating)}{'☆'.repeat(5 - submittedRating)} ({submittedRating}/5)
                        </div>
                      ) : null}

                      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
                        {isOrderCancellable(o.status, o.paymentStatus) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-red-200 px-3 text-xs text-red-600 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation()
                              void cancelOrder(o.id)
                            }}
                          >
                            Cancel Order
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-slate-300 px-3 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedOrder(o)
                          }}
                        >
                          View details
                        </Button>
                        {isOrderTrackable(o.status) ? (
                          <Button
                            size="sm"
                            className="h-8 bg-teal-700 px-3 text-xs text-white hover:bg-teal-800"
                            onClick={(e) => {
                              e.stopPropagation()
                              openTrackView(o.id)
                            }}
                          >
                            Track
                          </Button>
                        ) : isDelivered ? (
                          <Button
                            size="sm"
                            className="h-8 bg-rose-600 px-3 text-xs text-white hover:bg-rose-700 disabled:opacity-70"
                            onClick={(e) => {
                              e.stopPropagation()
                              openRatingDialog(o)
                            }}
                            disabled={isReviewed}
                          >
                            {isReviewed ? 'Rated' : 'Rate order'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {activeView === 'track' && (
          <section className="-mx-4 -mt-4 bg-[#f3f3f3] pb-8">
            {(() => {
              const order = orders.find((o) => o.id === selectedTrackingOrderId)
              if (!order) {
                return (
                  <div className="p-4">
                    <div className="flex h-14 items-center gap-2 border-b bg-white px-2">
                      <Button variant="ghost" size="icon" onClick={() => setActiveView('orders')}>
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                      <h2 className="text-lg font-semibold">Track package</h2>
                    </div>
                    <p className="pt-4 text-sm text-gray-500">Select an order to track.</p>
                  </div>
                )
              }

              const tracking = trackingByOrderId[order.id]
              const routePoints = Array.isArray(tracking?.routePoints) ? tracking.routePoints : []
              const hasDriverCoordinates = typeof tracking?.latitude === 'number' && typeof tracking?.longitude === 'number'
              const mapLat = hasDriverCoordinates ? (tracking.latitude as number) : null
              const mapLng = hasDriverCoordinates ? (tracking.longitude as number) : null
              const currentIndex = getOrderStageIndex(order.status, order.paymentStatus)
              const currentStatusLabel = formatOrderStatus(order.status, order.paymentStatus)
              const headlineDate = new Date(order.deliveredAt || order.deliveryDate || order.createdAt)

              return (
                <>
                  <div className="sticky top-[57px] z-[6] flex h-14 items-center justify-between border-b border-[#e8e8e8] bg-white px-2">
                    <Button variant="ghost" size="icon" onClick={() => setActiveView('orders')}>
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h2 className="text-lg font-semibold">Track package</h2>
                    <div className="h-10 w-10" />
                  </div>

                  <div className="relative">
                    {mapLat !== null && mapLng !== null ? (
                      <DriverRouteMap
                        latitude={mapLat}
                        longitude={mapLng}
                        routePoints={routePoints}
                        className="h-[260px] rounded-none border-0"
                      />
                    ) : (
                      <div className="h-[260px] w-full bg-cyan-100" />
                    )}
                    <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-[#d7d7d7] bg-white/95 px-4 py-1.5 text-sm font-medium text-slate-800 shadow-sm">
                      {shippingState || (order as any).shippingState || 'Location'}
                    </div>
                  </div>

                  <div className="space-y-3 px-3 pb-4 pt-3">
                    <p className="text-xl font-semibold text-slate-900">
                      {currentStatusLabel.charAt(0) + currentStatusLabel.slice(1).toLowerCase()} {headlineDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                    {String(normalizeDeliveryStatus(order.status, order.paymentStatus)) === 'DELIVERED' ? (
                      <Card className="rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-none">
                        <CardContent className="p-4">
                          <p className="text-sm font-semibold text-emerald-800">
                            {tracking?.deliveredMessage || 'Your order has been delivered.'}
                          </p>
                        </CardContent>
                      </Card>
                    ) : null}

                    <Card className="rounded-2xl border border-[#ebebeb] shadow-none">
                      <CardContent className="space-y-1 p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-base font-semibold">{tracking?.driverName || 'Driver not assigned yet'}</p>
                          <p className="text-xl leading-none text-gray-500">›</p>
                        </div>
                        <p className="text-sm text-gray-500">Assigned driver</p>
                        <p className="text-sm text-gray-500">{order.orderNumber}</p>
                      </CardContent>
                    </Card>

                    {tracking?.deliveryPhoto ? (
                      <Card className="rounded-2xl border border-[#ebebeb] shadow-none">
                        <CardContent className="space-y-3 p-4">
                          <p className="text-sm font-semibold text-slate-800">
                            Proof of Delivery
                          </p>
                          <p className="text-xs text-slate-500">
                            Recipient: {tracking?.recipientName || 'Customer'}
                          </p>
                          <img
                            src={tracking.deliveryPhoto}
                            alt="Proof of delivery"
                            className="h-48 w-full rounded-md border border-slate-200 object-cover"
                          />
                        </CardContent>
                      </Card>
                    ) : null}

                    <Card className="rounded-2xl border border-[#ebebeb] shadow-none">
                      <CardContent className="p-4">
                        <p className="text-sm font-medium text-slate-800">How would you rate your delivery experience?</p>
                        <div className="mt-3 flex items-center gap-2 text-amber-500">
                          {(() => {
                            const isReviewed = reviewedOrderIds.has(order.id)
                            return Array.from({ length: 5 }).map((_, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => openRatingDialog(order, index + 1)}
                                className="rounded p-0.5 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={isReviewed}
                                title={isReviewed ? 'Order already rated' : `Rate ${index + 1} star${index === 0 ? '' : 's'}`}
                                aria-label={isReviewed ? 'Order already rated' : `Rate ${index + 1} star${index === 0 ? '' : 's'}`}
                              >
                                <Star className="h-6 w-6 fill-current" />
                              </button>
                            ))
                          })()}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border border-[#ebebeb] shadow-none">
                      <CardContent className="flex items-center justify-between p-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{tracking?.driverName || 'Driver not assigned yet'}</p>
                          <p className="text-sm text-gray-500">Driver</p>
                        </div>
                        <Button size="icon" variant="secondary" className="h-11 w-11 rounded-full bg-[#f5f5f5]">
                          <Phone className="h-5 w-5" />
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border border-[#ebebeb] shadow-none">
                      <CardContent className="space-y-3 p-4">
                        {isTrackingLoading && <Loader2 className="h-5 w-5 animate-spin text-cyan-700" />}
                        {[...orderStages].reverse().map((stage) => {
                          const stageIndex = orderStages.indexOf(stage)
                          const isCompleted = stageIndex <= currentIndex
                          return (
                            <div key={stage} className="grid grid-cols-[82px_16px_1fr] items-start gap-3">
                              <p className="text-xs text-gray-500">
                                {isCompleted
                                  ? new Date(
                                      stage === 'Delivered' && order.deliveredAt ? order.deliveredAt : tracking?.updatedAt || order.createdAt
                                    ).toLocaleString()
                                  : ''}
                              </p>
                              <div className={`mt-0.5 h-4 w-4 rounded-full ${isCompleted ? 'bg-teal-700' : 'bg-gray-300'}`} />
                              <div>
                                <p className={`text-sm ${isCompleted ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{stage}</p>
                                {stage === 'Delivered' && isCompleted ? (
                                  <p className="text-sm text-gray-600">Your package has been delivered.</p>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                        <p className="text-xs text-gray-500">
                          {tracking?.updatedAt ? `Last update: ${new Date(tracking.updatedAt).toLocaleString()}` : 'Waiting for driver updates'}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )
            })()}
          </section>
        )}

        {activeView === 'feedback' && (
          <Card>
            <CardHeader><CardTitle>Submit Feedback</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">Use delivered orders to submit feedback.</p>
            </CardContent>
          </Card>
        )}

        {activeView === 'profile' && (
          <div className="space-y-3">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center">
                  <div className="relative mb-3">
                    <Avatar className="h-16 w-16">
                      {avatarPreviewUrl ? <AvatarImage src={avatarPreviewUrl} alt={profileName || user?.name || 'Profile'} /> : null}
                      <AvatarFallback className="bg-teal-700 text-white">{(profileName || user?.name || 'C').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        if (avatarInputRef.current) {
                          avatarInputRef.current.value = ''
                        }
                        void openAvatarCropDialog(file)
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-teal-700 p-0 text-white hover:bg-teal-800"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={isSavingProfile}
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="font-semibold">{profileName || user?.name}</p>
                  <p className="text-sm text-gray-500">{profilePhone || 'No phone number'}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Profile Preview</CardTitle>
                <CardDescription>View your account details. Edit opens in a popup.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">Name:</span> {profileName || 'Not set'}</p>
                  <p><span className="font-medium">Email:</span> {profileEmail || 'Not set'}</p>
                  <p><span className="font-medium">Phone:</span> {profilePhone || 'Not set'}</p>
                  <p><span className="font-medium">Delivery Address:</span> {composedShippingAddress || 'Not set'}</p>
                  <p><span className="font-medium">City/Province:</span> {shippingCity ? `${shippingCity}, ${shippingState || 'Negros Occidental'}` : 'Not set'}</p>
                  <p><span className="font-medium">Postal Code:</span> {shippingZipCode || 'Not set'}</p>
                </div>
                <Button className="w-full" onClick={() => setIsProfileDialogOpen(true)}>
                  <User className="h-4 w-4 mr-2" />
                  Edit Profile
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update your account details and profile picture.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="customer-profile-name">Full Name</Label>
              <Input
                id="customer-profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-email">Email</Label>
              <Input
                id="customer-profile-email"
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-phone">Phone</Label>
              <Input
                id="customer-profile-phone"
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                placeholder="Enter your phone number"
              />
            </div>
            <div className="space-y-2 rounded-md border p-3 bg-slate-50">
              <Label>Delivery Address</Label>
              <p className="text-sm text-slate-700">{composedShippingAddress || 'Not set'}</p>
              <p className="text-xs text-slate-500">
                {shippingCity ? `${shippingCity}, ${shippingState || 'Negros Occidental'} ${shippingZipCode || ''}`.trim() : 'City/Province not set'}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setIsProfileDialogOpen(false)
                  setIsAddressDialogOpen(true)
                }}
              >
                <MapPin className="h-4 w-4 mr-2" />
                Edit Delivery Address
              </Button>
            </div>
            <Button
              onClick={async () => {
                const saved = await saveProfile()
                if (saved) setIsProfileDialogOpen(false)
              }}
              disabled={isSavingProfile}
              className="w-full"
            >
              {isSavingProfile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Profile'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAvatarCropDialogOpen}
        onOpenChange={(open) => {
          setIsAvatarCropDialogOpen(open)
          if (!open) {
            if (avatarCropSource?.startsWith('blob:')) {
              URL.revokeObjectURL(avatarCropSource)
            }
            setAvatarCropSource(null)
            setAvatarCropFile(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Crop Profile Photo</DialogTitle>
            <DialogDescription>Adjust and confirm before upload.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="mx-auto h-56 w-56 overflow-hidden rounded-full border bg-slate-100">
              <div
                className={`h-full w-full touch-none ${isDraggingCrop ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerLeave={handleCropPointerUp}
              >
                {avatarCropSource ? (
                  <img
                    src={avatarCropSource}
                    alt="Crop preview"
                    className="h-full w-full object-cover select-none"
                    draggable={false}
                    style={{
                      transform: `translate(${avatarCropX}px, ${avatarCropY}px) scale(${avatarCropZoom})`,
                      transformOrigin: 'center center',
                    }}
                  />
                ) : null}
              </div>
            </div>
            <p className="text-xs text-gray-500 -mt-2 text-center">Drag photo to position, then tap Apply & Upload.</p>

            <div className="space-y-2">
              <Label htmlFor="avatar-zoom">Zoom</Label>
              <Input
                id="avatar-zoom"
                type="range"
                min="1"
                max="2.5"
                step="0.01"
                value={avatarCropZoom}
                onChange={(e) => setAvatarCropZoom(Number(e.target.value))}
              />
            </div>

            <Button
              className="w-full"
              disabled={isSavingProfile || !avatarCropSource}
              onClick={async () => {
                try {
                  const croppedFile = await createCroppedAvatarFile()
                  const fileToUpload = croppedFile || avatarCropFile
                  if (!fileToUpload) throw new Error('Failed to prepare image')
                  await handleAvatarUpload(fileToUpload)
                  setIsAvatarCropDialogOpen(false)
                } catch (error: any) {
                  toast.error(error?.message || 'Failed to upload photo')
                }
              }}
            >
              {isSavingProfile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Apply & Upload'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddressDialogOpen} onOpenChange={setIsAddressDialogOpen}>
        <DialogContent showCloseButton={false} className="max-w-md max-h-[95vh] overflow-y-auto p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Edit Address</DialogTitle>
            <DialogDescription>Set your address in Negros Occidental, Philippines.</DialogDescription>
          </DialogHeader>

          <div className="border-b px-4 py-3 flex items-center justify-between">
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </DialogClose>
            <h2 className="text-base font-semibold">Edit Address</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setShippingHouseNumber('')
                setShippingStreetName('')
                setShippingSubdivision('')
                setShippingBarangay('')
                setShippingCity('')
                setShippingState('Negros Occidental')
                setShippingZipCode('')
                setShippingLatitude(null)
                setShippingLongitude(null)
                setAddressSearch('')
                setAddressSearchResults([])
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="Full name" value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Phone number</Label>
              <div className="flex rounded-md border bg-white">
                <div className="px-3 py-2 text-sm text-gray-600 border-r">PH +63</div>
                <Input
                  className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="9460056944"
                  value={shippingPhone}
                  onChange={(e) => setShippingPhone(e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <div className="rounded-md border bg-gray-50 p-3 space-y-3">
                <p className="text-xs text-gray-500">Fill up manually, or use Search Address, or pin on the map.</p>

                <div className="space-y-2">
                  <Label className="text-xs text-gray-600">Search Address (Alternative)</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search street, barangay, or city in Negros Occidental"
                      value={addressSearch}
                      onChange={(e) => setAddressSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          searchAddressInNegrosOccidental()
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={searchAddressInNegrosOccidental} disabled={isSearchingAddress}>
                      {isSearchingAddress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  {addressSearchResults.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-500">Nearby locations</p>
                <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                  {addressSearchResults.map((item, index) => {
                    const parts = item.displayName.split(',')
                    const title = parts[0]?.trim() || 'Address result'
                    const subtitle = parts.slice(1).join(',').trim()
                    return (
                      <button
                        key={`${item.latitude}-${item.longitude}-${index}`}
                        type="button"
                        className="w-full text-left flex items-start gap-3"
                        onClick={() => {
                          setAddressSearch(title)
                          setAddressSearchResults([])
                          void handlePinnedLocation(item.latitude, item.longitude)
                        }}
                      >
                        <MapPin className="h-5 w-5 text-gray-500 mt-1 shrink-0" />
                        <span className="block">
                          <span className="block font-semibold text-sm text-gray-900">{title}</span>
                          <span className="block text-sm text-gray-500">{subtitle}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input placeholder="House number" value={shippingHouseNumber} onChange={(e) => setShippingHouseNumber(e.target.value)} />
                  <Input placeholder="Street name" value={shippingStreetName} onChange={(e) => setShippingStreetName(e.target.value)} />
                  <Input placeholder="Subdivision" value={shippingSubdivision} onChange={(e) => setShippingSubdivision(e.target.value)} />
                  <Input placeholder="Barangay" value={shippingBarangay} onChange={(e) => setShippingBarangay(e.target.value)} />
                  <Input placeholder="City" value={shippingCity} onChange={(e) => setShippingCity(e.target.value)} />
                  <Input placeholder="Province" value={shippingState} onChange={(e) => setShippingState(e.target.value)} />
                  <Input placeholder="Postal code" value={shippingZipCode} onChange={(e) => setShippingZipCode(e.target.value)} />
                  <Input value={shippingCountry} disabled readOnly />
                </div>
                <p className="text-xs text-gray-500">
                  Full address: {composedShippingAddress || 'Not complete yet'}
                </p>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  Pin Address on Map
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={useCurrentLocation}>
                  <LocateFixed className="h-4 w-4 mr-1" />
                  Use Current Location
                </Button>
              </div>
              <AddressMapPicker latitude={shippingLatitude} longitude={shippingLongitude} onChange={handlePinnedLocation} />
              <p className="text-xs text-gray-600">
                {shippingLatitude !== null && shippingLongitude !== null
                  ? `Pinned: ${shippingLatitude.toFixed(6)}, ${shippingLongitude.toFixed(6)}`
                  : 'No location pinned yet'}
              </p>
              {isResolvingPinnedAddress && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Auto-filling address from pinned location...
                </p>
              )}
            </div>

            <p className="text-xs text-center text-gray-500">
              By clicking Save, you acknowledge that you have read the Privacy Policy.
            </p>

            <Button
              className="w-full rounded-full bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                const saved = await saveAddressToProfile()
                if (saved) setIsAddressDialogOpen(false)
              }}
              disabled={isSavingAddress}
            >
              {isSavingAddress ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedOrder}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedOrder(null)
            setIsReceiptDialogOpen(false)
          }
        }}
      >
        {selectedOrder && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedOrder.orderNumber}</DialogTitle>
              <DialogDescription>
                Status: <span className="font-medium text-gray-900">{formatOrderStatus(selectedOrder.status, selectedOrder.paymentStatus)}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {[...orderStages].reverse().map((stage) => {
                const stageIndex = orderStages.indexOf(stage)
                const currentIndex = getOrderStageIndex(selectedOrder.status, selectedOrder.paymentStatus)
                const isCompleted = stageIndex <= currentIndex
                const isCurrent = stageIndex === currentIndex

                return (
                  <div key={stage} className="flex items-center gap-3">
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                        isCompleted ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted ? <CheckCircle className="h-4 w-4" /> : stageIndex + 1}
                    </div>
                    <p className={`text-sm ${isCurrent ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{stage}</p>
                  </div>
                )
              })}
            </div>

            <div className="space-y-2">
              {selectedOrder.items?.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm py-1">
                  <div className="flex items-center gap-2">
                    <img
                      src={getProductImage(item.product.imageUrl)}
                      alt={item.product.name}
                      className="h-9 w-9 rounded-md border border-cyan-100 object-cover bg-white"
                    />
                    <span>{item.product.name} x {item.quantity}</span>
                  </div>
                  <span>{formatPeso(item.unitPrice * item.quantity)}</span>
                </div>
              ))}
              <p className="font-semibold pt-1">Total: {formatPeso(selectedOrder.totalAmount)}</p>
            </div>

            {isOrderDelivered(selectedOrder) ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsReceiptDialogOpen(true)}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Receipt
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              {isOrderTrackable(selectedOrder.status) && String(selectedOrder.paymentStatus || '').toLowerCase() !== 'pending_approval' ? (
                <Button
                  className="bg-teal-700 text-white hover:bg-teal-800"
                  onClick={() => {
                    setSelectedOrder(null)
                    openTrackView(selectedOrder.id)
                  }}
                >
                  <Truck className="h-4 w-4 mr-2" />
                  Track Order
                </Button>
              ) : isOrderCancellable(selectedOrder.status, selectedOrder.paymentStatus) ? (
                <Button
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => void cancelOrder(selectedOrder.id)}
                >
                  Cancel Order
                </Button>
              ) : (
                <Button variant="outline" disabled>
                  Not Available
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={Boolean(selectedOrder) && isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
        {selectedOrder && isOrderDelivered(selectedOrder) ? (
          <DialogContent showCloseButton={false} className="w-[95vw] max-w-sm h-[90vh] p-0 overflow-hidden">
            <div className="flex h-full flex-col bg-slate-100">
              <div className="flex items-center border-b bg-white px-3 py-3">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsReceiptDialogOpen(false)}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <p className="flex-1 text-center text-2xl font-semibold text-slate-900">Receipt</p>
                <div className="h-8 w-8" />
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-[320px] rounded-xl border border-slate-200 bg-white p-4 text-[11px] shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">LogiTrack Pro</p>
                      <p className="text-[10px] text-slate-500">Official Delivery Receipt</p>
                    </div>
                    <p className="text-[10px] font-semibold text-slate-700">Order Receipt</p>
                  </div>

                  <div className="mt-3 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                    Receipt No: {`RCT-${selectedOrder.orderNumber}`} | Order No: {selectedOrder.orderNumber}
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <p className="font-semibold text-slate-500">Delivery Details</p>
                      <p className="mt-1 leading-4 text-slate-700 break-words">
                        {[
                          selectedOrder.shippingAddress,
                          selectedOrder.shippingCity,
                          selectedOrder.shippingState,
                          selectedOrder.shippingZipCode,
                          selectedOrder.shippingCountry || 'Philippines',
                        ]
                          .filter(Boolean)
                          .join(', ') || '-'}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-500">Sold By</p>
                      <p className="mt-1 leading-4 text-slate-700">LogiTrack Pro</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-500">Order Details</p>
                      <p className="mt-1 text-slate-700">{new Date(selectedOrder.createdAt).toLocaleDateString()}</p>
                      <p className="text-slate-700">{new Date(selectedOrder.deliveredAt || selectedOrder.deliveryDate || selectedOrder.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-slate-200 pt-2">
                    <div className="grid grid-cols-[1fr_auto] text-[10px] font-semibold text-slate-600">
                      <p>Item Description</p>
                      <p>Qty</p>
                    </div>
                    <div className="mt-1 space-y-1">
                      {selectedOrder.items?.map((item) => (
                        <div key={`receipt-mobile-${item.id}`} className="grid grid-cols-[1fr_auto] gap-2 text-[10px] text-slate-700">
                          <p className="leading-4 break-words">
                            {item.product?.name || 'Item'} ({item.product?.sku || '-'}) - {formatPeso(item.unitPrice)}
                          </p>
                          <p>{item.quantity}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 ml-auto w-[170px] space-y-1 text-[10px] text-slate-700">
                    <p className="flex justify-between border-t border-slate-300 pt-1 font-semibold text-slate-900">
                      <span>Total Price</span>
                      <span>{formatPeso(Number(selectedOrder.totalAmount || 0))}</span>
                    </p>
                  </div>

                  <p className="mt-6 text-center text-[9px] text-slate-500">
                    This receipt serves as proof of payment and delivery. Thank you for your purchase.
                  </p>
                </div>
              </div>

              <div className="border-t bg-white p-3">
                <Button
                  type="button"
                  className="h-11 w-full bg-rose-500 text-white hover:bg-rose-600"
                  onClick={() => downloadReceipt(selectedOrder)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={!!ratingDialogOrder} onOpenChange={(open) => !open && setRatingDialogOrder(null)}>
        {ratingDialogOrder && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rate Order {ratingDialogOrder.orderNumber}</DialogTitle>
              <DialogDescription>Share your delivery experience.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-1 text-amber-500">
                {Array.from({ length: 5 }).map((_, index) => {
                  const value = index + 1
                  const isActive = value <= ratingValue
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRatingValue(value)}
                      className={`rounded p-1 ${isActive ? 'text-amber-500' : 'text-gray-300'}`}
                      title={`${value} star${value > 1 ? 's' : ''}`}
                    >
                      <Star className="h-6 w-6 fill-current" />
                    </button>
                  )
                })}
                <span className="ml-2 text-sm font-medium text-slate-700">{ratingValue}/5</span>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rating-message">Feedback</Label>
                <Textarea
                  id="rating-message"
                  placeholder="Tell us about your delivery experience..."
                  value={ratingMessage}
                  onChange={(e) => setRatingMessage(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setRatingDialogOrder(null)} disabled={isSubmittingRating}>
                  Cancel
                </Button>
                <Button onClick={() => void submitRating()} disabled={isSubmittingRating}>
                  {isSubmittingRating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Submit Rating
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-cyan-100 bg-white/95 shadow-lg backdrop-blur">
        <div className="grid grid-cols-3 py-2">
          <Button variant="ghost" className={`flex-col gap-1 h-auto py-2 ${activeView === 'home' ? 'text-teal-700' : 'text-gray-500'}`} onClick={() => setActiveView('home')}>
            <Home className="h-5 w-5" />
            <span className="text-xs">Home</span>
          </Button>
          <Button variant="ghost" className={`flex-col gap-1 h-auto py-2 ${activeView === 'orders' ? 'text-teal-700' : 'text-gray-500'}`} onClick={() => setActiveView('orders')}>
            <Package className="h-5 w-5" />
            <span className="text-xs">Orders</span>
          </Button>
          <Button variant="ghost" className={`flex-col gap-1 h-auto py-2 ${activeView === 'profile' ? 'text-teal-700' : 'text-gray-500'}`} onClick={() => setActiveView('profile')}>
            <User className="h-5 w-5" />
            <span className="text-xs">Profile</span>
          </Button>
        </div>
      </nav>
    </div>
  )
}
