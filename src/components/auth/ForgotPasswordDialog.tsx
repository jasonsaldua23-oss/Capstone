'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail, Send, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'
import { cn } from '@/lib/utils'

type ForgotPasswordDialogProps = {
  accountType: 'staff' | 'customer'
  portal?: 'admin' | 'driver' | 'warehouse' | 'customer'
  initialEmail?: string
  triggerClassName?: string
  triggerContent?: ReactNode
}

type PortalTheme = {
  dialogContent: string
  backdrop: string
  halo: string
  orb: string
  dotRing: string
  headerBorder: string
  badge: string
  badgeIcon: string
  title: string
  description: string
  label: string
  inputBorder: string
  inputTile: string
  inputIcon: string
  fieldShadow: string
  fieldText: string
  fieldPlaceholder: string
  primaryButton: string
  secondaryButton: string
  successCard: string
  successIcon: string
  successText: string
  helperText: string
  errorText: string
  triggerFallback: string
}

const portalThemes: Record<NonNullable<ForgotPasswordDialogProps['portal']>, PortalTheme> = {
  admin: {
    dialogContent:
      'border border-white/70 bg-[linear-gradient(180deg,rgba(249,252,255,0.98),rgba(239,245,255,0.96))] shadow-[0_30px_80px_rgba(58,93,164,0.24)]',
    backdrop:
      'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.99),rgba(241,247,255,0.92)_58%,rgba(223,235,255,0.78)_100%)]',
    halo: 'right-[-2.5rem] top-[-2.5rem] h-40 w-40 rounded-full border-[1.35rem] border-indigo-100/80',
    orb: 'bottom-[-3rem] left-[-2rem] h-32 w-32 rounded-full bg-indigo-100/55 blur-2xl',
    dotRing:
      'right-5 top-6 h-24 w-24 rounded-full opacity-60 [background-image:radial-gradient(circle,rgba(129,140,248,0.68)_0_2px,transparent_2.8px)] [background-size:14px_14px] [mask-image:radial-gradient(circle_at_center,transparent_0_42%,black_48%_61%,transparent_67%)]',
    headerBorder: 'border-[#dbe4fb]',
    badge:
      'bg-[linear-gradient(145deg,#eef2ff,#dbe7ff)] shadow-[0_14px_30px_rgba(79,70,229,0.16)]',
    badgeIcon: 'text-indigo-600',
    title: 'text-[#152d63]',
    description: 'text-[#60709a]',
    label: 'text-[#18366d]',
    inputBorder: 'border-[#cfdbf5]',
    inputTile:
      'bg-[linear-gradient(145deg,#f4f7ff,#e2ebff)] shadow-[0_10px_22px_rgba(99,102,241,0.12)]',
    inputIcon: 'text-indigo-600',
    fieldShadow: 'shadow-[0_8px_24px_rgba(99,102,241,0.10)]',
    fieldText: 'text-[#283662]',
    fieldPlaceholder: 'placeholder:text-[#96a4c1]',
    primaryButton:
      'bg-[linear-gradient(90deg,#4f46e5,#2f67f6)] text-white shadow-[0_14px_30px_rgba(79,70,229,0.28)] hover:brightness-[1.03]',
    secondaryButton:
      'border-[#cfdbf5] bg-white/85 text-[#35507f] shadow-[0_8px_24px_rgba(99,102,241,0.08)] hover:bg-indigo-50/80 hover:text-[#18366d]',
    successCard: 'border-indigo-100 bg-indigo-50/85',
    successIcon: 'text-indigo-600',
    successText: 'text-[#32508d]',
    helperText: 'text-[#6e7fa3]',
    errorText: 'text-[#c1545c]',
    triggerFallback: 'w-full text-center text-sm text-slate-600 transition-colors hover:text-slate-900',
  },
  driver: {
    dialogContent:
      'border border-white/75 bg-[linear-gradient(180deg,rgba(252,255,254,0.98),rgba(241,252,247,0.96))] shadow-[0_32px_84px_rgba(53,133,104,0.24)]',
    backdrop:
      'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.99),rgba(244,252,248,0.92)_56%,rgba(225,247,236,0.78)_100%)]',
    halo: 'right-[-2.5rem] top-[-2.5rem] h-40 w-40 rounded-full border-[1.4rem] border-emerald-100/55',
    orb: 'bottom-[-3rem] left-[-2rem] h-32 w-32 rounded-full bg-emerald-100/35 blur-2xl',
    dotRing:
      'right-5 top-6 h-24 w-24 rounded-full opacity-50 [background-image:radial-gradient(circle,rgba(110,231,183,0.72)_0_2px,transparent_2.8px)] [background-size:14px_14px] [mask-image:radial-gradient(circle_at_center,transparent_0_42%,black_48%_61%,transparent_67%)]',
    headerBorder: 'border-[#dbeee5]',
    badge:
      'bg-[linear-gradient(145deg,#effbf4,#daf3e6)] shadow-[0_14px_30px_rgba(16,185,129,0.14)]',
    badgeIcon: 'text-[#179651]',
    title: 'text-[#12356a]',
    description: 'text-[#5a6788]',
    label: 'text-[#12356a]',
    inputBorder: 'border-[#cfeadf]',
    inputTile:
      'bg-[linear-gradient(145deg,#effbf4,#daf3e6)] shadow-[0_10px_22px_rgba(16,185,129,0.12)]',
    inputIcon: 'text-[#179651]',
    fieldShadow: 'shadow-[0_8px_24px_rgba(151,193,177,0.12)]',
    fieldText: 'text-[#283662]',
    fieldPlaceholder: 'placeholder:text-[#98a5c0]',
    primaryButton:
      'bg-[linear-gradient(90deg,#17b058,#119a4a)] text-white shadow-[0_14px_30px_rgba(22,168,80,0.28)] hover:brightness-[1.02]',
    secondaryButton:
      'border-[#cfeadf] bg-white/80 text-[#35507f] shadow-[0_8px_24px_rgba(151,193,177,0.1)] hover:bg-emerald-50/70 hover:text-[#12356a]',
    successCard: 'border-emerald-100 bg-emerald-50/70',
    successIcon: 'text-[#179651]',
    successText: 'text-[#2f6d53]',
    helperText: 'text-[#71809f]',
    errorText: 'text-[#c1545c]',
    triggerFallback: 'w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-700',
  },
  warehouse: {
    dialogContent:
      'border border-white/75 bg-[linear-gradient(180deg,rgba(248,253,255,0.98),rgba(238,248,255,0.96))] shadow-[0_30px_82px_rgba(27,111,145,0.24)]',
    backdrop:
      'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.99),rgba(239,249,255,0.92)_58%,rgba(221,241,251,0.78)_100%)]',
    halo: 'right-[-2.5rem] top-[-2.5rem] h-40 w-40 rounded-full border-[1.35rem] border-cyan-100/75',
    orb: 'bottom-[-3rem] left-[-2rem] h-32 w-32 rounded-full bg-sky-100/45 blur-2xl',
    dotRing:
      'right-5 top-6 h-24 w-24 rounded-full opacity-60 [background-image:radial-gradient(circle,rgba(34,211,238,0.58)_0_2px,transparent_2.8px)] [background-size:14px_14px] [mask-image:radial-gradient(circle_at_center,transparent_0_42%,black_48%_61%,transparent_67%)]',
    headerBorder: 'border-[#d5e8f4]',
    badge:
      'bg-[linear-gradient(145deg,#eef8ff,#d9f1fb)] shadow-[0_14px_30px_rgba(14,165,233,0.14)]',
    badgeIcon: 'text-sky-600',
    title: 'text-[#0d4365]',
    description: 'text-[#53708a]',
    label: 'text-[#0f466f]',
    inputBorder: 'border-[#c9e3f1]',
    inputTile:
      'bg-[linear-gradient(145deg,#eef9ff,#daeff8)] shadow-[0_10px_22px_rgba(14,165,233,0.12)]',
    inputIcon: 'text-sky-600',
    fieldShadow: 'shadow-[0_8px_24px_rgba(76,145,179,0.12)]',
    fieldText: 'text-[#234261]',
    fieldPlaceholder: 'placeholder:text-[#91a7bb]',
    primaryButton:
      'bg-[linear-gradient(90deg,#0ea5e9,#0284c7)] text-white shadow-[0_14px_30px_rgba(14,165,233,0.28)] hover:brightness-[1.03]',
    secondaryButton:
      'border-[#c9e3f1] bg-white/85 text-[#285172] shadow-[0_8px_24px_rgba(14,165,233,0.08)] hover:bg-sky-50/80 hover:text-[#0f466f]',
    successCard: 'border-sky-100 bg-sky-50/85',
    successIcon: 'text-sky-600',
    successText: 'text-[#2b6981]',
    helperText: 'text-[#678198]',
    errorText: 'text-[#c1545c]',
    triggerFallback: 'w-full text-center text-sm text-slate-600 transition-colors hover:text-slate-900',
  },
  customer: {
    dialogContent:
      'border border-white/75 bg-[linear-gradient(180deg,rgba(255,254,251,0.98),rgba(248,251,255,0.96))] shadow-[0_30px_82px_rgba(24,103,148,0.22)]',
    backdrop:
      'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.99),rgba(244,250,255,0.93)_53%,rgba(228,247,241,0.82)_100%)]',
    halo: 'right-[-2.5rem] top-[-2.5rem] h-40 w-40 rounded-full border-[1.4rem] border-sky-100/70',
    orb: 'bottom-[-3rem] left-[-2rem] h-32 w-32 rounded-full bg-emerald-100/35 blur-2xl',
    dotRing:
      'right-5 top-6 h-24 w-24 rounded-full opacity-60 [background-image:radial-gradient(circle,rgba(56,189,248,0.52)_0_2px,transparent_2.8px)] [background-size:14px_14px] [mask-image:radial-gradient(circle_at_center,transparent_0_42%,black_48%_61%,transparent_67%)]',
    headerBorder: 'border-[#dbecf7]',
    badge:
      'bg-[linear-gradient(145deg,#edf8ff,#dcf5ea)] shadow-[0_14px_30px_rgba(14,165,233,0.14)]',
    badgeIcon: 'text-sky-600',
    title: 'text-[#0f4f8f]',
    description: 'text-[#5c718c]',
    label: 'text-[#12527f]',
    inputBorder: 'border-[#d4e8f4]',
    inputTile:
      'bg-[linear-gradient(145deg,#edf8ff,#e1f6ee)] shadow-[0_10px_22px_rgba(14,165,233,0.10)]',
    inputIcon: 'text-sky-600',
    fieldShadow: 'shadow-[0_8px_24px_rgba(64,145,191,0.10)]',
    fieldText: 'text-[#294463]',
    fieldPlaceholder: 'placeholder:text-[#94a6bb]',
    primaryButton:
      'bg-[linear-gradient(90deg,#0284c7,#22c55e)] text-white shadow-[0_14px_30px_rgba(3,105,161,0.24)] hover:brightness-[1.03]',
    secondaryButton:
      'border-[#d4e8f4] bg-white/90 text-[#30597a] shadow-[0_8px_24px_rgba(14,165,233,0.08)] hover:bg-sky-50/75 hover:text-[#12527f]',
    successCard: 'border-emerald-100 bg-emerald-50/80',
    successIcon: 'text-emerald-600',
    successText: 'text-[#2c6e5f]',
    helperText: 'text-[#6d8197]',
    errorText: 'text-[#c1545c]',
    triggerFallback: 'w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-700',
  },
}

