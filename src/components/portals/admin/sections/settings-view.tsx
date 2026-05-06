'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'
import { Eye, EyeOff } from 'lucide-react'

export function SettingsView() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [profileOtp, setProfileOtp] = useState('')
  const [profileOtpSent, setProfileOtpSent] = useState(false)
  const [profileOtpVerified, setProfileOtpVerified] = useState(false)
  const [profileOtpToken, setProfileOtpToken] = useState('')
  const [isSendingProfileOtp, setIsSendingProfileOtp] = useState(false)
  const [isVerifyingProfileOtp, setIsVerifyingProfileOtp] = useState(false)
  const [passwordOtp, setPasswordOtp] = useState('')
  const [passwordOtpSent, setPasswordOtpSent] = useState(false)
  const [passwordOtpVerified, setPasswordOtpVerified] = useState(false)
  const [passwordOtpToken, setPasswordOtpToken] = useState('')
  const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false)
  const [isVerifyingPasswordOtp, setIsVerifyingPasswordOtp] = useState(false)

  const userId = (user as any)?.userId || (user as any)?.id
  const accountEmail = String((user as any)?.email || '').trim().toLowerCase()
  const accountRoleId = String((user as any)?.role || '').trim().toUpperCase()
  const normalizedEmail = email.trim().toLowerCase()
  const isEmailChanged = normalizedEmail !== accountEmail

  useEffect(() => {
    setName(String((user as any)?.name || ''))
    setEmail(String((user as any)?.email || ''))
  }, [user])

  const requestOtp = async (targetEmail: string, kind: 'profile' | 'password') => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    if (!emailToVerify) {
      toast.error('Email is required')
      return
    }
    if (kind === 'profile') setIsSendingProfileOtp(true)
    else setIsSendingPasswordOtp(true)
    try {
      const response = await fetch('/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, accountType: 'staff', roleId: accountRoleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      if (kind === 'profile') {
        setProfileOtpSent(true)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
        setProfileOtp('')
      } else {
        setPasswordOtpSent(true)
        setPasswordOtpVerified(false)
        setPasswordOtpToken('')
        setPasswordOtp('')
      }
      toast.success('OTP sent')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
    } finally {
      if (kind === 'profile') setIsSendingProfileOtp(false)
      else setIsSendingPasswordOtp(false)
    }
  }

  const verifyOtp = async (targetEmail: string, kind: 'profile' | 'password') => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    const otp = (kind === 'profile' ? profileOtp : passwordOtp).trim()
    if (!emailToVerify) {
      toast.error('Email is required')
      return
    }
    if (!otp) {
      toast.error('Enter OTP first')
      return
    }
    if (kind === 'profile') setIsVerifyingProfileOtp(true)
    else setIsVerifyingPasswordOtp(true)
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, accountType: 'staff', otp }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      const token = String(payload?.verificationToken || '').trim()
      if (!token) throw new Error('Missing verification token')
      if (kind === 'profile') {
        setProfileOtpVerified(true)
        setProfileOtpToken(token)
      } else {
        setPasswordOtpVerified(true)
        setPasswordOtpToken(token)
      }
      toast.success('OTP verified')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify OTP')
    } finally {
      if (kind === 'profile') setIsVerifyingProfileOtp(false)
      else setIsVerifyingPasswordOtp(false)
    }
  }

  const handleProfileSave = async () => {
    if (!userId) {
      toast.error('Unable to resolve user ID')
      return
    }
    if (isEmailChanged && !profileOtpVerified) {
      toast.error('Verify OTP for the new email before saving')
      return
    }

    setIsSavingProfile(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
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
        name: nextUser.name ?? name,
        email: nextUser.email ?? email,
      }))
      setName(String(nextUser.name ?? name))
      setEmail(String(nextUser.email ?? email))
      toast.success('Profile updated successfully')
      if (isEmailChanged) {
        setProfileOtpSent(false)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
        setProfileOtp('')
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
      toast.error('Verify OTP before updating password')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword, emailVerificationToken: passwordOtpToken }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to update password')
      }
      toast.success('Password updated successfully')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOtp('')
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account and preferences</p>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-6 px-1">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name</label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setProfileOtpSent(false)
                    setProfileOtpVerified(false)
                    setProfileOtpToken('')
                    setProfileOtp('')
                  }}
                />
              </div>
              {isEmailChanged ? (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-xs text-gray-600">OTP is required to change email.</p>
                  <div className="flex gap-2">
                    <Input value={profileOtp} onChange={(e) => setProfileOtp(e.target.value)} placeholder="Enter OTP" />
                    <Button type="button" variant="outline" onClick={() => void requestOtp(normalizedEmail, 'profile')} disabled={isSendingProfileOtp}>
                      {isSendingProfileOtp ? 'Sending...' : profileOtpSent ? 'Resend OTP' : 'Send OTP'}
                    </Button>
                    <Button type="button" onClick={() => void verifyOtp(normalizedEmail, 'profile')} disabled={isVerifyingProfileOtp || !profileOtp.trim()}>
                      {isVerifyingProfileOtp ? 'Verifying...' : 'Verify OTP'}
                    </Button>
                  </div>
                </div>
              ) : null}
              <Button onClick={handleProfileSave} disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Change your password</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-password" className="text-sm font-medium text-gray-700">New Password</label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" onClick={() => setShowNewPassword((v) => !v)} aria-label={showNewPassword ? 'Hide password' : 'Show password'}>
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500">{PASSWORD_POLICY_MESSAGE}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">Confirm Password</label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" onClick={() => setShowConfirmPassword((v) => !v)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs text-gray-600">OTP is required to change password.</p>
                <div className="flex gap-2">
                  <Input value={passwordOtp} onChange={(e) => setPasswordOtp(e.target.value)} placeholder="Enter OTP" />
                  <Button type="button" variant="outline" onClick={() => void requestOtp(accountEmail, 'password')} disabled={isSendingPasswordOtp}>
                    {isSendingPasswordOtp ? 'Sending...' : passwordOtpSent ? 'Resend OTP' : 'Send OTP'}
                  </Button>
                  <Button type="button" onClick={() => void verifyOtp(accountEmail, 'password')} disabled={isVerifyingPasswordOtp || !passwordOtp.trim()}>
                    {isVerifyingPasswordOtp ? 'Verifying...' : 'Verify OTP'}
                  </Button>
                </div>
              </div>
              <Button onClick={handlePasswordUpdate} disabled={isUpdatingPassword}>
                {isUpdatingPassword ? 'Updating...' : 'Update Password'}
              </Button>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
