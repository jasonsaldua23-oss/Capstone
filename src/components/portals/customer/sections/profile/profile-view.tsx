'use client'

import { getPasswordRequirementState } from '@shared/customer-logic/password'
import {
  OTP_EXPIRY_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  formatOtpCountdown,
} from '@shared/customer-logic/otp'

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import type { MutableRefObject } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveClientImageUrl } from '@/lib/client-image'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
import { Bell, Camera, ChevronRight, Clock, Loader2, LogOut, MapPin, Package, PencilLine, ShieldCheck, Lock, CreditCard, HelpCircle, MessageSquare, Info, Leaf, Phone, ArrowLeft, KeyRound, Minus, Plus, Recycle } from 'lucide-react'
import { toast } from 'sonner'

export function formatFullName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
  suffix?: string | null,
  fallback?: string
): string {
  const first = (firstName || '').trim()
  const middle = (middleName || '').trim()
  const last = (lastName || '').trim()
  const suf = (suffix || '').trim()

  const parts: string[] = []
  if (first) parts.push(first)
  if (middle) {
    const cleanM = middle.replace(/\.+$/, '')
    if (cleanM) {
      parts.push(`${cleanM.charAt(0).toUpperCase()}.`)
    }
  }
  if (last) parts.push(last)

  let result = parts.join(' ')
  if (suf) {
    result = result ? `${result} ${suf}` : suf
  }
  return result || fallback || ''
}

type CustomerProfileViewProps = {
  avatarPreviewUrl: string | null
  profileName: string
  setProfileName: (value: string) => void
  profileFirstName: string
  setProfileFirstName: (value: string) => void
  profileMiddleName: string
  setProfileMiddleName: (value: string) => void
  profileLastName: string
  setProfileLastName: (value: string) => void
  profileSuffix?: string
  setProfileSuffix?: (value: string) => void
  profileEmail: string
  setProfileEmail: (value: string) => void
  profilePhone: string
  setProfilePhone: (value: string) => void
  composedShippingAddress: string
  shippingCity: string
  shippingProvince: string
  shippingZipCode: string
  user: any
  isSavingProfile: boolean
  avatarInputRef: MutableRefObject<HTMLInputElement | null>
  openAvatarCropDialog: (file: File | null) => Promise<void>
  setIsProfileDialogOpen: (value: boolean) => void
  setIsAddressDialogOpen: (value: boolean) => void
  onLogout: () => Promise<void>
  saveProfile: () => Promise<boolean>
  initialSubView?: 'real-notifications' | 'menu'
  onUnreadCountChange?: (count: number) => void
  onDidMount?: () => void
  onUserUpdate?: (user: any) => void
  onNavigateNotification?: (notification: any) => void
}

type NotificationPrefs = {
  orderUpdates: boolean
  deliveryUpdates: boolean
  systemAlerts: boolean
}

const CUSTOMER_NOTIFICATION_PREFS_KEY = 'customer_portal_notification_preferences'