function FieldShell({
  icon,
  children,
  invalid = false,
  theme,
}: {
  icon: ReactNode
  children: ReactNode
  invalid?: boolean
  theme: PortalTheme
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[1.15rem] bg-white/95 px-3 py-2.5',
        theme.fieldShadow,
        invalid ? 'border border-[#e8b5bb]' : `border ${theme.inputBorder}`
      )}
    >
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.95rem]', theme.inputTile)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function ForgotPasswordDialog({
  accountType,
  portal = accountType === 'customer' ? 'customer' : 'admin',
  initialEmail = '',
  triggerClassName,
  triggerContent,
}: ForgotPasswordDialogProps) {
  const theme = portalThemes[portal]
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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

  useEffect(() => {
    if (!otpCooldown) return
    const timer = window.setInterval(() => {
      setOtpCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [otpCooldown])

  const resetDialogState = () => {
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setOtpSent(false)
    setIsSending(false)
    setIsResetting(false)
    setOtpCooldown(0)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
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
      setOtpCooldown(30)
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
        <button type="button" className={triggerClassName || theme.triggerFallback}>
          {triggerContent || 'Forgot password'}
        </button>
      </DialogTrigger>
      <DialogContent className="w-[420px] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto rounded-[16px] border border-[#dbe6f4] bg-white p-0 shadow-[0_14px_30px_rgba(15,44,89,0.22)]">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-20 grid h-7 w-7 place-items-center rounded-full bg-[#edf3fb] text-[#6b7e9a] hover:bg-[#e3edf8]"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <DialogHeader className="relative border-b border-[#dde7f3] px-5 pb-3 pt-4 pr-11 text-left">
            <div className="grid gap-3 grid-cols-[1fr_auto] items-center">
              <div>
                <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-[#eaf2fc]">
                  <ShieldCheck className="h-5 w-5 text-[#1e86e0]" strokeWidth={2.1} />
                </div>
                <DialogTitle className="text-[20px] font-extrabold tracking-[-0.02em] leading-[1.05] text-[#0f3871]">
                  Forgot password?
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-[230px] text-[11px] leading-[1.35] text-[#60779a]">
                  We will send a one-time OTP code to your registered email address.
                </DialogDescription>
              </div>
              <div className="mr-2 h-[94px] w-[112px] items-center justify-center flex">
                <div className="grid h-[88px] w-[106px] place-items-center rounded-[16px] bg-gradient-to-b from-[#e9f2ff] to-[#d5e6fb]">
                  <LockKeyhole className="h-8 w-8 text-[#1e86e0]" />
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="relative space-y-3 px-5 py-3.5">
            <div className="space-y-2">
              <Label htmlFor="forgot-password-email" className="px-0.5 text-[12px] font-semibold text-[#123d72]">
                Email address
              </Label>
              <div className={cn('flex items-center gap-4 rounded-[22px] border bg-white px-4 py-3 shadow-[0_6px_16px_rgba(26,66,118,0.08)]', emailError ? 'border-[#e8b5bb]' : 'border-[#d5e2f0]')}>
                <div className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#eaf2fc]">
                  <Mail className="h-5 w-5 text-[#1e86e0]" />
                </div>
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
                  className={cn('h-auto border-0 bg-transparent p-0 text-[12px] font-medium text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0')}
                />
              </div>
              {emailError ? <p className="px-1 text-sm font-medium text-[#c1545c]">{emailError}</p> : null}
            </div>

            {!otpSent ? (
              <Button
                type="button"
                className="h-[40px] w-full rounded-full bg-gradient-to-r from-[#2693f8] to-[#0e6fe0] text-[12px] font-bold text-white shadow-[0_10px_16px_rgba(17,110,216,0.26)] hover:brightness-[1.03]"
                onClick={handleSendOtp}
                disabled={isSending}
              >
                {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send OTP
              </Button>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[16px] border border-[#aee7bf] bg-[#eaf9ef] px-4 py-3 text-base text-[#2d6c48]">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2db452]" strokeWidth={2.2} />
                    <span>OTP sent. Enter the code from your email, then choose a new password.</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="forgot-password-otp" className="px-1 text-[1rem] font-bold text-[#123d72]">
                    OTP code
                  </Label>
                  <div className={cn('flex items-center gap-4 rounded-[22px] border bg-white px-4 py-3 shadow-[0_6px_16px_rgba(26,66,118,0.08)]', otpError ? 'border-[#e8b5bb]' : 'border-[#d5e2f0]')}>
                    <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#eaf2fc]">
                      <ShieldCheck className="h-6 w-6 text-[#1e86e0]" />
                    </div>
                    <Input
                      id="forgot-password-otp"
                      value={otp}
                      onChange={(e) => {
                        setOtp(e.target.value)
                        if (otpError) setOtpError('')
                      }}
                      placeholder="Enter 6-digit OTP"
                      className="h-auto border-0 bg-transparent p-0 text-[0.98rem] font-medium text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0"
                    />
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={isSending || otpCooldown > 0}
                      className="shrink-0 text-[1rem] font-semibold text-[#1e86e0] disabled:cursor-not-allowed disabled:text-[#94a6bf]"
                    >
                      {otpCooldown > 0 ? `Resend OTP (${otpCooldown}s)` : 'Resend OTP'}
                    </button>
                  </div>
                  {otpError ? <p className="px-1 text-sm font-medium text-[#c1545c]">{otpError}</p> : null}
                </div>

                <div className="space-y-3">
                  <Label htmlFor="forgot-password-new-password" className="px-1 text-[1rem] font-bold text-[#123d72]">
                    New password
                  </Label>
                  <div className={cn('flex items-center gap-4 rounded-[22px] border bg-white px-4 py-3 shadow-[0_6px_16px_rgba(26,66,118,0.08)]', newPasswordError ? 'border-[#e8b5bb]' : 'border-[#d5e2f0]')}>
                    <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#eaf2fc]">
                      <LockKeyhole className="h-6 w-6 text-[#1e86e0]" />
                    </div>
                    <Input
                      id="forgot-password-new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value)
                        if (newPasswordError) setNewPasswordError('')
                      }}
                      placeholder="Enter new password"
                      className="h-auto border-0 bg-transparent p-0 text-[0.98rem] font-medium text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0"
                    />
                    <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="shrink-0 text-[#95a7bf]">
                      {showNewPassword ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />}
                    </button>
                  </div>
                  {newPasswordError ? (
                    <p className="px-1 text-sm font-medium text-[#c1545c]">{newPasswordError}</p>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <Label htmlFor="forgot-password-confirm-password" className="px-1 text-[1rem] font-bold text-[#123d72]">
                    Confirm new password
                  </Label>
                  <div className={cn('flex items-center gap-4 rounded-[22px] border bg-white px-4 py-3 shadow-[0_6px_16px_rgba(26,66,118,0.08)]', confirmPasswordError ? 'border-[#e8b5bb]' : 'border-[#d5e2f0]')}>
                    <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#eaf2fc]">
                      <LockKeyhole className="h-6 w-6 text-[#1e86e0]" />
                    </div>
                    <Input
                      id="forgot-password-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)
                        if (confirmPasswordError) setConfirmPasswordError('')
                      }}
                      placeholder="Repeat new password"
                      className="h-auto border-0 bg-transparent p-0 text-[0.98rem] font-medium text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="shrink-0 text-[#95a7bf]">
                      {showConfirmPassword ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />}
                    </button>
                  </div>
                  {confirmPasswordError ? (
                    <p className="px-1 text-sm font-medium text-[#c1545c]">{confirmPasswordError}</p>
                  ) : null}
                </div>

                <div className="rounded-[18px] border border-[#d7e6f5] bg-[#eef6ff] px-5 py-4 text-[#385679]">
                  <p className="text-[1rem] font-semibold">Password must be at least 8 characters and include:</p>
                  <p className="mt-1.5 text-[0.92rem] leading-[1.45]">{PASSWORD_POLICY_MESSAGE}</p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-[48px] rounded-full border-[#4fa6ef] bg-white text-[0.98rem] font-semibold text-[#1f86df] hover:bg-[#f1f8ff]"
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
                    className="h-[48px] rounded-full bg-gradient-to-r from-[#1f92f2] to-[#116ed8] text-[1rem] font-bold text-white shadow-[0_14px_24px_rgba(17,110,216,0.3)] hover:brightness-[1.03]"
                    onClick={handleResetPassword}
                    disabled={isResetting}
                  >
                    {isResetting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Reset Password
                    <ArrowRight className="ml-2 h-5 w-5" strokeWidth={2.6} />
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
