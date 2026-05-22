'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
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
  triggerContent?: ReactNode
}

function FieldShell({
  icon,
  children,
  invalid = false,
}: {
  icon: ReactNode
  children: ReactNode
  invalid?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-[1.15rem] bg-white/95 px-3 py-2.5 shadow-[0_8px_24px_rgba(151,193,177,0.12)] ${
        invalid ? 'border border-[#e8b5bb]' : 'border border-[#cfeadf]'
      }`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.95rem] bg-[linear-gradient(145deg,#effbf4,#daf3e6)] shadow-[0_10px_22px_rgba(16,185,129,0.12)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function ForgotPasswordDialog({
  accountType,
  initialEmail = '',
  triggerClassName,
  triggerContent,
}: ForgotPasswordDialogProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [otpError, setOtpError] = useState('')
  const [newPasswordError, setNewPasswordError] = useState('')
  const [confirmPasswordError, setConfirmPasswordError] = useState('')

  useEffect(() => {
    if (open) {
      setEmail(initialEmail || '')
      setEmailError('')
      setOtpError('')
      setNewPasswordError('')
      setConfirmPasswordError('')
    }
  }, [open, initialEmail])

  const resetDialogState = () => {
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setOtpSent(false)
    setIsSending(false)
    setIsResetting(false)
    setEmailError('')
    setOtpError('')
    setNewPasswordError('')
    setConfirmPasswordError('')
  }

  const handleSendOtp = async () => {
    if (!email.trim()) {
      setEmailError('Please enter your email.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(normalizedEmail)) {
      setEmailError('Please enter a valid email address.')
      return
    }
    setEmailError('')
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
    let hasError = false

    if (!otp.trim()) {
      setOtpError('Please enter the OTP.')
      hasError = true
    } else {
      setOtpError('')
    }

    if (!newPassword) {
      setNewPasswordError('Please enter a new password.')
      hasError = true
    } else {
      const passwordError = validatePasswordPolicy(newPassword)
      if (passwordError) {
        setNewPasswordError(passwordError)
        hasError = true
      } else {
        setNewPasswordError('')
      }
    }

    if (newPassword !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match.')
      hasError = true
    } else if (!confirmPassword) {
      setConfirmPasswordError('Please confirm your new password.')
      hasError = true
    } else {
      setConfirmPasswordError('')
    }

    if (hasError) {
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
          {triggerContent || 'Forgot password'}
        </button>
      </DialogTrigger>
      <DialogContent
        className="w-[calc(100vw-0.5rem)] max-w-[29rem] overflow-y-auto border border-white/70 bg-[linear-gradient(180deg,rgba(253,255,254,0.98),rgba(244,252,248,0.96))] p-0 shadow-[0_30px_80px_rgba(76,139,118,0.22)] max-h-[calc(100dvh-0.5rem)]"
      >
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),rgba(242,251,247,0.9)_58%,rgba(229,247,240,0.76)_100%)]" />
            <div className="absolute right-[-2.5rem] top-[-2.5rem] h-40 w-40 rounded-full border-[1.4rem] border-emerald-100/55" />
            <div className="absolute bottom-[-3rem] left-[-2rem] h-32 w-32 rounded-full bg-emerald-100/35 blur-2xl" />
            <div className="absolute right-5 top-6 h-24 w-24 rounded-full opacity-50 [background-image:radial-gradient(circle,rgba(174,231,205,0.72)_0_2px,transparent_2.8px)] [background-size:14px_14px] [mask-image:radial-gradient(circle_at_center,transparent_0_42%,black_48%_61%,transparent_67%)]" />
          </div>

          <DialogHeader className="relative border-b border-[#dbeee5] px-6 pb-5 pt-6">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[1.15rem] bg-[linear-gradient(145deg,#effbf4,#daf3e6)] shadow-[0_14px_30px_rgba(16,185,129,0.14)]">
              <ShieldCheck className="h-7 w-7 text-[#179651]" strokeWidth={2} />
            </div>
            <DialogTitle className="text-[1.75rem] font-extrabold tracking-[-0.03em] text-[#12356a]">
              Forgot password
            </DialogTitle>
            <DialogDescription className="max-w-[22rem] text-[0.95rem] leading-[1.45] text-[#5a6788]">
              We will send a one-time OTP code to your registered email address.
            </DialogDescription>
          </DialogHeader>

          <div className="relative space-y-4 px-6 py-5">
            <div className="space-y-2.5">
              <Label htmlFor="forgot-password-email" className="px-1 text-[0.88rem] font-bold text-[#12356a]">
                Email
              </Label>
              <FieldShell icon={<Mail className="h-5 w-5 text-[#179651]" strokeWidth={1.9} />} invalid={Boolean(emailError)}>
                <Input
                  id="forgot-password-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (emailError) setEmailError('')
                  }}
                  placeholder="you@example.com"
                  disabled={otpSent}
                  className={`h-auto border-0 bg-transparent p-0 text-[0.95rem] font-medium shadow-none ring-0 placeholder:text-[#98a5c0] focus-visible:ring-0 ${
                    emailError ? 'text-[#a33f46]' : 'text-[#283662]'
                  }`}
                />
              </FieldShell>
              {emailError ? (
                <p className="px-1 text-[0.78rem] font-medium text-[#c1545c]">{emailError}</p>
              ) : null}
            </div>

            {!otpSent ? (
              <Button
                type="button"
                className="h-12 w-full rounded-full bg-[linear-gradient(90deg,#17b058,#119a4a)] text-[0.98rem] font-bold text-white shadow-[0_14px_30px_rgba(22,168,80,0.28)] hover:brightness-[1.02]"
                onClick={handleSendOtp}
                disabled={isSending}
              >
                {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send OTP
                <ArrowRight className="ml-2 h-4 w-4" strokeWidth={2.6} />
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-[1.2rem] border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-[0.85rem] text-[#2f6d53]">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#179651]" strokeWidth={2.2} />
                    <span>OTP sent. Enter the code from your email, then choose a new password.</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="forgot-password-otp" className="px-1 text-[0.88rem] font-bold text-[#12356a]">
                    OTP code
                  </Label>
                  <FieldShell icon={<ShieldCheck className="h-5 w-5 text-[#179651]" strokeWidth={1.9} />} invalid={Boolean(otpError)}>
                    <Input
                      id="forgot-password-otp"
                      value={otp}
                      onChange={(e) => {
                        setOtp(e.target.value)
                        if (otpError) setOtpError('')
                      }}
                      placeholder="6-digit OTP"
                      className={`h-auto border-0 bg-transparent p-0 text-[0.95rem] font-medium shadow-none ring-0 placeholder:text-[#98a5c0] focus-visible:ring-0 ${
                        otpError ? 'text-[#a33f46]' : 'text-[#283662]'
                      }`}
                    />
                  </FieldShell>
                  {otpError ? (
                    <p className="px-1 text-[0.78rem] font-medium text-[#c1545c]">{otpError}</p>
                  ) : null}
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="forgot-password-new-password" className="px-1 text-[0.88rem] font-bold text-[#12356a]">
                    New password
                  </Label>
                  <FieldShell icon={<LockKeyhole className="h-5 w-5 text-[#179651]" strokeWidth={1.9} />} invalid={Boolean(newPasswordError)}>
                    <Input
                      id="forgot-password-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value)
                        if (newPasswordError) setNewPasswordError('')
                      }}
                      placeholder="Enter new password"
                      className={`h-auto border-0 bg-transparent p-0 text-[0.95rem] font-medium shadow-none ring-0 placeholder:text-[#98a5c0] focus-visible:ring-0 ${
                        newPasswordError ? 'text-[#a33f46]' : 'text-[#283662]'
                      }`}
                    />
                  </FieldShell>
                  {newPasswordError ? (
                    <p className="px-1 text-[0.78rem] font-medium text-[#c1545c]">{newPasswordError}</p>
                  ) : null}
                  <p className="px-1 text-[0.74rem] leading-[1.45] text-[#71809f]">{PASSWORD_POLICY_MESSAGE}</p>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="forgot-password-confirm-password" className="px-1 text-[0.88rem] font-bold text-[#12356a]">
                    Confirm new password
                  </Label>
                  <FieldShell icon={<LockKeyhole className="h-5 w-5 text-[#179651]" strokeWidth={1.9} />} invalid={Boolean(confirmPasswordError)}>
                    <Input
                      id="forgot-password-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)
                        if (confirmPasswordError) setConfirmPasswordError('')
                      }}
                      placeholder="Repeat new password"
                      className={`h-auto border-0 bg-transparent p-0 text-[0.95rem] font-medium shadow-none ring-0 placeholder:text-[#98a5c0] focus-visible:ring-0 ${
                        confirmPasswordError ? 'text-[#a33f46]' : 'text-[#283662]'
                      }`}
                    />
                  </FieldShell>
                  {confirmPasswordError ? (
                    <p className="px-1 text-[0.78rem] font-medium text-[#c1545c]">{confirmPasswordError}</p>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-full border-[#cfeadf] bg-white/80 font-semibold text-[#35507f] shadow-[0_8px_24px_rgba(151,193,177,0.1)] hover:bg-emerald-50/70 hover:text-[#12356a]"
                    onClick={() => {
                      setOtpSent(false)
                      setOtp('')
                    }}
                    disabled={isResetting}
                  >
                    Change Email
                  </Button>
                  <Button
                    type="button"
                    className="h-11 rounded-full bg-[linear-gradient(90deg,#17b058,#119a4a)] font-bold text-white shadow-[0_14px_30px_rgba(22,168,80,0.28)] hover:brightness-[1.02]"
                    onClick={handleResetPassword}
                    disabled={isResetting}
                  >
                    {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Reset Password
                    <ArrowRight className="ml-2 h-4 w-4" strokeWidth={2.6} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
