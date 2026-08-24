'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/page'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { OtpVerificationModal } from '@/components/shared/otp-verification-modal'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { AvatarCropDialog } from '@/components/shared/avatar-crop-dialog'
import { useAvatarCrop } from '@/hooks/use-avatar-crop'
import {
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Shield,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react'

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

export function SettingsView() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [firstName, setFirstName] = useState(String((user as any)?.firstName || ''))
  const [middleName, setMiddleName] = useState(String((user as any)?.middleName || ''))
  const [lastName, setLastName] = useState(String((user as any)?.lastName || ''))
  const [suffix, setSuffix] = useState(String((user as any)?.suffix || ''))
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState(String((user as any)?.phone || ''))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [isSavingSecuritySettings, setIsSavingSecuritySettings] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [profileOtpSent, setProfileOtpSent] = useState(false)
  const [profileOtpVerified, setProfileOtpVerified] = useState(false)
  const [profileOtpToken, setProfileOtpToken] = useState('')
  const [isSendingProfileOtp, setIsSendingProfileOtp] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const avatarCrop = useAvatarCrop()
  const [passwordOtpSent, setPasswordOtpSent] = useState(false)
  const [passwordOtpVerified, setPasswordOtpVerified] = useState(false)
  const [passwordOtpToken, setPasswordOtpToken] = useState('')
  const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false)
  const [otpModalKind, setOtpModalKind] = useState<'profile' | 'password' | null>(null)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(true)
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState('30')
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isEditingSecurity, setIsEditingSecurity] = useState(false)

  const hasNewPassword = newPassword.length > 0
  const passwordRequirements = useMemo(
    () => [
      { id: 'length', label: 'At least 8 characters', met: newPassword.length >= 8 },
      { id: 'upper', label: 'At least 1 uppercase letter', met: hasNewPassword && /[A-Z]/.test(newPassword) },
      { id: 'lower', label: 'At least 1 lowercase letter', met: hasNewPassword && /[a-z]/.test(newPassword) },
      { id: 'number', label: 'At least 1 number', met: hasNewPassword && /\d/.test(newPassword) },
      { id: 'special', label: 'At least 1 special character', met: hasNewPassword && /[^A-Za-z0-9\s]/.test(newPassword) },
      { id: 'no-spaces', label: 'No spaces', met: hasNewPassword && !/\s/.test(newPassword) },
    ],
    [newPassword, hasNewPassword]
  )

  const rulesMetCount = useMemo(() => passwordRequirements.filter((rule) => rule.met).length, [passwordRequirements])
  const isPasswordValid = rulesMetCount === passwordRequirements.length
  const passwordsMatch = hasNewPassword && confirmPassword.length > 0 && newPassword === confirmPassword
  const passwordsMismatch = hasNewPassword && confirmPassword.length > 0 && newPassword !== confirmPassword

  const strengthLevel = useMemo(() => {
    if (!hasNewPassword) return { label: 'Enter password', color: 'bg-slate-200', text: 'text-slate-400', level: 0 }
    if (rulesMetCount <= 2) return { label: 'Weak', color: 'bg-rose-500', text: 'text-rose-600', level: 1 }
    if (rulesMetCount <= 4) return { label: 'Fair', color: 'bg-amber-500', text: 'text-amber-600', level: 2 }
    if (rulesMetCount === 5) return { label: 'Good', color: 'bg-blue-500', text: 'text-blue-600', level: 3 }
    return { label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-600', level: 4 }
  }, [hasNewPassword, rulesMetCount])

  const userId = (user as any)?.userId || (user as any)?.id
  const accountEmail = String((user as any)?.email || '').trim().toLowerCase()
  const accountRoleId = String((user as any)?.role || '').trim().toUpperCase()
  const avatarUrl = String((user as any)?.avatar || '').trim()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const nameInitials =
    String(name || user?.name || 'U')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'U'
  const normalizedEmail = email.trim().toLowerCase()
  const isEmailChanged = normalizedEmail !== accountEmail
  const avatarPreviewUrl = useMemo(() => (avatarFile ? URL.createObjectURL(avatarFile) : avatarUrl), [avatarFile, avatarUrl])

  useEffect(() => {
    if (!avatarFile || !avatarPreviewUrl || avatarPreviewUrl === avatarUrl) return
    return () => URL.revokeObjectURL(avatarPreviewUrl)
  }, [avatarFile, avatarPreviewUrl, avatarUrl])

  useEffect(() => {
    setName(String((user as any)?.name || ''))
    const nameParts = String((user as any)?.name || '').trim().split(/\s+/).filter(Boolean)
    setFirstName(String((user as any)?.firstName || nameParts[0] || ''))
    setMiddleName(String((user as any)?.middleName || ''))
    setLastName(String((user as any)?.lastName || nameParts.slice(1).join(' ') || ''))
    setSuffix(String((user as any)?.suffix || ''))
    setEmail(String((user as any)?.email || ''))
    setPhone(String((user as any)?.phone || ''))
    setAvatarFile(null)
  }, [user])

  const uploadAvatar = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/customer-avatar', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload avatar')
    }
    return String(payload.imageUrl).trim()
  }

  const saveCroppedAvatar = async (file: File) => {
    if (!userId) throw new Error('Unable to resolve user ID')
    setIsSavingProfile(true)
    try {
      const avatar = await uploadAvatar(file)
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to save avatar')
      setUser((previous: any) => ({ ...(previous || {}), avatar }))
      setAvatarFile(null)
      toast.success('Profile photo updated')
    } finally {
      setIsSavingProfile(false)
    }
  }

  useEffect(() => {
    setTwoFactorEnabled(Boolean((user as any)?.twoFactorEnabled))
    setLoginAlertsEnabled((user as any)?.loginAlertsEnabled !== false)
    setSessionTimeoutMinutes(String((user as any)?.sessionTimeoutMinutes || 30))
  }, [user])

  const requestOtp = async (targetEmail: string, kind: 'profile' | 'password') => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    if (!emailToVerify) {
      toast.error('Email is required')
      return false
    }
    if (kind === 'profile') setIsSendingProfileOtp(true)
    else setIsSendingPasswordOtp(true)
    try {
      const response = await fetch(
        kind === 'password' ? '/api/auth/password-reset/request-otp' : '/api/auth/email-verification/request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailToVerify, accountType: 'staff', roleId: accountRoleId }),
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      if (kind === 'profile') {
        setProfileOtpSent(true)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
      } else {
        setPasswordOtpSent(true)
        setPasswordOtpVerified(false)
        setPasswordOtpToken('')
      }
      setOtpModalKind(kind)
      toast.success('Verification OTP code sent to your email')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
      return false
    } finally {
      if (kind === 'profile') setIsSendingProfileOtp(false)
      else setIsSendingPasswordOtp(false)
    }
  }

  const verifyOtp = async (targetEmail: string, kind: 'profile' | 'password', otpValue: string) => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    const otp = otpValue.trim()
    if (!emailToVerify) {
      toast.error('Email is required')
      return false
    }
    if (!otp) {
      toast.error('Enter OTP first')
      return false
    }
    try {
      const response = await fetch(
        kind === 'password' ? '/api/auth/password-reset/verify-otp' : '/api/auth/email-verification/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailToVerify, accountType: 'staff', otp }),
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      if (kind === 'profile') {
        const token = String(payload?.verificationToken || '').trim()
        if (!token) throw new Error('Missing verification token')
        setProfileOtpVerified(true)
        setProfileOtpToken(token)
      } else {
        setPasswordOtpVerified(true)
        setPasswordOtpToken(otp)
      }
      toast.success('OTP verified successfully')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify OTP')
      return false
    }
  }

  const handleProfileSave = async () => {
    if (!accountEmail) {
      toast.error('Unable to resolve account email')
      return
    }
    if (isEmailChanged && !profileOtpVerified) {
      toast.error('Verify OTP for the new email before saving')
      return
    }

    setIsSavingProfile(true)
    try {
      let nextAvatar = avatarUrl || null
      if (avatarFile) {
        nextAvatar = await uploadAvatar(avatarFile)
      }
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formatFullName(firstName, middleName, lastName, suffix, name),
          firstName,
          middleName,
          lastName,
          suffix: suffix.trim() || null,
          email,
          phone,
          avatar: nextAvatar,
          emailVerificationToken: isEmailChanged ? profileOtpToken : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to save profile')
      }
      const nextUser = data?.user || {}
      setUser((prev: any) => ({
        ...(prev || {}),
        name: nextUser.name ?? formatFullName(firstName, middleName, lastName, suffix, name),
        firstName: nextUser.firstName ?? firstName,
        middleName: nextUser.middleName ?? middleName,
        lastName: nextUser.lastName ?? lastName,
        suffix: nextUser.suffix ?? suffix,
        email: nextUser.email ?? email,
        phone: nextUser.phone ?? phone,
        avatar: nextUser.avatar ?? nextAvatar,
      }))
      setName(String(nextUser.name ?? formatFullName(firstName, middleName, lastName, suffix, name)))
      setFirstName(String(nextUser.firstName ?? firstName))
      setMiddleName(String(nextUser.middleName ?? middleName))
      setLastName(String(nextUser.lastName ?? lastName))
      setSuffix(String(nextUser.suffix ?? suffix))
      setEmail(String(nextUser.email ?? email))
      setPhone(String(nextUser.phone ?? phone))
      setAvatarFile(null)
      toast.success('Profile updated successfully')
      if (isEmailChanged) {
        setProfileOtpSent(false)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
      }
    } catch (error) {
      console.error('Profile update failed:', error)
      toast.error('Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handlePasswordUpdate = async () => {
    if (!userId) {
      toast.error('Unable to resolve user ID')
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

    if (!passwordOtpVerified) {
      toast.error('Complete OTP verification before updating password')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const response = await fetch('/api/auth/password-reset/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accountEmail,
          accountType: 'staff',
          otp: passwordOtpToken,
          newPassword,
        }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to update password')
      }
      toast.success('Password updated successfully')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOtpSent(false)
      setPasswordOtpVerified(false)
      setPasswordOtpToken('')
    } catch (error) {
      console.error('Password update failed:', error)
      toast.error('Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const handleSaveSecuritySettings = () => {
    void (async () => {
      if (!userId) {
        toast.error('Unable to resolve user ID')
        return
      }
      const timeout = Number(sessionTimeoutMinutes)
      if (!Number.isFinite(timeout) || timeout < 5) {
        toast.error('Session timeout must be at least 5 minutes')
        return
      }
      setIsSavingSecuritySettings(true)
      try {
        const response = await fetch(`/api/users/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            twoFactorEnabled,
            loginAlertsEnabled,
            sessionTimeoutMinutes: Math.floor(timeout),
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data?.success === false) {
          throw new Error(data?.error || 'Failed to save security settings')
        }
        const nextUser = data?.user || {}
        setUser((prev: any) => ({
          ...(prev || {}),
          twoFactorEnabled: Boolean(nextUser.twoFactorEnabled ?? nextUser.two_factor_enabled ?? twoFactorEnabled),
          loginAlertsEnabled: Boolean(nextUser.loginAlertsEnabled ?? nextUser.login_alerts_enabled ?? loginAlertsEnabled),
          sessionTimeoutMinutes: Number(
            nextUser.sessionTimeoutMinutes ?? nextUser.session_timeout_minutes ?? Math.floor(timeout)
          ),
        }))
        toast.success('Security settings saved')
      } catch (error: any) {
        toast.error(error?.message || 'Failed to save security settings')
      } finally {
        setIsSavingSecuritySettings(false)
      }
    })()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your personal profile, account security, and credentials</p>
      </div>

      <div className="w-full max-w-5xl space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-200/80 shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold text-slate-900">Profile Information</CardTitle>
              <CardDescription className="text-xs text-slate-500">Update your account name, email, and avatar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    avatarCrop.open(file)
                    if (avatarInputRef.current) avatarInputRef.current.value = ''
                  }}
                />
                <Avatar className="h-16 w-16 border border-slate-200 shadow-xs">
                  {avatarPreviewUrl ? (
                    <AvatarImage src={avatarPreviewUrl} alt={`${name || user?.name || 'User'} avatar`} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-lg font-bold text-white">
                    {nameInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {formatFullName(firstName, middleName, lastName, suffix, name || user?.name || 'User')}
                  </p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{email || user?.email || 'No email provided'}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-8 text-xs font-medium border-slate-200"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {avatarFile ? 'Change Selected Avatar' : 'Change Avatar'}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="first-name" className="text-xs font-semibold text-slate-600">First Name</label>
                    <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1 h-10 text-sm" placeholder="First name" disabled={!isEditingProfile} />
                  </div>
                  <div>
                    <label htmlFor="last-name" className="text-xs font-semibold text-slate-600">Last Name</label>
                    <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="mt-1 h-10 text-sm" placeholder="Last name" disabled={!isEditingProfile} />
                  </div>
                  <div>
                    <label htmlFor="middle-name" className="text-xs font-semibold text-slate-600">Middle Name</label>
                    <Input id="middle-name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className="mt-1 h-10 text-sm" placeholder="Middle name" disabled={!isEditingProfile} />
                  </div>
                  <div>
                    <label htmlFor="suffix" className="text-xs font-semibold text-slate-600">Suffix <span className="font-normal text-slate-400">(Optional)</span></label>
                    <Input id="suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} className="mt-1 h-10 text-sm" placeholder="e.g. Jr., Sr., III" disabled={!isEditingProfile} />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-semibold text-slate-700">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setProfileOtpSent(false)
                    setProfileOtpVerified(false)
                    setProfileOtpToken('')
                  }}
                  className="h-10 text-sm"
                  placeholder="name@company.com"
                  disabled={!isEditingProfile}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="phone" className="text-xs font-semibold text-slate-700">
                  Phone Number
                </label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="09XX XXX XXXX"
                  className="h-10 text-sm"
                  disabled={!isEditingProfile}
                />
              </div>

              {isEmailChanged ? (
                <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3.5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">Security Verification</p>
                    <p className="mt-0.5 text-xs text-slate-600">OTP verification is required to change your account email.</p>
                  </div>
                  {profileOtpVerified ? (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                      Email Verified Successfully
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full h-9 border-blue-200 text-blue-700 hover:bg-blue-50 font-medium text-xs gap-1.5"
                      onClick={() => void requestOtp(normalizedEmail, 'profile')}
                      disabled={isSendingProfileOtp}
                    >
                      {isSendingProfileOtp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                      {isSendingProfileOtp ? 'Sending OTP...' : profileOtpSent ? 'Resend Verification OTP' : 'Request Verification OTP'}
                    </Button>
                  )}
                </div>
              ) : null}

              <Button
                className="w-full bg-blue-600 text-white hover:bg-blue-700 h-10 font-semibold shadow-xs"
                onClick={() => {
                  if (isEditingProfile) {
                    handleProfileSave()
                  } else {
                    setIsEditingProfile(true)
                  }
                }}
                disabled={isSavingProfile}
              >
                {isSavingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isSavingProfile ? 'Saving...' : isEditingProfile ? 'Save Profile Changes' : 'Edit Profile'}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-bold text-slate-900">Security Settings</CardTitle>
              <CardDescription className="text-xs text-slate-500">Manage two-factor authentication and session protection</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg p-2 bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">2FA Verification</p>
                    <p className="text-xs text-slate-500">Require OTP on sign in</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTwoFactorEnabled((prev) => !prev)}
                  disabled={!isEditingSecurity}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                    twoFactorEnabled ? 'bg-blue-600' : 'bg-slate-300'
                  } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
                  role="switch"
                  aria-checked={twoFactorEnabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg p-2 bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Login Alerts</p>
                    <p className="text-xs text-slate-500">Alert on new device logins</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLoginAlertsEnabled((prev) => !prev)}
                  disabled={!isEditingSecurity}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                    loginAlertsEnabled ? 'bg-blue-600' : 'bg-slate-300'
                  } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
                  role="switch"
                  aria-checked={loginAlertsEnabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      loginAlertsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="session-timeout" className="text-xs font-semibold text-slate-700">
                  Session Timeout (minutes)
                </label>
                <Input
                  id="session-timeout"
                  type="number"
                  min="5"
                  value={sessionTimeoutMinutes}
                  onChange={(e) => setSessionTimeoutMinutes(e.target.value)}
                  className="h-10 text-sm"
                  disabled={!isEditingSecurity}
                />
                <p className="text-[11px] text-slate-400">Minimum 5 minutes of inactivity before automatic logout.</p>
              </div>

              <Button
                type="button"
                className="w-full bg-blue-600 text-white hover:bg-blue-700 h-10 font-semibold shadow-xs"
                onClick={() => {
                  if (isEditingSecurity) {
                    handleSaveSecuritySettings()
                  } else {
                    setIsEditingSecurity(true)
                  }
                }}
                disabled={isSavingSecuritySettings}
              >
                {isSavingSecuritySettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isSavingSecuritySettings ? 'Saving...' : isEditingSecurity ? 'Save Security Settings' : 'Edit Security Settings'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-bold text-slate-900">Change Password</CardTitle>
            <CardDescription className="text-xs text-slate-500">Update your sign-in credentials with secure OTP authentication</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-xs font-semibold text-slate-700">
                New Password
              </label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10 text-sm pr-10"
                  placeholder="Enter your new password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  onClick={() => setShowNewPassword((v) => !v)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {hasNewPassword && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Password Strength</span>
                    <span className={`font-semibold ${strengthLevel.text}`}>{strengthLevel.label}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((step) => {
                      const active =
                        (step === 1 && rulesMetCount >= 1) ||
                        (step === 2 && rulesMetCount >= 3) ||
                        (step === 3 && rulesMetCount >= 5) ||
                        (step === 4 && rulesMetCount === 6)
                      return (
                        <div
                          key={step}
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            active ? strengthLevel.color : 'bg-slate-100'
                          }`}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <p className="text-xs font-semibold text-slate-700 mb-2">Password Requirements:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                  {passwordRequirements.map((rule) => {
                    const isMet = rule.met
                    const isUntouched = !hasNewPassword
                    return (
                      <div key={rule.id} className="flex items-center gap-2 text-xs">
                        {isUntouched ? (
                          <Circle className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                        ) : isMet ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                        )}
                        <span
                          className={
                            isUntouched
                              ? 'text-slate-500'
                              : isMet
                              ? 'font-medium text-emerald-700'
                              : 'text-slate-500'
                          }
                        >
                          {rule.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="confirm-password" className="text-xs font-semibold text-slate-700">
                  Confirm Password
                </label>
                {passwordsMatch && (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Passwords match
                  </span>
                )}
                {passwordsMismatch && (
                  <span className="flex items-center gap-1 text-xs font-medium text-rose-500">
                    <XCircle className="h-3.5 w-3.5" /> Passwords do not match
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`h-10 text-sm pr-10 ${passwordsMismatch ? 'border-rose-300 focus-visible:ring-rose-200' : ''}`}
                  placeholder="Re-enter your new password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg p-2 bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">Security Verification</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    A verification code is sent to <span className="font-medium text-slate-700">{accountEmail}</span> to confirm this password change.
                  </p>
                </div>
              </div>

              {passwordOtpVerified ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Identity verified for password update</span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 font-medium h-9 text-xs"
                  onClick={() => void requestOtp(accountEmail, 'password')}
                  disabled={
                    isSendingPasswordOtp ||
                    !newPassword ||
                    !confirmPassword ||
                    newPassword !== confirmPassword ||
                    !isPasswordValid
                  }
                >
                  {isSendingPasswordOtp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {isSendingPasswordOtp ? 'Sending Security Code...' : passwordOtpSent ? 'Resend Security Code' : 'Request Security Code'}
                </Button>
              )}
            </div>

            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700 h-10 font-semibold gap-2 shadow-xs"
              onClick={handlePasswordUpdate}
              disabled={
                isUpdatingPassword ||
                !passwordOtpVerified ||
                !newPassword ||
                !confirmPassword ||
                newPassword !== confirmPassword ||
                !isPasswordValid
              }
            >
              {isUpdatingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {isUpdatingPassword ? 'Updating Password...' : 'Update Password'}
            </Button>
          </CardContent>
        </Card>

        <OtpVerificationModal
          open={otpModalKind !== null}
          onOpenChange={(open) => {
            if (!open) setOtpModalKind(null)
          }}
          email={otpModalKind === 'profile' ? normalizedEmail : accountEmail}
          onVerify={(otp) =>
            otpModalKind
              ? verifyOtp(otpModalKind === 'profile' ? normalizedEmail : accountEmail, otpModalKind, otp)
              : Promise.resolve(false)
          }
          onResendCode={() =>
            otpModalKind
              ? requestOtp(otpModalKind === 'profile' ? normalizedEmail : accountEmail, otpModalKind)
              : Promise.resolve(false)
          }
        />
        <AvatarCropDialog crop={avatarCrop} isSaving={isSavingProfile} onSave={saveCroppedAvatar} />
      </div>
    </div>
  )
}
