'use client'

import { useMemo, useState, useEffect } from 'react'
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
import { Bell, Camera, ChevronRight, Loader2, LogOut, MapPin, PencilLine, ShieldCheck, Lock, CreditCard, HelpCircle, MessageSquare, Info, Leaf, Phone, ArrowLeft, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

type CustomerProfileViewProps = {
  avatarPreviewUrl: string | null
  profileName: string
  setProfileName: (value: string) => void
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
}: CustomerProfileViewProps) {
  const resolvedAvatarPreviewUrl = resolveClientImageUrl(avatarPreviewUrl)
  const [subView, setSubView] = useState<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'security-settings' | 'notifications' | 'real-notifications'>(initialSubView ?? 'menu')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('customer_2fa_enabled')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('customer_login_alerts_enabled')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })
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
  const [isOtpDialogOpen, setIsOtpDialogOpen] = useState(false)
  const [otpExpiry, setOtpExpiry] = useState(120)
  const [resendCooldown, setResendCooldown] = useState(60)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    if (isOtpDialogOpen) {
      interval = setInterval(() => {
        setOtpExpiry((prev) => (prev > 0 ? prev - 1 : 0))
        setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isOtpDialogOpen])

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

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
      setIsOtpDialogOpen(true)
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
      setIsOtpDialogOpen(false)
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
    return !phoneError && profilePhone.length > 0 && profileName.trim().length > 0
  }, [phoneError, profilePhone, profileName])

  const handleSaveProfile = async () => {
    if (!canSaveProfile) return
    const success = await saveProfile()
    if (success) {
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success) {
        setUnreadCount(0)
        setRealNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
        toast.success('Marked all as read')
      }
    } catch (error) {
      console.error(error)
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
            {realNotifications.map((n, idx) => (
              <div
                key={n.id || idx}
                className={`flex gap-3 px-4 py-4 transition-colors ${
                  !n.isRead ? 'bg-[#f4faf6]' : 'bg-white'
                } ${idx < realNotifications.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                  !n.isRead ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                }`}>
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${!n.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                      {n.title || 'Alert'}
                    </p>
                    <span className="text-[10px] text-slate-400 font-medium shrink-0 pt-0.5">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {n.message || n.content || ''}
                  </p>
                </div>
              </div>
            ))}
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
            <Button
              type="button"
              size="icon"
              className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-[#14532d] p-0 text-white hover:bg-[#0f3f22] shadow-md border-2 border-white"
              onClick={() => avatarInputRef.current?.click()}
              disabled={isSavingProfile}
            >
              <Camera className="h-3 w-3" />
            </Button>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">Tap avatar to change photo</p>
        </div>
        <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-profile-name" className="text-sm font-semibold text-slate-700">Full Name</Label>
            <Input
              id="customer-profile-name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Enter your full name"
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
            />
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
            />
            {phoneError && <p className="text-xs text-red-600 font-medium">{phoneError}</p>}
          </div>
          <div className="space-y-2.5 rounded-2xl border border-emerald-100 bg-[#f9fdfa] p-4">
            <Label className="text-sm font-semibold text-[#14532d]">Delivery Address</Label>
            <p className="text-sm text-slate-700 font-medium">{composedShippingAddress || 'Not set'}</p>
            <p className="text-xs text-slate-400">
              {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'} ${shippingZipCode || ''}`.trim() : 'City/Province not set'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full h-10 mt-1 rounded-xl border-emerald-200 bg-white text-[#14532d] hover:bg-[#eef8f2] hover:text-[#14532d] font-semibold"
              onClick={() => setIsAddressDialogOpen(true)}
            >
              <MapPin className="h-4 w-4 mr-2" />
              Change Delivery Address
            </Button>
          </div>
        </div>
        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={handleSaveProfile}
            disabled={isSavingProfile || !canSaveProfile}
            className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
          >
            {isSavingProfile ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving Changes...
              </>
            ) : (
              'Save Changes'
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
              onClick={() => {
                const next = !twoFactorEnabled
                setTwoFactorEnabled(next)
                if (typeof window !== 'undefined') localStorage.setItem('customer_2fa_enabled', String(next))
                toast.success(next ? '2FA Authentication enabled' : '2FA Authentication disabled')
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                twoFactorEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
              }`}
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
              onClick={() => {
                const next = !loginAlertsEnabled
                setLoginAlertsEnabled(next)
                if (typeof window !== 'undefined') localStorage.setItem('customer_login_alerts_enabled', String(next))
                toast.success(next ? 'Login alerts enabled' : 'Login alerts disabled')
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                loginAlertsEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
              }`}
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
              onClick={() => {
                const next = !rememberDeviceEnabled
                setRememberDeviceEnabled(next)
                if (typeof window !== 'undefined') localStorage.setItem('customer_remember_device_enabled', String(next))
                toast.success(next ? 'Device remembering enabled' : 'Device remembering disabled')
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                rememberDeviceEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${rememberDeviceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
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
                <RequirementRow label="Min 8 characters" met={newPassword.length >= 8} />
                <RequirementRow label="Uppercase letter" met={/[A-Z]/.test(newPassword)} />
                <RequirementRow label="Lowercase letter" met={/[a-z]/.test(newPassword)} />
                <RequirementRow label="One number" met={/\d/.test(newPassword)} />
                <RequirementRow label="Special character" met={/[^A-Za-z0-9\s]/.test(newPassword)} />
                <RequirementRow label="No spaces" met={newPassword.length > 0 && !/\s/.test(newPassword)} />
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
                onClick={requestPasswordOtp}
                disabled={isSendingOtp}
                className="w-full h-11 rounded-xl bg-[#14532d] hover:bg-[#0f3f22] text-white font-semibold shadow-sm transition-colors"
              >
                {isSendingOtp ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending OTP...
                  </>
                ) : otpSent ? (
                  'Resend Verification OTP'
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
        <Dialog open={isOtpDialogOpen} onOpenChange={setIsOtpDialogOpen}>
          <DialogContent className="max-w-[90vw] sm:max-w-md border-slate-100 bg-white/95 rounded-3xl p-5 shadow-xl">
            <DialogHeader className="flex flex-col items-center text-center">
              <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center mb-2">
                <Lock className="h-5 w-5" />
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900">Enter Verification Code</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                We sent a 6-digit verification code to <span className="font-semibold text-slate-700">{profileEmail || user?.email}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Inline Error Box inside Popup Dialog */}
              {otpError && (
                <div className="text-xs font-semibold text-red-600 text-center bg-red-50 border border-red-100 rounded-xl py-2 px-3">
                  {otpError}
                </div>
              )}

              <div className="flex flex-col items-center space-y-3">
                <div className="flex justify-center gap-1.5 sm:gap-2" onPaste={handleOtpPaste}>
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
                      className="w-9 h-11 sm:w-11 sm:h-13 text-center text-lg sm:text-xl font-bold rounded-xl border border-slate-200 focus:border-[#14532d] focus:outline-none focus:ring-2 focus:ring-emerald-100 bg-white text-slate-800 transition-all placeholder:text-slate-300"
                    />
                  ))}
                </div>
                
                {otpExpiry > 0 ? (
                  <p className="text-xs font-semibold text-slate-500">
                    Code expires in <span className="text-[#14532d] font-bold">{formatTime(otpExpiry)}</span>
                  </p>
                ) : (
                  <p className="text-xs font-bold text-red-500">
                    Verification code has expired.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  onClick={verifyPasswordOtp}
                  disabled={isVerifyingOtp || otp.length < 6 || otpExpiry === 0}
                  className="w-full h-11 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22]"
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

                <div className="text-center">
                  {resendCooldown > 0 ? (
                    <span className="text-xs text-slate-400 font-medium">
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
              </div>
            </div>
          </DialogContent>
        </Dialog>
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

    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
        <div className="flex items-center gap-3 px-4 pt-5 pb-1">
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

        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          <div className="border-b border-slate-100 px-4 py-3.5">
            <h3 className="text-[15px] font-bold text-slate-900">Empty Bottles</h3>
            <p className="mt-0.5 text-xs text-slate-500">Outstanding bottles and the deposit for each bottle.</p>
          </div>

          {bottleBalances.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {bottleBalances.map((balance: any) => (
                <div key={balance.containerTypeId} className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{balance.containerTypeName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Deposit per bottle: <span className="font-semibold text-emerald-700">{formatDeposit(balance.depositAmount)}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-slate-900">{Number(balance.bottlesOutstanding) || 0}</p>
                    <p className="text-xs text-slate-500">empty bottles</p>
                    <p className="mt-1 text-xs font-semibold text-emerald-700">{formatDeposit(balance.depositBalance)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No outstanding empty bottles.</p>
          )}
        </div>
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
          <Button
            type="button"
            size="icon"
            className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-[#14532d] p-0 text-white hover:bg-[#0f3f22] shadow-md border-2 border-white"
            onClick={() => avatarInputRef.current?.click()}
            disabled={isSavingProfile}
          >
            <Camera className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-slate-900 truncate">{profileName || user?.name || ''}</h3>
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
