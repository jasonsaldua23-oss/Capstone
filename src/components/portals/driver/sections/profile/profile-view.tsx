'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PortalProfileSkeleton } from '@/components/portals/shared/loading-skeletons'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Bell, ChevronRight, FileText, Loader2, LogOut, PencilLine, ShieldCheck, Camera, Lock, HelpCircle, MessageSquare, Info, ArrowLeft, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarCropDialog } from '@/components/shared/avatar-crop-dialog'
import { useAvatarCrop } from '@/hooks/use-avatar-crop'
import { DRIVER_LICENSE_RESTRICTIONS, isValidDriverLicenseRestriction } from '@/lib/driver-license-restrictions'

async function fetchJsonWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 2,
  delay = 500
): Promise<{ response: Response | null; data: any }> {
  let lastError: any = null
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(input, init)
      const data = await response.json().catch(() => ({}))
      return { response, data }
    } catch (err: any) {
      lastError = err
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError || new Error('Request failed')
}

type NotificationPrefs = {
  tripNotifications: boolean
  deliveryUpdates: boolean
  systemAlerts: boolean
}

type ProfileViewProps = {
  user: any
  onLogout: () => Promise<void>
  initialSubView?: 'real-notifications' | 'menu'
  onUnreadCountChange?: (count: number) => void
  onDidMount?: () => void
}

const DRIVER_NOTIFICATION_PREFS_KEY = 'driver_portal_notification_preferences'

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

function formatFullName(
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
    if (cleanM) parts.push(`${cleanM.charAt(0).toUpperCase()}.`)
  }
  if (last) parts.push(last)

  let result = parts.join(' ')
  if (suf) result = result ? `${result} ${suf}` : suf
  return result || fallback || ''
}

function splitProfileName(value: unknown) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  }
}

