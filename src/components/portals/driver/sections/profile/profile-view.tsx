'use client'

import { useState, useEffect, useMemo } from 'react'
import { getTabAuthToken } from '@/lib/client-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PortalProfileSkeleton } from '@/components/portals/shared/loading-skeletons'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
import { validatePasswordPolicy } from '@/lib/password-policy'

async function fetchJsonWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryConfig: number | { retries?: number; timeoutMs?: number } = 5
) {
  const retries = typeof retryConfig === 'number' ? retryConfig : (retryConfig.retries ?? 5)
  const timeoutMs = typeof retryConfig === 'number' ? 10000 : (retryConfig.timeoutMs ?? 10000)
  let lastResponse: Response | null = null
  let lastData: any = {}
  let lastRaw = ''

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      const response = await fetch(input, {
        ...(init || {}),
        headers,
        credentials: init?.credentials ?? 'include',
        signal: controller.signal,
      })
      const raw = await response.text()
      const data = raw ? JSON.parse(raw) : {}
      lastResponse = response
      lastData = data
      lastRaw = raw
      if (response.ok && data?.success !== false) {
        return { response, data, raw }
      }
      if (response.status === 401 || response.status === 403) {
        return { response, data, raw }
      }
    } catch (error) {
      lastData = { error: error instanceof Error ? error.message : 'Request failed' }
      lastRaw = ''
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)))
    }
  }

  return { response: lastResponse, data: lastData, raw: lastRaw }
}
export function ProfileView({ user }: { user: any }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordOtp, setPasswordOtp] = useState('')
  const [passwordOtpSent, setPasswordOtpSent] = useState(false)
  const [passwordOtpVerified, setPasswordOtpVerified] = useState(false)
  const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false)
  const [isVerifyingPasswordOtp, setIsVerifyingPasswordOtp] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
  })
  const [draft, setDraft] = useState({
    name: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
  })

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
        setForm({
          name: profile?.user?.name || user?.name || '',
          email: profile?.user?.email || user?.email || '',
          phone: profile?.phone || profile?.user?.phone || '',
          licenseNumber: resolvedLicenseNumber,
          licenseType: resolvedLicenseType,
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

  const onChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }


  const openEdit = () => {
    setDraft({
      name: form.name,
      phone: form.phone,
      licenseNumber: form.licenseNumber,
      licenseType: form.licenseType,
      licenseExpiry: form.licenseExpiry,
    })
    setEditOpen(true)
  }

  const onSave = async () => {
    if (!draft.name.trim()) {
      toast.error('Name is required')
      return
    }

    setIsSaving(true)
    try {
      const payloadBody: Record<string, string> = {
        name: draft.name,
        phone: draft.phone,
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licenseExpiry: draft.licenseExpiry ? `${draft.licenseExpiry}T00:00:00Z` : '',
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
        name: draft.name,
        phone: draft.phone,
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licenseExpiry: draft.licenseExpiry,
      }))
      setEditOpen(false)
      toast.success('Profile updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  const openChangePassword = () => {
    setNewPassword('')
    setConfirmPassword('')
    setPasswordOtp('')
    setPasswordOtpSent(false)
    setPasswordOtpVerified(false)
    setChangePasswordOpen(true)
  }

  const requestPasswordOtp = async () => {
    const email = String(form.email || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    setIsSendingPasswordOtp(true)
    try {
      const response = await fetch('/api/auth/password-reset/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      setPasswordOtp('')
      setPasswordOtpSent(true)
      setPasswordOtpVerified(false)
      toast.success('OTP sent')
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
      toast.error('Enter OTP first')
      return
    }
    setIsVerifyingPasswordOtp(true)
    try {
      const response = await fetch('/api/auth/password-reset/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, accountType: 'staff', otp: passwordOtp.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      setPasswordOtpVerified(true)
      toast.success('OTP verified')
    } catch (error: any) {
      setPasswordOtpVerified(false)
      toast.error(error?.message || 'Failed to verify OTP')
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
      setChangePasswordOpen(false)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return (
    <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
      <h2 className="mb-4 text-xl font-bold text-[#17365d]">My Profile</h2>
      <Card className="rounded-2xl border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] shadow-[0_16px_36px_rgba(15,23,42,0.14)]">
        <CardContent className="pt-6">
          {isLoading ? (
            <PortalProfileSkeleton />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-20 w-20 mb-4">
                  <AvatarFallback className="bg-[#0d61ad] text-white text-2xl">
                    {(form.name || user?.name || 'D').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold text-[#17365d]">{form.name || 'N/A'}</h3>
                <p className="text-sm text-[#5f7390]">{form.email || 'N/A'}</p>
              </div>

              <div className="space-y-2 rounded-xl border border-sky-200/80 bg-white/80 p-3 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#5f7390]">Phone</p>
                  <p className="text-sm font-medium text-[#17365d]">{form.phone || 'N/A'}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#5f7390]">Driver License</p>
                  <p className="text-sm font-medium text-[#17365d]">{form.licenseNumber || 'N/A'}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#5f7390]">License Type</p>
                  <p className="text-sm font-medium text-[#17365d]">{form.licenseType || 'N/A'}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#5f7390]">License Expiry</p>
                  <p className="text-sm font-medium text-[#17365d]">{form.licenseExpiry || 'N/A'}</p>
                </div>
              </div>

              <Button
                className="h-11 w-full rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={openEdit}
              >
                Edit Profile
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl border border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition hover:bg-sky-50"
                onClick={openChangePassword}
              >
                Change Password
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">
                Edit <span className="text-[#2f9a34]">Profile</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Update your personal details.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3.5 overflow-y-auto px-5 pb-5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="driver-name" className="text-[0.95rem] font-semibold text-[#17365d]">Full Name</Label>
              <Input
                id="driver-name"
                value={draft.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-phone" className="text-[0.95rem] font-semibold text-[#17365d]">Phone</Label>
              <Input
                id="driver-phone"
                value={draft.phone}
                onChange={(e) => onChange('phone', formatPhilippinePhoneInput(e.target.value))}
                placeholder="09XX XXX XXXX"
                maxLength={13}
                className={`h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20 ${draft.phone && !isValidPhilippinePhone(draft.phone) ? 'border-red-300' : ''}`}
              />
              {draft.phone && draft.phone.length > 0 && !isValidPhilippinePhone(draft.phone) && (
                <p className="text-xs text-red-600">Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567)</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-license-number" className="text-[0.95rem] font-semibold text-[#17365d]">Driver License</Label>
              <Input
                id="driver-license-number"
                value={draft.licenseNumber}
                onChange={(e) => onChange('licenseNumber', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-license-type" className="text-[0.95rem] font-semibold text-[#17365d]">License Type</Label>
              <Input
                id="driver-license-type"
                value={draft.licenseType}
                onChange={(e) => onChange('licenseType', e.target.value)}
                placeholder="e.g., Non-Professional"
                maxLength={30}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-license-expiry" className="text-[0.95rem] font-semibold text-[#17365d]">License Expiry Date</Label>
              <Input
                id="driver-license-expiry"
                type="date"
                value={draft.licenseExpiry}
                onChange={(e) => onChange('licenseExpiry', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => setEditOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={changePasswordOpen} onOpenChange={(open) => (!isUpdatingPassword ? setChangePasswordOpen(open) : null)}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">
                Change <span className="text-[#2f9a34]">Password</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Update your account password.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3.5 overflow-y-auto px-5 pb-5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="driver-new-password" className="text-[0.95rem] font-semibold text-[#17365d]">New Password</Label>
              <Input
                id="driver-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-confirm-password" className="text-[0.95rem] font-semibold text-[#17365d]">Confirm Password</Label>
              <Input
                id="driver-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>
            <div className="space-y-3 rounded-2xl border border-sky-200/90 bg-gradient-to-b from-[#f3f9ff] to-[#eef8f2] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <div>
                <p className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-[#2a6aa4]">Security Verification</p>
                <p className="mt-0.5 text-xs text-[#4d6785]">OTP is required to change password.</p>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-sky-200/90 bg-white/90 p-2 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
                <Input
                  value={passwordOtp}
                  onChange={(e) => {
                    setPasswordOtp(e.target.value)
                    setPasswordOtpVerified(false)
                  }}
                  placeholder="Enter OTP"
                  className="h-11 rounded-xl border-sky-200 bg-white text-[0.98rem] text-slate-900 shadow-none focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
                />
                <Button type="button" variant="outline" onClick={requestPasswordOtp} disabled={isSendingPasswordOtp} className="h-11 rounded-xl border-sky-300 bg-white px-4 font-semibold text-[#1c4f80] hover:bg-sky-50">
                  {isSendingPasswordOtp ? 'Sending...' : passwordOtpSent ? 'Resend OTP' : 'Send OTP'}
                </Button>
              </div>
              <Button
                type="button"
                onClick={verifyPasswordOtp}
                disabled={isVerifyingPasswordOtp || !passwordOtp.trim()}
                className="h-11 w-full rounded-xl bg-sky-100 font-semibold text-[#1c4f80] hover:bg-sky-200"
              >
                {isVerifyingPasswordOtp ? 'Verifying...' : passwordOtpVerified ? 'OTP Verified' : 'Verify OTP'}
              </Button>
              <p className="text-[11px] text-[#67819e]">Tip: Use the latest OTP sent to your current email.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => setChangePasswordOpen(false)}
                disabled={isUpdatingPassword}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={handlePasswordUpdate}
                disabled={isUpdatingPassword}
              >
                {isUpdatingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Change Password
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
