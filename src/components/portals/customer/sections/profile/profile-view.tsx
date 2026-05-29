'use client'

import { useState } from 'react'
import type { MutableRefObject } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveClientImageUrl } from '@/lib/client-image'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { Camera, Loader2, User } from 'lucide-react'
import { toast } from 'sonner'

type CustomerProfileViewProps = {
  avatarPreviewUrl: string | null
  profileName: string
  profileEmail: string
  profilePhone: string
  composedShippingAddress: string
  shippingCity: string
  shippingProvince: string
  shippingZipCode: string
  user: any
  isSavingProfile: boolean
  avatarInputRef: MutableRefObject<HTMLInputElement | null>
  openAvatarCropDialog: (file: File | null) => Promise<void>
  setIsProfileDialogOpen: (value: boolean) => void
}

export function CustomerProfileView({
  avatarPreviewUrl,
  profileName,
  profileEmail,
  profilePhone,
  composedShippingAddress,
  shippingCity,
  shippingProvince,
  shippingZipCode,
  user,
  isSavingProfile,
  avatarInputRef,
  openAvatarCropDialog,
  setIsProfileDialogOpen,
}: CustomerProfileViewProps) {
  const resolvedAvatarPreviewUrl = resolveClientImageUrl(avatarPreviewUrl)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

  const openChangePassword = () => {
    setNewPassword('')
    setConfirmPassword('')
    setOtp('')
    setOtpSent(false)
    setOtpVerified(false)
    setChangePasswordOpen(true)
  }

  const requestPasswordOtp = async () => {
    const email = String(profileEmail || user?.email || '').trim().toLowerCase()
    if (!email) {
      toast.error('Email is required')
      return
    }
    setIsSendingOtp(true)
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
      toast.success('OTP sent')
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
      toast.error('Enter OTP first')
      return
    }
    setIsVerifyingOtp(true)
    try {
      const response = await fetch('/api/auth/password-reset/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, accountType: 'customer', otp: otp.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      setOtpVerified(true)
      toast.success('OTP verified')
    } catch (error: any) {
      setOtpVerified(false)
      toast.error(error?.message || 'Failed to verify OTP')
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
      setChangePasswordOpen(false)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center">
            <div className="relative mb-3">
              <Avatar className="h-16 w-16">
                {resolvedAvatarPreviewUrl ? <AvatarImage src={resolvedAvatarPreviewUrl} alt={profileName || user?.name || 'Profile'} className="object-cover" /> : null}
                <AvatarFallback className="bg-teal-700 text-white">{(profileName || user?.name || 'C').charAt(0).toUpperCase()}</AvatarFallback>
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
      <Card className="border-emerald-100 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900">Profile Preview</CardTitle>
          <CardDescription className="text-slate-500">View your account details. Edit opens in a popup.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 text-sm text-slate-700">
            <p><span className="font-semibold text-slate-900">Name:</span> {profileName || 'Not set'}</p>
            <p><span className="font-semibold text-slate-900">Email:</span> {profileEmail || 'Not set'}</p>
            <p><span className="font-semibold text-slate-900">Phone:</span> {profilePhone || 'Not set'}</p>
            <p><span className="font-semibold text-slate-900">Delivery Address:</span> {composedShippingAddress || 'Not set'}</p>
            <p><span className="font-semibold text-slate-900">City/Province:</span> {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'}` : 'Not set'}</p>
            <p><span className="font-semibold text-slate-900">Postal Code:</span> {shippingZipCode || 'Not set'}</p>
          </div>
          <Button
            className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
            onClick={() => setIsProfileDialogOpen(true)}
          >
            <User className="h-4 w-4 mr-2" />
            Edit Profile
          </Button>
          <Button
            variant="outline"
            className="w-full border-emerald-200 text-emerald-800 hover:bg-emerald-50"
            onClick={openChangePassword}
          >
            Change Password
          </Button>
        </CardContent>
      </Card>

      <Dialog open={changePasswordOpen} onOpenChange={(open) => (!isUpdatingPassword ? setChangePasswordOpen(open) : null)}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-emerald-100 bg-gradient-to-b from-[#f0fbf7] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-emerald-100/90 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#14532d]">
                Change <span className="text-[#059669]">Password</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#3f5f53]">
                Update your customer account password.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3.5 overflow-y-auto px-5 pb-5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="customer-new-password" className="text-[0.95rem] font-semibold text-[#14532d]">New Password</Label>
              <Input
                id="customer-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-11 rounded-xl border-emerald-200 bg-white/90 text-[0.98rem] text-slate-900 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-confirm-password" className="text-[0.95rem] font-semibold text-[#14532d]">Confirm Password</Label>
              <Input
                id="customer-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-11 rounded-xl border-emerald-200 bg-white/90 text-[0.98rem] text-slate-900 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-sky-200/90 bg-gradient-to-b from-[#f3f9ff] to-[#eef8f2] p-3.5">
              <div>
                <p className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-[#2a6aa4]">Security Verification</p>
                <p className="mt-0.5 text-xs text-[#4d6785]">OTP is required to change password.</p>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-sky-200/90 bg-white/90 p-2 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
                <Input
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value)
                    setOtpVerified(false)
                  }}
                  placeholder="Enter OTP"
                  className="h-11 rounded-xl border-sky-200 bg-white text-[0.98rem] text-slate-900 focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
                />
                <Button type="button" variant="outline" onClick={requestPasswordOtp} disabled={isSendingOtp} className="h-11 rounded-xl border-sky-300 bg-white px-4 font-semibold text-[#1c4f80] hover:bg-sky-50">
                  {isSendingOtp ? 'Sending...' : otpSent ? 'Resend OTP' : 'Send OTP'}
                </Button>
              </div>
              <Button
                type="button"
                onClick={verifyPasswordOtp}
                disabled={isVerifyingOtp || !otp.trim()}
                className="h-11 w-full rounded-xl bg-emerald-100 font-semibold text-emerald-800 hover:bg-emerald-200"
              >
                {isVerifyingOtp ? 'Verifying...' : otpVerified ? 'OTP Verified' : 'Verify OTP'}
              </Button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl border-emerald-200 bg-white/85 font-semibold text-[#14532d] hover:bg-emerald-50"
                onClick={() => setChangePasswordOpen(false)}
                disabled={isUpdatingPassword}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
                onClick={updatePassword}
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
