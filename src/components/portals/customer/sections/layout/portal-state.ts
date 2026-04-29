'use client'

import { useRef, useState } from 'react'

export function useCustomerPortalState(user: any) {
  const [activeView, setActiveView] = useState('home')
  const [orders, setOrders] = useState<any[]>([])
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const isRefreshingOrdersRef = useRef(false)

  const [products, setProducts] = useState<any[]>([])
  const [isProductsLoading, setIsProductsLoading] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [isAddToCartDialogOpen, setIsAddToCartDialogOpen] = useState(false)
  const [pendingCartProduct, setPendingCartProduct] = useState<any | null>(null)
  const [pendingCartQty, setPendingCartQty] = useState('1')
  const [cart, setCart] = useState<any[]>([])
  const [selectedCartIds, setSelectedCartIds] = useState<Set<string>>(new Set())
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)

  const [shippingName, setShippingName] = useState(user?.name || '')
  const [shippingPhone, setShippingPhone] = useState('')
  const [shippingHouseNumber, setShippingHouseNumber] = useState('')
  const [shippingStreetName, setShippingStreetName] = useState('')
  const [shippingSubdivision, setShippingSubdivision] = useState('')
  const [shippingBarangay, setShippingBarangay] = useState('')
  const [shippingCity, setShippingCity] = useState('')
  const [shippingProvince, setShippingProvince] = useState('Negros Occidental')
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
  const [secondaryShippingProvince, setSecondaryShippingProvince] = useState('Negros Occidental')
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
  const [ordersTab, setOrdersTab] = useState('ALL')
  const [isSavingAddress, setIsSavingAddress] = useState(false)
  const [trackingByOrderId, setTrackingByOrderId] = useState<Record<string, any>>({})
  const [isTrackingLoading, setIsTrackingLoading] = useState(false)
  const [selectedTrackingOrderId, setSelectedTrackingOrderId] = useState<string | null>(null)
  const [, setDriverLocationLabelByOrderId] = useState<Record<string, string>>({})
  const reverseGeocodeCacheRef = useRef<Map<string, string>>(new Map())
  const deliveredTrackingSnapshotRef = useRef<Record<string, any>>({})
  const [reviewedOrderIds, setReviewedOrderIds] = useState<Set<string>>(new Set())
  const [orderRatings, setOrderRatings] = useState<Record<string, number>>({})
  const [deliveryIssueRecords, setDeliveryIssueRecords] = useState<any[]>([])
  const [ratingDialogOrder, setRatingDialogOrder] = useState<any | null>(null)
  const [deliveryRatingValue, setDeliveryRatingValue] = useState(5)
  const [satisfactionRatingValue, setSatisfactionRatingValue] = useState(5)
  const [ratingComment, setRatingComment] = useState('')
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
  const avatarCropImageRef = useRef<HTMLImageElement | null>(null)
  const [isDraggingCrop, setIsDraggingCrop] = useState(false)
  const cropDragRef = useRef<{
    active: boolean
    startX: number
    startY: number
    initialX: number
    initialY: number
  }>({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 })

  return {
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
    satisfactionRatingValue,
    setSatisfactionRatingValue,
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
  }
}
