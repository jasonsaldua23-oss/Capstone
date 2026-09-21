'use client'

import { useNativeBack } from '@/hooks/use-native-back'
import {
  OTP_EXPIRY_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  formatOtpCountdown,
} from '@shared/customer-logic/otp'
import { useMemo, useState, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { resolveClientImageUrl } from '@/lib/client-image'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { isValidPhilippinePhone } from '@/lib/philippine-phone'
import { Bell, Camera, ChevronRight, LogOut, MapPin, PencilLine, ShieldCheck, CreditCard, Phone, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useCustomerEmptiesDeposits } from './use-customer-empties-deposits'
import { EmptiesDepositsScreen } from './empties-deposits-screen'
import { ChangePasswordOtpScreen } from './change-password-otp-screen'
import { ChangePasswordScreen } from './change-password-screen'
import { SecuritySettingsScreen } from './security-settings-screen'
import { AccountSecurityScreen } from './account-security-screen'
import { EditProfileScreen } from './edit-profile-screen'
import { NotificationsScreen } from './notifications-screen'
import { CUSTOMER_NOTIFICATION_PREFS_KEY, type NotificationPrefs, NotificationRow, formatFullName } from './profile-shared'

type CustomerProfileViewProps = {
  avatarPreviewUrl: string | null
  profileName: string
  setProfileName: (value: string) => void
  profileFirstName: string
  setProfileFirstName: (value: string) => void
  profileMiddleName: string
  profileNoMiddleName: boolean
  setProfileMiddleName: (value: string) => void
  setProfileNoMiddleName: (value: boolean) => void
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
  /** Set when the bell opened this screen: Back leaves notifications instead of showing the menu. */
  onCloseNotifications?: () => void
  /** Restores the name/contact fields to the last saved profile. */
  discardProfileChanges?: () => void
}

export function CustomerProfileView({
  avatarPreviewUrl,
  profileName,
  setProfileName,
  profileFirstName,
  setProfileFirstName,
  profileMiddleName,
  profileNoMiddleName,
  setProfileMiddleName,
  setProfileNoMiddleName,
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
  onCloseNotifications,
  discardProfileChanges,
}: CustomerProfileViewProps) {
  const resolvedAvatarPreviewUrl = resolveClientImageUrl(avatarPreviewUrl)
  const [subView, setSubView] = useState<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>(initialSubView ?? 'menu')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isEditingSecurity, setIsEditingSecurity] = useState(false)

  // Fix: the form fields live in portal state, so leaving the editor without saving has
  // to put them back -- otherwise the unsaved name showed on the menu and reopened later.
  const leaveEditProfile = () => {
    setIsEditingProfile(false)
    discardProfileChanges?.()
    setSubView('menu')
  }

  // Fix: the notifications list only ever calls setSubView('menu') for Back. When the
  // bell opened it, Back returns to the view the customer came from instead.
  const setNotificationsSubView: typeof setSubView = (next) => {
    if (onCloseNotifications && next === 'menu') onCloseNotifications()
    else setSubView(next)
  }

  // Fix: the phone Back button follows the profile screen's existing parent views.
  useNativeBack(() => {
    if (subView === 'menu') return false
    if (subView === 'edit') leaveEditProfile()
    else if (subView === 'real-notifications' && onCloseNotifications) onCloseNotifications()
    else if (subView === 'change-password-otp') setSubView('change-password')
    else if (subView === 'change-password' || subView === 'security' || subView === 'security-settings') setSubView('account-security')
    else setSubView('menu')
    return true
  }, 10)

  const {
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
  } = useCustomerEmptiesDeposits({
    onUserUpdate,
    subView,
    user,
  })

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
    // Fix: edits left unsaved when the customer switched tabs mid-edit are dropped too.
    discardProfileChanges?.()
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

  // Fix: an empty phone (every Google sign-up) or an empty middle name used to fail this,
  // and it also disabled the button that *starts* editing -- so those customers could not
  // edit at all until an address save filled the phone in. The backend accepts both empty.
  const canSaveProfile = useMemo(() => {
    return !phoneError && profileFirstName.trim().length > 0 && profileLastName.trim().length > 0
  }, [phoneError, profileFirstName, profileLastName])

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
        onUnreadCountChange?.(0)
      }
    } catch (error) {
      console.error(error)
    }
  }

  if (subView === 'real-notifications') {
    return (
      <NotificationsScreen
        clearAllNotifications={clearAllNotifications}
        fetchRealNotifications={fetchRealNotifications}
        isLoadingNotifications={isLoadingNotifications}
        markAllAsRead={markAllAsRead}
        notifications={notifications}
        onNavigateNotification={onNavigateNotification}
        onUnreadCountChange={onUnreadCountChange}
        realNotifications={realNotifications}
        setRealNotifications={setRealNotifications}
        setSubView={setNotificationsSubView}
        setUnreadCount={setUnreadCount}
        unreadCount={unreadCount}
      />
    )
  }

  if (subView === 'edit') {
    return (
      <EditProfileScreen
        avatarInputRef={avatarInputRef}
        canSaveProfile={canSaveProfile}
        composedShippingAddress={composedShippingAddress}
        handleSaveProfile={handleSaveProfile}
        initials={initials}
        isEditingProfile={isEditingProfile}
        isSavingProfile={isSavingProfile}
        onBack={leaveEditProfile}
        openAvatarCropDialog={openAvatarCropDialog}
        phoneError={phoneError}
        profileEmail={profileEmail}
        profileFirstName={profileFirstName}
        profileLastName={profileLastName}
        profileMiddleName={profileMiddleName}
        profileNoMiddleName={profileNoMiddleName}
        profileName={profileName}
        profilePhone={profilePhone}
        profileSuffix={profileSuffix}
        resolvedAvatarPreviewUrl={resolvedAvatarPreviewUrl}
        setIsAddressDialogOpen={setIsAddressDialogOpen}
        setIsEditingProfile={setIsEditingProfile}
        setProfileEmail={setProfileEmail}
        setProfileFirstName={setProfileFirstName}
        setProfileLastName={setProfileLastName}
        setProfileMiddleName={setProfileMiddleName}
        setProfileNoMiddleName={setProfileNoMiddleName}
        setProfilePhone={setProfilePhone}
        setProfileSuffix={setProfileSuffix}
        shippingCity={shippingCity}
        shippingProvince={shippingProvince}
        shippingZipCode={shippingZipCode}
        user={user}
      />
    )
  }

  if (subView === 'account-security') {
    return (
      <AccountSecurityScreen
        setSubView={setSubView}
      />
    )
  }

  if (subView === 'security-settings') {
    return (
      <SecuritySettingsScreen
        isEditingSecurity={isEditingSecurity}
        isSavingSecurity={isSavingSecurity}
        loginAlertsEnabled={loginAlertsEnabled}
        notifications={notifications}
        rememberDeviceEnabled={rememberDeviceEnabled}
        saveSecuritySetting={saveSecuritySetting}
        setIsEditingSecurity={setIsEditingSecurity}
        setRememberDeviceEnabled={setRememberDeviceEnabled}
        setSubView={setSubView}
        twoFactorEnabled={twoFactorEnabled}
      />
    )
  }

  if (subView === 'security' || subView === 'change-password') {
    return (
      <ChangePasswordScreen
        confirmPassword={confirmPassword}
        isSendingOtp={isSendingOtp}
        isUpdatingPassword={isUpdatingPassword}
        newPassword={newPassword}
        otpExpiry={otpExpiry}
        otpSent={otpSent}
        otpVerified={otpVerified}
        requestPasswordOtp={requestPasswordOtp}
        setConfirmPassword={setConfirmPassword}
        setNewPassword={setNewPassword}
        setSubView={setSubView}
        updatePassword={updatePassword}
      />
    )
  }

  // Code entry is a page of its own, like every other OTP step in the portals and in
  // the mobile app. Reaching it never sends a code: Change Password sends one and
  // navigates here, or, while a code is still live, offers "Enter OTP" which comes
  // straight here and leaves the countdown running.
  if (subView === 'change-password-otp') {
    return (
      <ChangePasswordOtpScreen
        formatTime={formatTime}
        handleOtpChange={handleOtpChange}
        handleOtpKeyDown={handleOtpKeyDown}
        handleOtpPaste={handleOtpPaste}
        handleResendOtp={handleResendOtp}
        isSendingOtp={isSendingOtp}
        isVerifyingOtp={isVerifyingOtp}
        otp={otp}
        otpError={otpError}
        otpExpiry={otpExpiry}
        otpVals={otpVals}
        profileEmail={profileEmail}
        resendCooldown={resendCooldown}
        setSubView={setSubView}
        user={user}
        verifyPasswordOtp={verifyPasswordOtp}
      />
    )
  }

  // Added: keep bottle balances out of the main profile and expose them from the profile menu.
  if (subView === 'empties-deposits') {
    return (
      <EmptiesDepositsScreen
        eligibleProducts={eligibleProducts}
        emptiesTab={emptiesTab}
        fetchEligibleProducts={fetchEligibleProducts}
        handleApplyRefundToOrder={handleApplyRefundToOrder}
        handleRecordEmpties={handleRecordEmpties}
        isLoadingEligible={isLoadingEligible}
        isLoadingReserved={isLoadingReserved}
        isRecordModalOpen={isRecordModalOpen}
        isSubmittingEmpties={isSubmittingEmpties}
        isSubmittingRefund={isSubmittingRefund}
        recordCases={recordCases}
        recordLooseBottles={recordLooseBottles}
        refundEmptyOptions={refundEmptyOptions}
        refundQuantityByProduct={refundQuantityByProduct}
        refundableOrders={refundableOrders}
        requestedRefundAmount={requestedRefundAmount}
        reservedOrders={reservedOrders}
        selectedProductId={selectedProductId}
        selectedRefundOrderId={selectedRefundOrderId}
        setEmptiesTab={setEmptiesTab}
        setIsRecordModalOpen={setIsRecordModalOpen}
        setRecordCases={setRecordCases}
        setRecordLooseBottles={setRecordLooseBottles}
        setRefundQuantityByProduct={setRefundQuantityByProduct}
        setSelectedProductId={setSelectedProductId}
        setSelectedRefundOrderId={setSelectedRefundOrderId}
        setSubView={setSubView}
        user={user}
      />
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
      // Open read-only first so customers explicitly choose to edit their details.
      onClick: () => {
        setIsEditingProfile(false)
        setSubView('edit')
      },
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
          <p className="text-sm text-slate-500 truncate mt-0.5">{profileEmail || user?.email || ''}</p>
          {/* Design: present contact information as neutral text without a decorative pill. */}
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
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
