'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'

type ForgotPasswordDialogProps = {
  accountType: 'staff' | 'customer'
  initialEmail?: string
  triggerClassName?: string
}

export function ForgotPasswordDialog({ accountType, initialEmail = '', triggerClassName }: ForgotPasswordDialogProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    if (open) setEmail(initialEmail || '')
  }, [open, initialEmail])

  const resetDialogState = () => {
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setOtpSent(false)
    setIsSending(false)
    setIsResetting(false)
  }

  const handleSendOtp = async () => {
    if (!email.trim()) {
      toast.error('Please enter your email.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(normalizedEmail)) {
      toast.error('Please enter a valid email address.')
      return
    }
    setIsSending(true)
    try {
      const response = await fetch('/api/auth/password-reset/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          accountType,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to send OTP.')
      }
      setOtpSent(true)
      toast.success('OTP sent. Check your email inbox.')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP.')
    } finally {
      setIsSending(false)
    }
  }

  const handleResetPassword = async () => {
    if (!otp.trim()) {
      toast.error('Please enter the OTP.')
      return
    }
    if (!newPassword) {
      toast.error('Please enter a new password.')
      return
    }
    const passwordError = validatePasswordPolicy(newPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    setIsResetting(true)
    try {
      const response = await fetch('/api/auth/password-reset/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          accountType,
          otp: otp.trim(),
          newPassword,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to reset password.')
      }
      toast.success('Password reset successful. You can now log in.')
      setOpen(false)
      resetDialogState()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to reset password.')
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetDialogState()
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={triggerClassName || 'w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors'}>
          Forgot password
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forgot password</DialogTitle>
          <DialogDescription>We will send a one-time OTP code to your email address.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="forgot-password-email">Email</Label>
            <Input
              id="forgot-password-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={otpSent}
            />
          </div>

          {!otpSent ? (
            <Button type="button" className="w-full" onClick={handleSendOtp} disabled={isSending}>
              {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send OTP
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="forgot-password-otp">OTP code</Label>
                <Input id="forgot-password-otp" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit OTP" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-password-new-password">New password</Label>
                <Input
                  id="forgot-password-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
                <p className="text-xs text-slate-500">{PASSWORD_POLICY_MESSAGE}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgot-password-confirm-password">Confirm new password</Label>
                <Input
                  id="forgot-password-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOtpSent(false)
                    setOtp('')
                  }}
                  disabled={isResetting}
                >
                  Change Email
                </Button>
                <Button type="button" onClick={handleResetPassword} disabled={isResetting}>
                  {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Reset Password
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