function timeAgo(dateString: string) {
  try {
    const now = new Date()
    const past = new Date(dateString)
    const diffMs = now.getTime() - past.getTime()
    if (Number.isNaN(diffMs)) return ''
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    return past.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function CustomerProfileView({
  avatarPreviewUrl,
  profileName,
  setProfileName,
  profileFirstName,
  setProfileFirstName,
  profileMiddleName,
  setProfileMiddleName,
  profileLastName,
  setProfileLastName,
  profileSuffix = '',
  setProfileSuffix,
  profileEmail,
  setProfileEmail,
  profilePhone,
  setProfilePhone,
  composedShippingAddress,
  shippingCity,
  shippingProvince,
  shippingZipCode,
  user,
  isSavingProfile,
  avatarInputRef,
  openAvatarCropDialog,
  setIsProfileDialogOpen,
  setIsAddressDialogOpen,
  onLogout,
  saveProfile,
  initialSubView,
  onUnreadCountChange,
  onDidMount,
  onUserUpdate,
  onNavigateNotification,
}: CustomerProfileViewProps) {
  const resolvedAvatarPreviewUrl = resolveClientImageUrl(avatarPreviewUrl)
  const [subView, setSubView] = useState<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>(initialSubView ?? 'menu')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isEditingSecurity, setIsEditingSecurity] = useState(false)

  // Empty Bottles Recording State
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false)
  const [eligibleProducts, setEligibleProducts] = useState<any[]>([])
  const [isLoadingEligible, setIsLoadingEligible] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [recordCases, setRecordCases] = useState(1)
  const [isSubmittingEmpties, setIsSubmittingEmpties] = useState(false)
  const [emptiesTab, setEmptiesTab] = useState<'available' | 'reserved'>('available')
  const [reservedOrders, setReservedOrders] = useState<any[]>([])
  const [isLoadingReserved, setIsLoadingReserved] = useState(false)
  const lastFetchedReservedRef = useRef<number>(0)
  const isFetchingReservedRef = useRef<boolean>(false)

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
          return hasItemEmpties
        })
        setReservedOrders(activeWithEmpties)
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
          setSelectedProductId(data.eligibleItems[0].productId)
          setRecordCases(1)
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
    if (recordCases <= 0 || recordCases > selectedItem.availableCasesToReturn) {
      toast.error(`Please enter a valid case quantity (1 to ${selectedItem.availableCasesToReturn})`)
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
          cases: recordCases,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        toast.success(data.message || `Recorded ${recordCases} empty case(s) successfully!`)
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

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean(user?.twoFactorEnabled ?? user?.two_factor_enabled))
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(Boolean(user?.loginAlertsEnabled ?? user?.login_alerts_enabled ?? true))
  const [isSavingSecurity, setIsSavingSecurity] = useState(false)
  const [rememberDeviceEnabled, setRememberDeviceEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('customer_remember_device_enabled')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const saveSecuritySetting = async (field: 'twoFactorEnabled' | 'loginAlertsEnabled', value: boolean) => {
    const customerId = String(user?.userId || user?.id || '').trim()
    if (!customerId) return toast.error('Customer account is unavailable')
    setIsSavingSecurity(true)
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ [field]: value }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to save security setting')
      if (field === 'twoFactorEnabled') setTwoFactorEnabled(value)
      else setLoginAlertsEnabled(value)
      onUserUpdate?.({ ...user, ...payload.customer })
      toast.success(field === 'twoFactorEnabled' ? `2FA ${value ? 'enabled' : 'disabled'}` : `Login alerts ${value ? 'enabled' : 'disabled'}`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save security setting')
    } finally {
      setIsSavingSecurity(false)
    }
  }
  const [otp, setOtp] = useState('')
  const [otpVals, setOtpVals] = useState<string[]>(Array(6).fill(''))
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

  // Real Notifications State
  const [realNotifications, setRealNotifications] = useState<any[]>([])
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchRealNotifications = async () => {
    setIsLoadingNotifications(true)
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success) {
        setRealNotifications(payload.notifications || [])
        const count = payload.unreadCount || 0
        setUnreadCount(count)
        onUnreadCountChange?.(count)
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setIsLoadingNotifications(false)
    }
  }

  // Fetch count on component mount
  useEffect(() => {
    fetchRealNotifications()
    onDidMount?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Inline OTP Error inside dialog
  const [otpError, setOtpError] = useState<string | null>(null)

  // OTP Popup Timers
  const [otpExpiry, setOtpExpiry] = useState(OTP_EXPIRY_SECONDS)
  const [resendCooldown, setResendCooldown] = useState(OTP_RESEND_COOLDOWN_SECONDS)

  useEffect(() => {
    // Both counters run from the moment a code is sent, not only while the entry step
    // is on screen — leaving it and coming back must not hand back a fresh two minutes.
    if (!otpSent) return
    const interval = setInterval(() => {
      setOtpExpiry((prev) => (prev > 0 ? prev - 1 : 0))
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [otpSent])

  const [notifications, setNotifications] = useState<NotificationPrefs>(() => {
    if (typeof window === 'undefined') {
      return { orderUpdates: true, deliveryUpdates: true, systemAlerts: true }
    }
    try {
      const raw = window.localStorage.getItem(CUSTOMER_NOTIFICATION_PREFS_KEY)
      if (!raw) return { orderUpdates: true, deliveryUpdates: true, systemAlerts: true }
      const parsed = JSON.parse(raw)
      return {
        orderUpdates: parsed?.orderUpdates ?? true,
        deliveryUpdates: parsed?.deliveryUpdates ?? true,
        systemAlerts: parsed?.systemAlerts ?? true,
      }
    } catch {
      return { orderUpdates: true, deliveryUpdates: true, systemAlerts: true }
    }
  })

  const initials = useMemo(() => {
    const source = String(profileName || user?.name || '').trim()
    if (!source) return 'C'
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
  }, [profileName, user?.name])

  const persistNotifications = (nextValue: NotificationPrefs) => {
    setNotifications(nextValue)
    window.localStorage.setItem(CUSTOMER_NOTIFICATION_PREFS_KEY, JSON.stringify(nextValue))
  }

  const formatTime = formatOtpCountdown

  const requestPasswordOtp = async () => {
    const email = String(profileEmail || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    setIsSendingOtp(true)
    setOtpError(null)
    try {
      const response = await fetch('/api/auth/password-reset/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, accountType: 'customer' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      setOtpSent(true)
      setOtpVerified(false)
      setOtp('')
      setOtpVals(Array(6).fill(''))
      setOtpExpiry(120)
      setResendCooldown(60)
      setSubView('change-password-otp')
      toast.success('Verification OTP code sent')
      setTimeout(() => {
        document.getElementById('otp-input-0')?.focus()
      }, 150)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
    } finally {
      setIsSendingOtp(false)
    }
  }

  const verifyPasswordOtp = async () => {
    const email = String(profileEmail || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    if (!otp.trim()) {
      setOtpError('Enter OTP first')
      return
    }
    setIsVerifyingOtp(true)
    setOtpError(null)
    try {
      const response = await fetch('/api/auth/password-reset/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, accountType: 'customer', otp: otp.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Invalid or expired OTP')
      }
      setOtpVerified(true)
      // Nothing left to type, so hand the form back.
      setSubView('change-password')
      toast.success('OTP verified successfully')
    } catch (error: any) {
      setOtpVerified(false)
      setOtpError(error?.message || 'Invalid or expired OTP')
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const updatePassword = async () => {
    const email = String(profileEmail || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    if (!newPassword || !confirmPassword) {
      toast.error('Fill all password fields')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match')
      return
    }
    const passwordError = validatePasswordPolicy(newPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }
    if (!otp.trim()) {
      toast.error('Enter OTP first')
      return
    }
    if (!otpVerified) {
      toast.error('Verify OTP before changing password')
      return
    }
    setIsUpdatingPassword(true)
    try {
      const response = await fetch('/api/auth/password-reset/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          accountType: 'customer',
          otp: otp.trim(),
          newPassword,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update password')
      }
      toast.success('Password updated successfully')
      setSubView('menu')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const handleLogoutConfirm = async () => {
    setIsLoggingOut(true)
    try {
      await onLogout()
      setLogoutOpen(false)
    } finally {
      setIsLoggingOut(false)
    }
  }

  const phoneError = useMemo(() => {
    if (!profilePhone || profilePhone.length === 0) return null
    if (!isValidPhilippinePhone(profilePhone)) {
      return 'Please enter a valid Philippine mobile number (e.g. 09171234567)'
    }
    return null
  }, [profilePhone])

  const canSaveProfile = useMemo(() => {
    return !phoneError && profilePhone.length > 0 && profileFirstName.trim().length > 0 && profileLastName.trim().length > 0
  }, [phoneError, profilePhone, profileFirstName, profileLastName])

  const handleSaveProfile = async () => {
    if (!canSaveProfile) return
    const success = await saveProfile()
    if (success) {
      // Added: reopen the profile in read-only mode after a successful save.
      setIsEditingProfile(false)
      setSubView('menu')
    }
  }

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    await requestPasswordOtp()
  }

  // Multi-box OTP input handlers
  const handleOtpChange = (value: string, idx: number) => {
    setOtpError(null)
    const cleanVal = value.replace(/\D/g, '').slice(-1)
    const nextVals = [...otpVals]
    nextVals[idx] = cleanVal
    setOtpVals(nextVals)
    setOtp(nextVals.join(''))

    if (cleanVal && idx < 5) {
      document.getElementById(`otp-input-${idx + 1}`)?.focus()
    }
  }

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace') {
      if (!otpVals[idx] && idx > 0) {
        const prevInput = document.getElementById(`otp-input-${idx - 1}`)
        prevInput?.focus()
      }
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    setOtpError(null)
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pastedData.length === 6) {
      const nextVals = pastedData.split('')
      setOtpVals(nextVals)
      setOtp(pastedData)
      document.getElementById('otp-input-5')?.focus()
    }
  }

  // Actions for real notifications
  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications', {
        // Fix: the notifications endpoint marks records read through PATCH.
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success) {
        setUnreadCount(0)
        onUnreadCountChange?.(0)
        setRealNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
        toast.success('Marked all as read')
      } else {
        toast.error(payload?.error || 'Failed to mark notifications as read')
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to mark notifications as read')
    }
  }

  const clearAllNotifications = async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success) {
        setRealNotifications([])
        setUnreadCount(0)
        toast.success('Cleared all notifications')
      }
    } catch (error) {
      console.error(error)
    }
  }

  if (subView === 'real-notifications') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center justify-between px-4 pt-5 pb-1">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
              onClick={() => {
                setSubView('menu')
                fetchRealNotifications()
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Notifications</h2>
          </div>
          {realNotifications.length > 0 && (
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-xs font-bold text-[#14532d] hover:underline"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={clearAllNotifications}
                className="text-xs font-bold text-red-600 hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {isLoadingNotifications ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-[#14532d]" />
            <p className="text-sm font-medium text-slate-400">Loading notifications...</p>
          </div>
        ) : realNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-50 text-[#14532d] grid place-items-center mb-4">
              <Bell className="h-8 w-8" />
            </div>
            <h3 className="text-base font-bold text-slate-800">All caught up!</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
              No new alerts right now. We will notify you when something important occurs.
            </p>
          </div>
        ) : (
          <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
            {realNotifications.map((n, idx) => {
              const handleItemClick = () => {
                if (!n.isRead) {
                  setRealNotifications((prev) =>
                    prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item))
                  )
                  if (onUnreadCountChange) {
                    const nextUnread = Math.max(0, realNotifications.filter((item) => !item.isRead && item.id !== n.id).length)
                    onUnreadCountChange(nextUnread)
                  }
                  if (n.id) {
                    void fetch('/api/notifications', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ids: [n.id] }),
                    }).catch(() => {})
                  }
                }
                if (onNavigateNotification) {
                  onNavigateNotification(n)
                }
              }

              return (
                <div
                  key={n.id || idx}
                  role="button"
                  tabIndex={0}
                  onClick={handleItemClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleItemClick()
                    }
                  }}
                  className={`group flex items-center gap-3 px-4 py-4 cursor-pointer select-none transition-all hover:bg-emerald-50/70 active:scale-[0.99] ${
                    !n.isRead ? 'bg-[#f4faf6]' : 'bg-white'
                  } ${idx < realNotifications.length - 1 ? 'border-b border-slate-100' : ''}`}
                >
                  <div className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                    !n.isRead ? 'bg-emerald-100 text-emerald-800 shadow-xs' : 'bg-slate-100 text-slate-400'
                  }`}>
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm leading-snug group-hover:text-emerald-950 transition-colors ${!n.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                        {n.title || 'Alert'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-medium shrink-0 pt-0.5">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">
                      {n.message || n.content || ''}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-emerald-600 transition-all shrink-0 group-hover:translate-x-0.5" />
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (subView === 'edit') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('menu')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Edit Profile</h2>
        </div>
        <div className="flex flex-col items-center py-4 bg-white border-y border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="relative">
            <Avatar className="h-20 w-20 border-2 border-white shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
              {resolvedAvatarPreviewUrl ? (
                <AvatarImage src={resolvedAvatarPreviewUrl} alt={profileName || user?.name || 'Profile'} className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-teal-700 text-2xl font-bold text-white">{initials}</AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white shadow-md border-2 border-white hover:bg-teal-800 active:scale-95 transition"
              title="Change Avatar"
              disabled={isSavingProfile}
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload profile photo"
              title="Upload profile photo"
              onChange={(e) => {
                const file = e.target.files?.[0] || null
                if (avatarInputRef.current) {
                  avatarInputRef.current.value = ''
                }
                void openAvatarCropDialog(file)
              }}
            />
          </div>
          <p className="mt-2 text-base font-bold text-slate-900">
            {formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName || 'Your Name')}
          </p>
        </div>
        <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="customer-profile-first-name" className="text-sm font-semibold text-slate-700">First Name</Label>
              <Input id="customer-profile-first-name" value={profileFirstName} onChange={(e) => setProfileFirstName(e.target.value)} placeholder="First name" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-last-name" className="text-sm font-semibold text-slate-700">Last Name</Label>
              <Input id="customer-profile-last-name" value={profileLastName} onChange={(e) => setProfileLastName(e.target.value)} placeholder="Last name" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-middle-name" className="text-sm font-semibold text-slate-700">Middle Name</Label>
              <Input id="customer-profile-middle-name" value={profileMiddleName} onChange={(e) => setProfileMiddleName(e.target.value)} placeholder="Middle name" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-suffix" className="text-sm font-semibold text-slate-700">Suffix <span className="text-xs font-normal text-slate-400">(Optional)</span></Label>
              <Input id="customer-profile-suffix" value={profileSuffix} onChange={(e) => setProfileSuffix?.(e.target.value)} placeholder="e.g. Jr., Sr., III" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-profile-email" className="text-sm font-semibold text-slate-700">Email Address</Label>
            <Input
              id="customer-profile-email"
              type="email"
              value={profileEmail}
              onChange={(e) => setProfileEmail(e.target.value)}
              placeholder="Enter your email"
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
              disabled={!isEditingProfile}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-profile-phone" className="text-sm font-semibold text-slate-700">Phone Number</Label>
            <Input
              id="customer-profile-phone"
              value={profilePhone}
              onChange={(e) => {
                setProfilePhone(formatPhilippinePhoneInput(e.target.value))
              }}
              placeholder="09XX XXX XXXX"
              maxLength={13}
              inputMode="numeric"
              className={`h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200 ${
                phoneError ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-200' : ''
              }`}
              disabled={!isEditingProfile}
            />
            {phoneError && <p className="text-xs text-red-600 font-medium">{phoneError}</p>}
          </div>
          <div className="space-y-2.5 rounded-2xl border border-emerald-100 bg-[#f9fdfa] p-4">
            <Label className="text-sm font-semibold text-[#14532d]">Delivery Address</Label>
            <p className="text-sm text-slate-700 font-medium">{composedShippingAddress || 'Not set'}</p>
            <p className="text-xs text-slate-400">
              {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'} ${shippingZipCode || ''}`.trim() : 'City/Province not set'}
            </p>
            {/* Fix: keep address changes locked with the rest of the profile fields. */}
            <Button
              type="button"
              variant="outline"
              className="w-full h-10 mt-1 rounded-xl border-emerald-200 bg-white text-[#14532d] hover:bg-[#eef8f2] hover:text-[#14532d] font-semibold"
              onClick={() => setIsAddressDialogOpen(true)}
              disabled={!isEditingProfile}
            >
              <MapPin className="h-4 w-4 mr-2" />
              Change Delivery Address
            </Button>
          </div>
        </div>
        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={() => {
              if (isEditingProfile) {
                handleSaveProfile()
              } else {
                setIsEditingProfile(true)
              }
            }}
            disabled={isSavingProfile || !canSaveProfile}
            className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
          >
            {isSavingProfile ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving Changes...
              </>
            ) : isEditingProfile ? (
              'Save Changes'
            ) : (
              'Edit Profile'
            )}
          </Button>
        </div>
      </div>
    )
  }

  if (subView === 'account-security') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('menu')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Account Security</h2>
        </div>

        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          <button
            type="button"
            onClick={() => setSubView('change-password')}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 border-b border-slate-100 transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center shrink-0">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Change Password</p>
                <p className="text-xs text-slate-500 mt-0.5">Update your password with OTP verification</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setSubView('security-settings')}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Security Settings</p>
                <p className="text-xs text-slate-500 mt-0.5">Configure 2FA login verification and security alerts</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
          </button>
        </div>
      </div>
    )
  }

  if (subView === 'security-settings') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('account-security')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Security Settings</h2>
        </div>

        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] divide-y divide-slate-100">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 pr-4">
              <p className="text-sm font-semibold text-slate-900">Two-Factor Authentication (2FA)</p>
              <p className="text-xs text-slate-500 max-w-sm">Require a 6-digit OTP code when logging in to secure your account.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={twoFactorEnabled}
              disabled={isSavingSecurity || !isEditingSecurity}
              onClick={() => void saveSecuritySetting('twoFactorEnabled', !twoFactorEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                twoFactorEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
              } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 pr-4">
              <p className="text-sm font-semibold text-slate-900">Login Activity Alerts</p>
              <p className="text-xs text-slate-500 max-w-sm">Receive email notifications when your account is logged in from a new device.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={loginAlertsEnabled}
              disabled={isSavingSecurity || !isEditingSecurity}
              onClick={() => void saveSecuritySetting('loginAlertsEnabled', !loginAlertsEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                loginAlertsEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
              } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${loginAlertsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 pr-4">
              <p className="text-sm font-semibold text-slate-900">Remember Device Sessions</p>
              <p className="text-xs text-slate-500 max-w-sm">Keep trusted sessions active on your browser for faster access.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={rememberDeviceEnabled}
              disabled={!isEditingSecurity}
              onClick={() => {
                const next = !rememberDeviceEnabled
                setRememberDeviceEnabled(next)
                if (typeof window !== 'undefined') localStorage.setItem('customer_remember_device_enabled', String(next))
                toast.success(next ? 'Device remembering enabled' : 'Device remembering disabled')
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                rememberDeviceEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
              } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${rememberDeviceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={() => setIsEditingSecurity(!isEditingSecurity)}
            disabled={isSavingSecurity}
            className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
          >
            {isEditingSecurity ? 'Save Security Settings' : 'Edit Security Settings'}
          </Button>
        </div>
      </div>
    )
  }

  if (subView === 'security' || subView === 'change-password') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('account-security')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Change Password</h2>
        </div>
        <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-new-password" className="text-sm font-semibold text-slate-700">New Password</Label>
            <Input
              id="customer-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
            />
            {/* Password Policy Real-time Verification Checklist */}
            <div className="mt-2 space-y-1 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Password Requirements</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1">
                {getPasswordRequirementState(newPassword).map((rule) => (
                  <RequirementRow key={rule.label} label={rule.label} met={rule.met} />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-confirm-password" className="text-sm font-semibold text-slate-700">Confirm Password</Label>
            <Input
              id="customer-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
            />
          </div>
          {/* Security Verification Card */}
          <div className="space-y-3 rounded-2xl border border-emerald-100 bg-[#f4faf6] p-4 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Security Verification</p>
              <p className="mt-0.5 text-xs text-slate-500 font-medium">OTP verification is required to change password.</p>
            </div>
            {otpVerified ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-emerald-800 text-sm font-semibold">
                <svg className="h-5 w-5 text-emerald-600 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                OTP Verified Successfully
              </div>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  // A live code is entered, not replaced — requesting again would reset
                  // the countdown the customer is already racing.
                  if (otpSent && otpExpiry > 0) {
                    setSubView('change-password-otp')
                    return
                  }
                  void requestPasswordOtp()
                }}
                disabled={isSendingOtp}
                className="w-full h-11 rounded-xl bg-[#14532d] hover:bg-[#0f3f22] text-white font-semibold shadow-sm transition-colors"
              >
                {isSendingOtp ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending OTP...
                  </>
                ) : otpSent && otpExpiry > 0 ? (
                  'Enter OTP'
                ) : (
                  'Request Verification OTP'
                )}
              </Button>
            )}
          </div>
        </div>
        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={updatePassword}
            disabled={isUpdatingPassword || !otpVerified || !newPassword || !confirmPassword}
            className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
          >
            {isUpdatingPassword ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating Password...
              </>
            ) : (
              'Update Password'
            )}
          </Button>
        </div>

        {/* OTP Dialog Popup */}
      </div>
    )
  }

  // Code entry is a page of its own, like every other OTP step in the portals and in
  // the mobile app. Reaching it never sends a code: Change Password sends one and
  // navigates here, or, while a code is still live, offers "Enter OTP" which comes
  // straight here and leaves the countdown running.
  if (subView === 'change-password-otp') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-white min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('change-password')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Enter Verification Code</h2>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-col items-center px-6">
          <div className="h-13 w-13 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center mb-2 p-3">
            <Lock className="h-6 w-6" />
          </div>
          <p className="mt-1 max-w-xs text-center text-[13px] leading-relaxed text-slate-500">
            We sent a 6-digit verification code to{' '}
            <span className="font-semibold text-slate-700">{profileEmail || user?.email}</span>
          </p>

          {otpError && (
            <div className="mt-4 w-full rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
              {otpError}
            </div>
          )}

          <div className="mt-5 flex w-full justify-center gap-2" onPaste={handleOtpPaste}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <input
                key={idx}
                id={`otp-input-${idx}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={otpVals[idx] || ''}
                placeholder={String(idx + 1)}
                onChange={(e) => handleOtpChange(e.target.value, idx)}
                onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                className="h-14 min-w-0 max-w-[52px] flex-1 rounded-xl border border-slate-200 bg-white text-center text-xl font-bold text-slate-800 transition-all placeholder:text-slate-300 focus:border-[#14532d] focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            ))}
          </div>

          <div className="mt-4 text-center">
            {otpExpiry > 0 ? (
              <p className="text-xs font-semibold text-slate-500">
                Code expires in <span className="text-[#14532d] font-bold">{formatTime(otpExpiry)}</span>
              </p>
            ) : (
              <p className="text-xs font-bold text-red-500">Verification code has expired.</p>
            )}
          </div>

          <Button
            type="button"
            onClick={verifyPasswordOtp}
            disabled={isVerifyingOtp || otp.length < 6 || otpExpiry === 0}
            className="mt-4 h-12 w-full rounded-xl bg-[#14532d] font-semibold text-white hover:bg-[#0f3f22]"
          >
            {isVerifyingOtp ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying Code...
              </>
            ) : (
              'Verify Code'
            )}
          </Button>

          <div className="mt-3 text-center">
            {resendCooldown > 0 ? (
              <span className="text-xs font-medium text-slate-400">
                Resend code in <span className="font-semibold">{resendCooldown}s</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={isSendingOtp}
                className="text-xs font-bold text-[#14532d] hover:underline"
              >
                {isSendingOtp ? 'Sending...' : 'Resend Code'}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSubView('change-password')}
            className="mt-5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
          >
            Back to Change Password
          </button>
        </div>
      </div>
    )
  }

  // Added: keep bottle balances out of the main profile and expose them from the profile menu.
  if (subView === 'empties-deposits') {
    const bottleBalances = Array.isArray(user?.bottleBalances) ? user.bottleBalances : []
    const formatDeposit = (amount: unknown) => new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
    }).format(Number(amount) || 0)

    const selectedItem = eligibleProducts.find((p) => p.productId === selectedProductId)

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

        {/* Navigation Tabs for Available vs Used/Reserved Deposits */}
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
            <span>Available Empties</span>
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
            <span>Used / Reserved Deposits</span>
            {reservedOrders.length > 0 && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                {reservedOrders.length}
              </span>
            )}
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
                  const containersPerCase = Math.max(1, Math.floor(Number(balance.containersPerCase || 1)))
                  const bottlesAvailable = Number.isFinite(Number(balance.bottlesAvailable))
                    ? Math.max(0, Math.floor(Number(balance.bottlesAvailable)))
                    : Math.max(0, Math.floor(Number(balance.bottlesOutstanding || 0)))
                  const casesAvailable = Number.isFinite(Number(balance.casesAvailable))
                    ? Math.max(0, Math.floor(Number(balance.casesAvailable)))
                    : Math.floor(bottlesAvailable / containersPerCase)
                  const looseBottlesAvailable = Number.isFinite(Number(balance.looseBottlesAvailable))
                    ? Math.max(0, Math.floor(Number(balance.looseBottlesAvailable)))
                    : bottlesAvailable % containersPerCase

                  const casesReserved = Number(balance.casesReserved || 0)
                  const looseReserved = Number(balance.looseBottlesReserved || 0)
                  const hasReserved = casesReserved > 0 || looseReserved > 0

                  const isCaseFormat = casesAvailable > 0 || (casesReserved > 0 && looseBottlesAvailable === 0)
                  const depositAmount = isCaseFormat ? balance.caseDepositAmount : balance.depositAmount
                  const depositUnit = isCaseFormat ? 'case' : 'bottle'
                  const depositAvailable = Number.isFinite(Number(balance.depositAvailable))
                    ? Number(balance.depositAvailable)
                    : (Number.isFinite(Number(balance.depositBalance)) ? Number(balance.depositBalance) : 0)

                  return (
                    <div key={balance.containerTypeId} className="px-4 py-3.5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          {/* Fix: show each exact stored product name with its size. */}
                          <p className="text-sm font-semibold leading-5 text-slate-800">
                            {balance.productLabel || balance.productName || balance.containerTypeName || 'Returnable container'}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Deposit value: <span className="font-semibold text-emerald-700">{formatDeposit(depositAmount)}/{depositUnit}</span>
                            {isCaseFormat && looseBottlesAvailable > 0 ? (
                              <span> · Loose: <span className="font-semibold text-emerald-700">{formatDeposit(balance.depositAmount)}/bottle</span></span>
                            ) : null}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-lg font-bold ${casesAvailable > 0 || looseBottlesAvailable > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                            {isCaseFormat ? casesAvailable : looseBottlesAvailable}
                          </p>
                          <p className="text-xs text-slate-500">
                            {isCaseFormat ? `empty case${casesAvailable !== 1 ? 's' : ''}` : `loose bottle${looseBottlesAvailable !== 1 ? 's' : ''}`} available
                          </p>
                          {isCaseFormat && looseBottlesAvailable > 0 ? (
                            <p className="text-[11px] text-slate-500">+ {looseBottlesAvailable} loose bottle{looseBottlesAvailable !== 1 ? 's' : ''}</p>
                          ) : null}
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
                            {casesReserved > 0 ? `${casesReserved} case${casesReserved !== 1 ? 's' : ''}` : ''}
                            {casesReserved > 0 && looseReserved > 0 ? ' + ' : ''}
                            {looseReserved > 0 ? `${looseReserved} bottle${looseReserved !== 1 ? 's' : ''}` : ''}
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
        ) : (
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
                  const totalDepositCovered = itemsWithEmpties.reduce((sum: number, item: any) => {
                    const refund = Number(item?.depositRefunded || item?.deposit_refunded || 0)
                    return sum + refund
                  }, 0) || Number(order?.depositRefundTotal || order?.deposit_refund_total || 0)

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
                          const depositRefund = Number(item?.depositRefunded || item?.deposit_refunded || 0) || (totalDepositCovered > 0 && itemsWithEmpties.length === 1 ? totalDepositCovered : 0)

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
        )}

        {/* Record Empty Bottles Dialog */}
        <Dialog open={isRecordModalOpen} onOpenChange={setIsRecordModalOpen}>
          <DialogContent className="sm:max-w-md rounded-3xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Recycle className="h-5 w-5 text-emerald-600" />
                Record Empty Bottle Cases
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Declare empty returnable cases from your past orders to automatically waive container deposits at checkout.
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
                      setRecordCases(1)
                    }}
                  >
                    {eligibleProducts.map((prod) => (
                      <option key={prod.productId} value={prod.productId}>
                        {prod.productName} ({prod.availableCasesToReturn} case{prod.availableCasesToReturn > 1 ? 's' : ''} available)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedItem ? (
                  <>
                    {/* Case Quantity Stepper */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-slate-700">Number of Cases to Return</Label>
                        <span className="text-[11px] font-medium text-emerald-700">
                          Max available: {selectedItem.availableCasesToReturn} case(s)
                        </span>
                      </div>

                      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-2">
                        <span className="text-xs font-medium text-slate-600 pl-2">
                          {recordCases} case{recordCases > 1 ? 's' : ''} ({recordCases * selectedItem.containersPerCase} bottles)
                        </span>

                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8 rounded-xl bg-white border-slate-200"
                            disabled={recordCases <= 1}
                            onClick={() => setRecordCases((prev) => Math.max(1, prev - 1))}
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
                            onClick={() => setRecordCases((prev) => Math.min(selectedItem.availableCasesToReturn, prev + 1))}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Deposit Preview Card */}
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-semibold text-emerald-900">
                        <span>Deposit Credit to Apply:</span>
                        <span className="text-sm font-bold text-emerald-700">
                          {formatDeposit(recordCases * selectedItem.caseDeposit)}
                        </span>
                      </div>
                      <p className="text-[11px] text-emerald-800 leading-snug">
                        ✓ At checkout, the system will automatically detect these {recordCases} empty case(s) to waive the container deposit fee.
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
                        disabled={isSubmittingEmpties}
                        onClick={handleRecordEmpties}
                      >
                        {isSubmittingEmpties ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Recording...
                          </>
                        ) : (
                          `Record ${recordCases} Case${recordCases > 1 ? 's' : ''}`
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

  if (subView === 'notifications') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
            onClick={() => setSubView('menu')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Notification Settings</h2>
        </div>
        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          <NotificationRow
            title="Order Updates"
            description="Receive changes to request and order status."
            checked={notifications.orderUpdates}
            onToggle={() => persistNotifications({ ...notifications, orderUpdates: !notifications.orderUpdates })}
          />
          <NotificationRow
            title="Delivery Updates"
            description="Receive delivery and live tracking updates."
            checked={notifications.deliveryUpdates}
            onToggle={() => persistNotifications({ ...notifications, deliveryUpdates: !notifications.deliveryUpdates })}
          />
          <NotificationRow
            title="System Alerts"
            description="Receive important customer announcements."
            checked={notifications.systemAlerts}
            onToggle={() => persistNotifications({ ...notifications, systemAlerts: !notifications.systemAlerts })}
          />
        </div>
      </div>
    )
  }

  const menuItems = [
    {
      icon: <PencilLine className="h-5 w-5 text-[#14532d]" />,
      title: 'Edit Profile',
      onClick: () => setSubView('edit'),
    },
    {
      icon: <CreditCard className="h-5 w-5 text-[#14532d]" />,
      title: 'Empties & Deposits',
      onClick: () => setSubView('empties-deposits'),
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-[#14532d]" />,
      title: 'Account Security',
      onClick: () => setSubView('account-security'),
    },
    {
      icon: <Bell className="h-5 w-5 text-[#14532d]" />,
      title: 'Notification Settings',
      onClick: () => setSubView('notifications'),
    },
    {
      icon: <MapPin className="h-5 w-5 text-[#14532d]" />,
      title: 'Address',
      onClick: () => setIsAddressDialogOpen(true),
    },
  ]

  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
      <div className="flex items-center justify-between px-4 pt-5 pb-1">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Profile</h2>
      </div>

      <div className="flex items-center gap-4 px-4 py-3">
        <div className="relative">
          <Avatar className="h-20 w-20 border-2 border-white shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
            {resolvedAvatarPreviewUrl ? (
              <AvatarImage src={resolvedAvatarPreviewUrl} alt={profileName || user?.name || 'Profile'} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-teal-700 text-2xl font-bold text-white">{initials}</AvatarFallback>
          </Avatar>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Upload profile photo"
            title="Upload profile photo"
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (avatarInputRef.current) {
                avatarInputRef.current.value = ''
              }
              void openAvatarCropDialog(file)
            }}
          />
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white shadow-md border-2 border-white hover:bg-teal-800 active:scale-95 transition"
            title="Change Avatar"
            disabled={isSavingProfile}
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-slate-900 truncate">
            {formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName || user?.name || '')}
          </h3>
          <p className="text-sm text-slate-500 truncate">
            {[profileFirstName, profileMiddleName ? `${profileMiddleName.replace(/\.+$/, '').charAt(0).toUpperCase()}.` : '', profileLastName, profileSuffix].filter(Boolean).join(' ') || 'Name details not set'}
          </p>
          <p className="text-sm text-slate-500 truncate mt-0.5">{profileEmail || user?.email || ''}</p>
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#eef8f2] px-2.5 py-0.5 text-xs font-semibold text-[#14532d]">
            <Phone className="h-3 w-3" />
            {profilePhone || user?.phone || user?.contactNumber || user?.mobile || 'No phone number'}
          </span>
        </div>
      </div>

      <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
        {menuItems.map((item, idx) => (
          <button
            key={item.title}
            type="button"
            onClick={item.onClick}
            className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors ${
              idx < menuItems.length - 1 ? 'border-b border-slate-100' : ''
            }`}
          >
            {item.icon}
            <span className="flex-1 text-[15px] font-semibold text-slate-800">{item.title}</span>
            <ChevronRight className="h-5 w-5 text-slate-300 ml-auto" />
          </button>
        ))}
      </div>

      <div className="mx-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-red-50/50 transition-colors"
        >
          <LogOut className="h-5 w-5 text-red-500" />
          <span className="flex-1 text-[15px] font-semibold text-red-600">Log Out</span>
          <ChevronRight className="h-5 w-5 text-slate-300 ml-auto" />
        </button>
      </div>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log Out Account?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to log out of your account?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoggingOut}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void handleLogoutConfirm() }} className="bg-red-600 hover:bg-red-700" disabled={isLoggingOut}>
              {isLoggingOut ? 'Logging Out...' : 'Log Out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function NotificationRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string
  description: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-none border-b border-slate-100 bg-white px-4 py-3.5 last:border-b-0 hover:bg-slate-50/30">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
      <button type="button" onClick={onToggle} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-[#14532d]' : 'bg-slate-200'}`} aria-pressed={checked}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? 'left-5.5' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

function RequirementRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-1 py-0.5">
      {met ? (
        <span className="text-emerald-500 font-bold text-xs select-none">✓</span>
      ) : (
        <span className="text-red-500 font-bold text-xs select-none">✗</span>
      )}
      <span className={`text-[10px] font-medium leading-none ${met ? 'text-emerald-700' : 'text-slate-400'}`}>
        {label}
      </span>
    </div>
  )
}