export function ProfileView({ user, onLogout, initialSubView, onUnreadCountChange, onDidMount }: ProfileViewProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [subView, setSubView] = useState<'menu' | 'edit' | 'security' | 'account-security' | 'change-password' | 'security-settings' | 'notifications' | 'license' | 'real-notifications'>(initialSubView ?? 'menu')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean((user as any)?.twoFactorEnabled ?? (user as any)?.two_factor_enabled))
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(Boolean((user as any)?.loginAlertsEnabled ?? (user as any)?.login_alerts_enabled ?? true))
  const [isSavingSecurity, setIsSavingSecurity] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isEditingSecurity, setIsEditingSecurity] = useState(false)
  const [rememberDeviceEnabled, setRememberDeviceEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('driver_remember_device_enabled')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const saveSecuritySetting = async (field: 'twoFactorEnabled' | 'loginAlertsEnabled', value: boolean) => {
    setIsSavingSecurity(true)
    try {
      const response = await fetch('/api/driver/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ [field]: value }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to save security setting')
      if (field === 'twoFactorEnabled') setTwoFactorEnabled(value)
      else setLoginAlertsEnabled(value)
      toast.success(field === 'twoFactorEnabled' ? `2FA ${value ? 'enabled' : 'disabled'}` : `Login alerts ${value ? 'enabled' : 'disabled'}`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save security setting')
    } finally {
      setIsSavingSecurity(false)
    }
  }
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordOtp, setPasswordOtp] = useState('')
  const [otpVals, setOtpVals] = useState<string[]>(Array(6).fill(''))
  const [passwordOtpSent, setPasswordOtpSent] = useState(false)
  const [passwordOtpVerified, setPasswordOtpVerified] = useState(false)
  const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false)
  const [isVerifyingPasswordOtp, setIsVerifyingPasswordOtp] = useState(false)

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
        const rawList = payload.notifications || []
        // Defensive client-side filtering: Exclude inventory, warehouse and user logs from driver view
        const driverFeed = rawList.filter(
          (n: any) => n.type !== 'WAREHOUSE' && n.type !== 'INVENTORY' && n.type !== 'USER'
        )
        setRealNotifications(driverFeed)
        const count = driverFeed.filter((n: any) => !n.isRead).length
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

  // Clear verification state when dialog closes
  useEffect(() => {
    if (!isOtpDialogOpen) {
      setPasswordOtp('')
      setOtpVals(Array(6).fill(''))
      setPasswordOtpSent(false)
      setPasswordOtpVerified(false)
      setOtpError(null)
    }
  }, [isOtpDialogOpen])

  const [notifications, setNotifications] = useState<NotificationPrefs>({
    tripNotifications: true,
    deliveryUpdates: true,
    systemAlerts: true,
  })
  const [form, setForm] = useState({
    name: '',
    avatar: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    email: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licensePhotoUrl: '',
    licenseExpiry: '',
  })
  const [draft, setDraft] = useState({
    name: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licensePhotoUrl: '',
    licenseExpiry: '',
  })
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const avatarCrop = useAvatarCrop()

  const formatDateInputValue = (value: unknown) => {
    if (!value) return ''
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRIVER_NOTIFICATION_PREFS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      setNotifications({
        tripNotifications: parsed?.tripNotifications ?? true,
        deliveryUpdates: parsed?.deliveryUpdates ?? true,
        systemAlerts: parsed?.systemAlerts ?? true,
      })
    } catch {
      // ignore corrupt local state
    }
  }, [])

  useEffect(() => {
    async function fetchProfile() {
      try {
        const { response, data: payload } = await fetchJsonWithRetry('/api/driver/profile', { credentials: 'include' })
        if (!response?.ok) throw new Error('Failed to load profile')
        const profile = payload?.driver || payload?.profile || {}
        const nestedUser = profile?.user || {}
        const resolvedLicenseNumber = String(
          profile?.licenseNumber ??
            profile?.license_number ??
            nestedUser?.licenseNumber ??
            nestedUser?.license_number ??
            ''
        )
        const resolvedLicenseExpiry =
          profile?.licenseExpiry ??
          profile?.license_expiry ??
          nestedUser?.licenseExpiry ??
          nestedUser?.license_expiry ??
          ''
        const resolvedLicenseType = String(
          profile?.licenseType ??
            profile?.license_type ??
            nestedUser?.licenseType ??
            nestedUser?.license_type ??
            ''
        )
        const nameParts = splitProfileName(profile?.user?.name || profile?.name || user?.name)
        setForm({
          name: profile?.user?.name || user?.name || '',
          avatar: profile?.user?.avatar || profile?.avatar || user?.avatar || '',
          firstName: profile?.user?.firstName || profile?.firstName || user?.firstName || nameParts.firstName,
          middleName: profile?.user?.middleName || profile?.middleName || user?.middleName || '',
          lastName: profile?.user?.lastName || profile?.lastName || user?.lastName || nameParts.lastName,
          suffix: profile?.user?.suffix || profile?.suffix || user?.suffix || '',
          email: profile?.user?.email || user?.email || '',
          phone: profile?.phone || profile?.user?.phone || '',
          licenseNumber: resolvedLicenseNumber,
          licenseType: resolvedLicenseType,
          licensePhotoUrl: String(profile?.licensePhotoUrl ?? profile?.license_photo_url ?? nestedUser?.licensePhotoUrl ?? nestedUser?.license_photo_url ?? ''),
          licenseExpiry: formatDateInputValue(resolvedLicenseExpiry),
        })
      } catch (error) {
        console.warn('Failed to load profile:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  }, [user?.email, user?.name])

  const initials = useMemo(() => {
    const source = String(form.name || user?.name || '').trim()
    if (!source) return ''
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
  }, [form.name, user?.name])

  const onChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const persistNotifications = (nextValue: NotificationPrefs) => {
    setNotifications(nextValue)
    window.localStorage.setItem(DRIVER_NOTIFICATION_PREFS_KEY, JSON.stringify(nextValue))
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const openEdit = () => {
    setDraft({
      name: form.name,
      firstName: form.firstName,
      middleName: form.middleName,
      lastName: form.lastName,
      suffix: form.suffix,
      phone: form.phone,
      licenseNumber: form.licenseNumber,
      licenseType: form.licenseType,
      licensePhotoUrl: form.licensePhotoUrl,
      licenseExpiry: form.licenseExpiry,
    })
    setSubView('edit')
  }

  const openLicense = () => {
    setDraft({
      name: form.name,
      firstName: form.firstName,
      middleName: form.middleName,
      lastName: form.lastName,
      suffix: form.suffix,
      phone: form.phone,
      licenseNumber: form.licenseNumber,
      licenseType: form.licenseType,
      licensePhotoUrl: form.licensePhotoUrl,
      licenseExpiry: form.licenseExpiry,
    })
    setSubView('license')
  }

  const saveCroppedAvatar = async (file: File) => {
    setIsSaving(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadResponse = await fetch('/api/uploads/customer-avatar', { method: 'POST', body: formData })
      const uploadPayload = await uploadResponse.json().catch(() => ({}))
      if (!uploadResponse.ok || !uploadPayload?.imageUrl) throw new Error(uploadPayload?.error || 'Failed to upload avatar')
      const avatar = String(uploadPayload.imageUrl).trim()
      const response = await fetch('/api/driver/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ avatar }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to save avatar')
      setForm((previous) => ({ ...previous, avatar }))
      setAvatarFile(null)
      toast.success('Profile photo updated')
    } finally {
      setIsSaving(false)
    }
  }

  const onSave = async (mode: 'profile' | 'license' = 'profile') => {
    if (mode === 'profile' && (!draft.firstName.trim() || !draft.lastName.trim())) {
      toast.error('Name is required')
      return
    }
    if (mode === 'profile' && !isValidPhilippinePhone(draft.phone)) {
      toast.error('Please enter a valid Philippine mobile number')
      return
    }
    if (mode === 'license' && !isValidDriverLicenseRestriction(draft.licenseType)) {
      toast.error('Please select a valid driver license restriction')
      return
    }
    if (mode === 'license' && draft.licenseExpiry && draft.licenseExpiry < new Date().toISOString().slice(0, 10)) {
      toast.error('License expiration date cannot be in the past.')
      return
    }

    setIsSaving(true)
    try {
      // Fix: submit only the fields owned by the active section so legacy license data cannot block profile saves.
      const payloadBody: Record<string, string> = mode === 'license'
        ? {
            licenseNumber: draft.licenseNumber,
            licenseType: draft.licenseType,
            licensePhotoUrl: draft.licensePhotoUrl,
            licenseExpiry: draft.licenseExpiry ? `${draft.licenseExpiry}T00:00:00Z` : '',
          }
        : {
            firstName: draft.firstName,
            middleName: draft.middleName,
            lastName: draft.lastName,
            suffix: draft.suffix,
            phone: draft.phone,
          }
      if (mode === 'profile' && avatarFile) {
        const formData = new FormData()
        formData.append('file', avatarFile)
        const uploadResponse = await fetch('/api/uploads/customer-avatar', { method: 'POST', body: formData })
        const uploadPayload = await uploadResponse.json().catch(() => ({}))
        if (!uploadResponse.ok || !uploadPayload?.imageUrl) throw new Error(uploadPayload?.error || 'Failed to upload avatar')
        payloadBody.avatar = String(uploadPayload.imageUrl).trim()
      }

      const response = await fetch('/api/driver/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payloadBody),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      setForm((prev) => ({
        ...prev,
        avatar: payloadBody.avatar || prev.avatar,
        name: formatFullName(draft.firstName, draft.middleName, draft.lastName, draft.suffix, prev.name),
        firstName: draft.firstName,
        middleName: draft.middleName,
        lastName: draft.lastName,
        suffix: draft.suffix,
        phone: draft.phone,
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licensePhotoUrl: draft.licensePhotoUrl,
        licenseExpiry: draft.licenseExpiry,
      }))

      setSubView('menu')
      setAvatarFile(null)
      toast.success(mode === 'profile' ? 'Profile updated' : 'License details updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  const uploadLicensePhoto = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/driver-license-image', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload driver license')
    }
    return String(payload.imageUrl).trim()
  }

  const openChangePassword = () => {
    setNewPassword('')
    setConfirmPassword('')
    setPasswordOtp('')
    setOtpVals(Array(6).fill(''))
    setPasswordOtpSent(false)
    setPasswordOtpVerified(false)
    setSubView('security')
  }

  const requestPasswordOtp = async () => {
    const email = String(form.email || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    setIsSendingPasswordOtp(true)
    setOtpError(null)
    try {
      const response = await fetch('/api/auth/password-reset/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, accountType: 'staff' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      setPasswordOtpSent(true)
      setPasswordOtpVerified(false)
      setPasswordOtp('')
      setOtpVals(Array(6).fill(''))
      setOtpExpiry(120)
      setResendCooldown(60)
      setIsOtpDialogOpen(true)
      toast.success('Verification OTP code sent to your email')
      setTimeout(() => {
        document.getElementById('otp-input-0')?.focus()
      }, 150)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
    } finally {
      setIsSendingPasswordOtp(false)
    }
  }

  const verifyPasswordOtp = async () => {
    const email = String(form.email || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    if (!passwordOtp.trim()) {
      setOtpError('Enter OTP first')
      return
    }
    setIsVerifyingPasswordOtp(true)
    setOtpError(null)
    try {
      const response = await fetch('/api/auth/password-reset/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, accountType: 'staff', otp: passwordOtp.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Invalid or expired OTP')
      }
      setPasswordOtpVerified(true)
      setIsOtpDialogOpen(false)
      toast.success('OTP verified successfully')
    } catch (error: any) {
      setPasswordOtpVerified(false)
      setOtpError(error?.message || 'Invalid or expired OTP')
    } finally {
      setIsVerifyingPasswordOtp(false)
    }
  }

  const handlePasswordUpdate = async () => {
    const email = String(form.email || user?.email || '').trim().toLowerCase()
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
    if (!passwordOtp.trim()) {
      toast.error('Enter OTP first')
      return
    }
    if (!passwordOtpVerified) {
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
          accountType: 'staff',
          otp: passwordOtp.trim(),
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
    setPasswordOtp(nextVals.join(''))

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
      setPasswordOtp(pastedData)
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
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
                  className="text-xs font-bold text-[#0d61ad] hover:underline"
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
            <Loader2 className="h-8 w-8 animate-spin text-[#0d61ad]" />
            <p className="text-sm font-medium text-slate-400">Loading notifications...</p>
          </div>
        ) : realNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-sky-50 text-[#0d61ad] grid place-items-center mb-4">
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
                  !n.isRead ? 'bg-[#f4f8fc]' : 'bg-white'
                } ${idx < realNotifications.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                  !n.isRead ? 'bg-sky-100 text-[#0d61ad]' : 'bg-slate-100 text-slate-400'
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
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
          <p className="text-base font-bold text-slate-900">
            {formatFullName(draft.firstName, draft.middleName, draft.lastName, draft.suffix, form.name || 'Driver Name')}
          </p>
        </div>

        <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="driver-first-name" className="text-sm font-semibold text-slate-700">First Name</Label>
              <Input id="driver-first-name" value={draft.firstName} onChange={(e) => onChange('firstName', e.target.value)} placeholder="First name" className="h-11 rounded-xl border-slate-200 bg-white text-slate-800" disabled={!isEditingProfile} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-last-name" className="text-sm font-semibold text-slate-700">Last Name</Label>
              <Input id="driver-last-name" value={draft.lastName} onChange={(e) => onChange('lastName', e.target.value)} placeholder="Last name" className="h-11 rounded-xl border-slate-200 bg-white text-slate-800" disabled={!isEditingProfile} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-middle-name" className="text-sm font-semibold text-slate-700">Middle Name</Label>
              <Input id="driver-middle-name" value={draft.middleName} onChange={(e) => onChange('middleName', e.target.value)} placeholder="Middle name" className="h-11 rounded-xl border-slate-200 bg-white text-slate-800" disabled={!isEditingProfile} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-suffix" className="text-sm font-semibold text-slate-700">Suffix <span className="text-xs font-normal text-slate-400">(Optional)</span></Label>
              <Input id="driver-suffix" value={draft.suffix} onChange={(e) => onChange('suffix', e.target.value)} placeholder="e.g. Jr., Sr., III" className="h-11 rounded-xl border-slate-200 bg-white text-slate-800" disabled={!isEditingProfile} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-phone" className="text-sm font-semibold text-slate-700">Phone Number</Label>
            <Input
              id="driver-phone"
              value={draft.phone}
              onChange={(e) => onChange('phone', formatPhilippinePhoneInput(e.target.value))}
              placeholder="09XX XXX XXXX"
              maxLength={13}
              inputMode="numeric"
              className={`h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-sky-500 focus-visible:ring-sky-200 ${
                draft.phone && !isValidPhilippinePhone(draft.phone)
                  ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-200'
                  : ''
              }`}
              disabled={!isEditingProfile}
            />
            {draft.phone && !isValidPhilippinePhone(draft.phone) ? (
              <p className="text-xs text-red-600 font-medium">Please enter a valid Philippine mobile number.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-email" className="text-sm font-semibold text-slate-700">Email Address</Label>
            <Input
              id="driver-email"
              value={form.email}
              disabled
              className="h-11 rounded-xl border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
            />
          </div>
          <p className="rounded-xl border border-sky-100 bg-[#f0f9ff]/60 px-3 py-2 text-xs text-sky-800">
            Driver license editing is managed in the separate Driver License section.
          </p>
        </div>

        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={() => {
              if (isEditingProfile) {
                void onSave('profile')
              } else {
                setIsEditingProfile(true)
              }
            }}
            disabled={isSaving || !draft.firstName.trim() || !draft.lastName.trim()}
            className="w-full h-12 bg-[#0d61ad] text-white rounded-xl font-semibold hover:bg-[#0b579c] transition-colors shadow-[0_4px_12px_rgba(13,97,173,0.12)]"
          >
            {isSaving ? (
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

  if (subView === 'license') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Driver License</h2>
        </div>

        <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
          <div className="space-y-2">
            <Label htmlFor="driver-license-number" className="text-sm font-semibold text-slate-700">Driver License Number</Label>
            <Input
              id="driver-license-number"
              value={draft.licenseNumber}
              onChange={(e) => onChange('licenseNumber', e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-sky-500 focus-visible:ring-sky-200"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-license-type" className="text-sm font-semibold text-slate-700">Restrictions</Label>
            <select
              id="driver-license-type"
              value={draft.licenseType}
              onChange={(e) => onChange('licenseType', e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="">Select restriction</option>
              {DRIVER_LICENSE_RESTRICTIONS.map((restriction) => (
                <option key={restriction.code} value={restriction.code}>{restriction.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-license-expiry" className="text-sm font-semibold text-slate-700">License Expiry Date</Label>
            <Input
              id="driver-license-expiry"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={draft.licenseExpiry}
              onChange={(e) => onChange('licenseExpiry', e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-sky-500 focus-visible:ring-sky-200"
            />
          </div>

          <div className="space-y-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-5">
            <Label htmlFor="driver-license-photo" className="text-sm font-semibold text-slate-700">Driver's License Upload</Label>
            <Input
              id="driver-license-photo"
              type="file"
              accept="image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setIsSaving(true)
                try {
                  const imageUrl = await uploadLicensePhoto(file)
                  // Added: retain the uploaded license URL until Save License persists the profile.
                  onChange('licensePhotoUrl', imageUrl)
                  toast.success('Driver license uploaded')
                } catch (error: any) {
                  toast.error(error?.message || 'Failed to upload driver license')
                } finally {
                  setIsSaving(false)
                  event.currentTarget.value = ''
                }
              }}
            />
            {draft.licensePhotoUrl ? (
              <a href={draft.licensePhotoUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline">View uploaded license</a>
            ) : (
              <p className="text-xs text-slate-400">Upload a clear image of the driver's license.</p>
            )}
          </div>
        </div>

        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={() => void onSave('license')}
            disabled={isSaving}
            className="w-full h-12 bg-[#0d61ad] text-white rounded-xl font-semibold hover:bg-[#0b579c] transition-colors shadow-[0_4px_12px_rgba(13,97,173,0.12)]"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving License...
              </>
            ) : (
              'Save License'
            )}
          </Button>
        </div>
      </div>
    )
  }

  if (subView === 'account-security') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
              <div className="h-10 w-10 rounded-2xl bg-sky-50 text-[#0d61ad] grid place-items-center shrink-0">
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
              <div className="h-10 w-10 rounded-2xl bg-sky-50 text-[#0d61ad] grid place-items-center shrink-0">
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
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
              <p className="text-xs text-slate-500 max-w-sm">Require a 6-digit OTP code when logging in to protect your driver account.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={twoFactorEnabled}
              disabled={isSavingSecurity || !isEditingSecurity}
              onClick={() => void saveSecuritySetting('twoFactorEnabled', !twoFactorEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                twoFactorEnabled ? 'bg-[#0d61ad]' : 'bg-slate-200'
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
                loginAlertsEnabled ? 'bg-[#0d61ad]' : 'bg-slate-200'
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
                if (typeof window !== 'undefined') localStorage.setItem('driver_remember_device_enabled', String(next))
                toast.success(next ? 'Device remembering enabled' : 'Device remembering disabled')
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                rememberDeviceEnabled ? 'bg-[#0d61ad]' : 'bg-slate-200'
              } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${rememberDeviceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        <div className="px-4 pt-2">
          <Button
            type="button"
            onClick={() => setIsEditingSecurity(false)}
            disabled={!isEditingSecurity}
            className="w-full h-12 bg-[#0d61ad] text-white rounded-xl font-semibold hover:bg-[#0b579c] transition-colors shadow-[0_4px_12px_rgba(13,97,173,0.12)]"
          >
            {isEditingSecurity ? 'Save Security Settings' : 'Edit Security Settings'}
          </Button>
        </div>
      </div>
    )
  }

  if (subView === 'security' || subView === 'change-password') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
            <Label htmlFor="driver-new-password" className="text-sm font-semibold text-slate-700">New Password</Label>
            <Input
              id="driver-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-sky-500 focus-visible:ring-sky-200"
            />
            {/* Real-time Password Policy Checklist */}
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
            <Label htmlFor="driver-confirm-password" className="text-sm font-semibold text-slate-700">Confirm Password</Label>
            <Input
              id="driver-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-sky-500 focus-visible:ring-sky-200"
            />
          </div>

          {/* Security Verification Card */}
          <div className="space-y-3 rounded-2xl border border-[#0d61ad]/20 bg-[#f4f8fc] p-4 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0d61ad]">Security Verification</p>
              <p className="mt-0.5 text-xs text-slate-500 font-medium">OTP verification is required to update password.</p>
            </div>
            {passwordOtpVerified ? (
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
                disabled={isSendingPasswordOtp}
                className="w-full h-11 rounded-xl bg-[#0d61ad] hover:bg-[#0b579c] text-white font-semibold shadow-sm transition-colors"
              >
                {isSendingPasswordOtp ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending OTP...
                  </>
                ) : passwordOtpSent ? (
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
            onClick={handlePasswordUpdate}
            disabled={isUpdatingPassword || !passwordOtpVerified || !newPassword || !confirmPassword}
            className="w-full h-12 bg-[#0d61ad] text-white rounded-xl font-semibold hover:bg-[#0b579c] transition-colors shadow-[0_4px_12px_rgba(13,97,173,0.12)]"
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
              <div className="h-10 w-10 rounded-2xl bg-sky-50 text-[#0d61ad] grid place-items-center mb-2">
                <Lock className="h-5 w-5" />
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900">Enter Verification Code</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                We sent a 6-digit verification code to <span className="font-semibold text-slate-700">{form.email || user?.email}</span>
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
                      className="w-9 h-11 sm:w-11 sm:h-13 text-center text-lg sm:text-xl font-bold rounded-xl border border-slate-200 focus:border-[#0d61ad] focus:outline-none focus:ring-2 focus:ring-sky-100 bg-white text-slate-800 transition-all placeholder:text-slate-300"
                    />
                  ))}
                </div>
                
                {otpExpiry > 0 ? (
                  <p className="text-xs font-semibold text-slate-500">
                    Code expires in <span className="text-[#0d61ad] font-bold">{formatTime(otpExpiry)}</span>
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
                  disabled={isVerifyingPasswordOtp || passwordOtp.length < 6 || otpExpiry === 0}
                  className="w-full h-11 bg-[#0d61ad] text-white rounded-xl font-semibold hover:bg-[#0b579c]"
                >
                  {isVerifyingPasswordOtp ? (
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
                      disabled={isSendingPasswordOtp}
                      className="text-xs font-bold text-[#0d61ad] hover:underline"
                    >
                      {isSendingPasswordOtp ? 'Sending...' : 'Resend Code'}
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

  if (subView === 'notifications') {
    return (
      <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
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
            title="Trip Notifications"
            description="Receive updates for new or reassigned trips."
            checked={notifications.tripNotifications}
            onToggle={() => persistNotifications({ ...notifications, tripNotifications: !notifications.tripNotifications })}
          />
          <NotificationRow
            title="Delivery Updates"
            description="Receive route progress and stop completion alerts."
            checked={notifications.deliveryUpdates}
            onToggle={() => persistNotifications({ ...notifications, deliveryUpdates: !notifications.deliveryUpdates })}
          />
          <NotificationRow
            title="System Alerts"
            description="Receive important driver announcements."
            checked={notifications.systemAlerts}
            onToggle={() => persistNotifications({ ...notifications, systemAlerts: !notifications.systemAlerts })}
          />
        </div>
      </div>
    )
  }

  const menuItems = [
    {
      icon: <PencilLine className="h-5 w-5 text-[#0d61ad]" />,
      title: 'Edit Profile',
      onClick: openEdit,
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-[#0d61ad]" />,
      title: 'Account Security',
      onClick: () => setSubView('account-security'),
    },
    {
      icon: <Bell className="h-5 w-5 text-[#0d61ad]" />,
      title: 'Notification Settings',
      onClick: () => setSubView('notifications'),
    },
    {
      icon: <FileText className="h-5 w-5 text-[#0d61ad]" />,
      title: 'Driver License',
      onClick: openLicense,
    },
  ]

  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
      <div className="flex items-center justify-between px-4 pt-5 pb-1">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Profile</h2>
      </div>

      {isLoading ? (
        <div className="px-4">
          <PortalProfileSkeleton />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="relative">
              <Avatar className="h-20 w-20 border-2 border-white shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
                {form.avatar ? <AvatarImage src={form.avatar} alt={`${form.name} avatar`} className="object-cover" /> : null}
                <AvatarFallback className="bg-[#0d61ad] text-2xl font-bold text-white">
                  {initials || 'D'}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#0d61ad] text-white shadow-md border-2 border-white hover:bg-[#0a4f8f] active:scale-95 transition"
                title="Change Avatar"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { avatarCrop.open(event.target.files?.[0] || null); event.currentTarget.value = '' }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-[#17365d] truncate">
                {formatFullName(form.firstName, form.middleName, form.lastName, form.suffix, form.name || 'Driver')}
              </h3>
              <p className="text-sm text-[#5f7390] truncate">
                {[form.firstName, form.middleName ? `${form.middleName.replace(/\.+$/, '').charAt(0).toUpperCase()}.` : '', form.lastName, form.suffix].filter(Boolean).join(' ') || 'Name details not set'}
              </p>
              <p className="text-sm text-[#5f7390] truncate mt-0.5">{form.email}</p>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#e0f2fe] px-2.5 py-0.5 text-xs font-semibold text-[#0369a1]">
                Driver
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
        </>
      )}

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
      <AvatarCropDialog crop={avatarCrop} isSaving={isSaving} onSave={saveCroppedAvatar} />
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
        <p className="text-sm font-semibold text-[#1e3a8a]">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-[#0d61ad]' : 'bg-slate-200'}`}
        aria-pressed={checked}
      >
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
