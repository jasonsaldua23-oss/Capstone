'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock, LockKeyhole, Mail, Send, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { validatePasswordPolicy } from '@/lib/password-policy'
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
  const [otpVals, setOtpVals] = useState<string[]>(Array(6).fill(''))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpVerified, setOtpVerified] = useState(false)
  
  // OTP popup states
  const [isOtpDialogOpen, setIsOtpDialogOpen] = useState(false)
  const [otpExpiry, setOtpExpiry] = useState(120)
  const [otpCooldown, setOtpCooldown] = useState(60)

  const [isSending, setIsSending] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
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
    let interval: ReturnType<typeof setInterval>
    if (otpSent) {
      interval = setInterval(() => {
        setOtpExpiry((prev) => (prev > 0 ? prev - 1 : 0))
        setOtpCooldown((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [otpSent])

  const resetDialogState = () => {
    setOtp('')
    setOtpVals(Array(6).fill(''))
    setNewPassword('')
    setConfirmPassword('')
    setOtpSent(false)
    setOtpVerified(false)
    setIsOtpDialogOpen(false)
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
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
    setOtpError('')
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
      setOtpVerified(false)
      setOtpExpiry(120)
      setOtpCooldown(60)
      setOtpVals(Array(6).fill(''))
      setOtp('')
      setIsOtpDialogOpen(true)
      toast.success('OTP sent. Check your email inbox.')
      setTimeout(() => {
        document.getElementById('forgot-otp-input-0')?.focus()
      }, 200)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP.')
    } finally {
      setIsSending(false)
    }
  }

  const verifyForgotPasswordOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!otp.trim()) {
      setOtpError('Please enter the OTP.')
      return
    }
    setIsVerifyingOtp(true)
    setOtpError('')
    try {
      const response = await fetch('/api/auth/password-reset/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          accountType,
          otp: otp.trim(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Invalid or expired OTP.')
      }
      setOtpVerified(true)
      setIsOtpDialogOpen(false)
      toast.success('OTP verified successfully.')
    } catch (error: any) {
      setOtpVerified(false)
      setOtpError(error?.message || 'Invalid or expired OTP.')
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleResetPassword = async () => {
    let hasError = false

    if (!otp.trim()) {
      setOtpError('Please verify your OTP first.')
      hasError = true
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

  // Multi-box OTP handlers
  const handleOtpChange = (value: string, idx: number) => {
    setOtpError('')
    const cleanVal = value.replace(/\D/g, '').slice(-1)
    const nextVals = [...otpVals]
    nextVals[idx] = cleanVal
    setOtpVals(nextVals)
    setOtp(nextVals.join(''))

    if (cleanVal && idx < 5) {
      document.getElementById(`forgot-otp-input-${idx + 1}`)?.focus()
    }
  }

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace') {
      if (!otpVals[idx] && idx > 0) {
        const prevInput = document.getElementById(`forgot-otp-input-${idx - 1}`)
        prevInput?.focus()
      }
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    setOtpError('')
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pastedData.length === 6) {
      const nextVals = pastedData.split('')
      setOtpVals(nextVals)
      setOtp(pastedData)
      document.getElementById('forgot-otp-input-5')?.focus()
    }
  }

  // Dynamic colors based on portal
  const focusRingClass = {
    admin: 'focus:border-indigo-500 focus:ring-indigo-100',
    driver: 'focus:border-emerald-500 focus:ring-emerald-100',
    warehouse: 'focus:border-sky-500 focus:ring-sky-100',
    customer: 'focus:border-emerald-500 focus:ring-emerald-100',
  }[portal]

  const accentColor = {
    admin: 'text-indigo-600',
    driver: 'text-[#179651]',
    warehouse: 'text-sky-600',
    customer: 'text-[#14532d]',
  }[portal]

  const accentBg = {
    admin: 'bg-indigo-50',
    driver: 'bg-emerald-50',
    warehouse: 'bg-sky-50',
    customer: 'bg-emerald-50',
  }[portal]

  return (
    <>
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
        <DialogContent className="w-[420px] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto rounded-[24px] border border-[#dbe6f4] bg-white p-0 shadow-[0_20px_50px_rgba(15,44,89,0.15)]">
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-slate-50 text-[#6b7e9a] hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <DialogHeader className="relative border-b border-[#dde7f3] px-5 pb-3.5 pt-4 pr-11 text-left">
              <div className="grid gap-3 grid-cols-[1fr_auto] items-center">
                <div>
                  <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eaf2fc]">
                    <ShieldCheck className="h-5 w-5 text-[#1e86e0]" strokeWidth={2.1} />
                  </div>
                  <DialogTitle className="text-[18px] font-bold tracking-tight text-[#0f3871]">
                    Forgot password?
                  </DialogTitle>
                  <DialogDescription className="mt-1.5 max-w-[230px] text-xs leading-relaxed text-[#60779a]">
                    We will send a one-time OTP code to your registered email address.
                  </DialogDescription>
                </div>
                <div className="mr-1 h-[84px] w-[100px] items-center justify-center flex">
                  <div className="grid h-[78px] w-[92px] place-items-center rounded-[18px] bg-gradient-to-b from-[#e9f2ff] to-[#d5e6fb]">
                    <LockKeyhole className="h-8 w-8 text-[#1e86e0]" />
                  </div>
                </div>
              </div>
            </DialogHeader>

            {isOtpDialogOpen ? (
              /* The code is entered here, in place, rather than in a second dialog
                 stacked on this one. Back returns to the email step with the code and
                 its countdown intact. */
              <div className="relative space-y-4 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setIsOtpDialogOpen(false)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#60779a] transition-colors hover:text-[#0f3871]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
                <p className="max-w-xs text-xs leading-relaxed text-[#60779a]">
                  We sent a 6-digit verification code to{' '}
                  <span className="font-semibold text-[#0f3871]">{email.trim().toLowerCase()}</span>
                </p>
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
                    id={`forgot-otp-input-${idx}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={otpVals[idx] || ''}
                    placeholder={String(idx + 1)}
                    onChange={(e) => handleOtpChange(e.target.value, idx)}
                    onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                    className={cn(
                      "w-9 h-11 sm:w-11 sm:h-13 text-center text-lg sm:text-xl font-bold rounded-xl border border-slate-200 focus:outline-none focus:ring-2 bg-white text-slate-800 transition-all placeholder:text-slate-300",
                      focusRingClass
                    )}
                  />
                ))}
              </div>
              
              {otpExpiry > 0 ? (
                <p className="text-xs font-semibold text-slate-500">
                  Code expires in <span className={cn("font-bold", accentColor)}>{formatTime(otpExpiry)}</span>
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
                onClick={verifyForgotPasswordOtp}
                disabled={isVerifyingOtp || otp.length < 6 || otpExpiry === 0}
                className={cn("w-full h-11 text-white rounded-xl font-semibold hover:brightness-[1.03] transition-all", accentColor === 'text-[#14532d]' || accentColor === 'text-[#179651]' ? 'bg-[#14532d]' : accentColor === 'text-sky-600' ? 'bg-sky-600' : 'bg-indigo-600')}
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
                {otpCooldown > 0 ? (
                  <span className="text-xs text-slate-400 font-medium">
                    Resend code in <span className="font-semibold">{otpCooldown}s</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={isSending}
                    className={cn("text-xs font-bold hover:underline", accentColor)}
                  >
                    {isSending ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
            </div>
          </div>
              </div>
            ) : (
            <div className="relative space-y-4 px-5 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-password-email" className="px-0.5 text-xs font-semibold text-[#123d72]">
                  Email address
                </Label>
                <div className={cn('flex items-center gap-3.5 rounded-[18px] border bg-white px-3 py-2.5 shadow-[0_4px_12px_rgba(26,66,118,0.03)]', emailError ? 'border-red-300' : 'border-[#d5e2f0]')}>
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf2fc] shrink-0">
                    <Mail className="h-4.5 w-4.5 text-[#1e86e0]" />
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
                    className="h-auto border-0 bg-transparent p-0 text-xs font-semibold text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0"
                  />
                </div>
                {emailError ? <p className="px-1 text-xs font-semibold text-red-600">{emailError}</p> : null}
              </div>

              {!otpVerified ? (
                <Button
                  type="button"
                  className="h-[44px] w-full rounded-xl bg-gradient-to-r from-[#2693f8] to-[#0e6fe0] text-xs font-bold text-white shadow-[0_8px_16px_rgba(17,110,216,0.15)] hover:brightness-[1.03] transition-all"
                  onClick={() => {
                    // Requesting again would restart a countdown the customer is
                    // already racing, so a live code is entered rather than replaced.
                    if (otpSent && otpExpiry > 0) {
                      setIsOtpDialogOpen(true)
                      return
                    }
                    void handleSendOtp()
                  }}
                  disabled={isSending}
                >
                  {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  {otpSent && otpExpiry > 0 ? 'Enter OTP' : 'Send Verification OTP'}
                </Button>
              ) : (
                <div className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-password-new-password" className="px-0.5 text-xs font-semibold text-[#123d72]">
                      New password
                    </Label>
                    <div className={cn('flex items-center gap-3.5 rounded-[18px] border bg-white px-3 py-2.5 shadow-[0_4px_12px_rgba(26,66,118,0.03)]', newPasswordError ? 'border-red-300' : 'border-[#d5e2f0]')}>
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf2fc] shrink-0">
                        <LockKeyhole className="h-4.5 w-4.5 text-[#1e86e0]" />
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
                        className="h-auto border-0 bg-transparent p-0 text-xs font-semibold text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0"
                      />
                      <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="shrink-0 text-[#95a7bf]">
                        {showNewPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                    {newPasswordError ? (
                      <p className="px-1 text-xs font-semibold text-red-600">{newPasswordError}</p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-password-confirm-password" className="px-0.5 text-xs font-semibold text-[#123d72]">
                      Confirm new password
                    </Label>
                    <div className={cn('flex items-center gap-3.5 rounded-[18px] border bg-white px-3 py-2.5 shadow-[0_4px_12px_rgba(26,66,118,0.03)]', confirmPasswordError ? 'border-red-300' : 'border-[#d5e2f0]')}>
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf2fc] shrink-0">
                        <LockKeyhole className="h-4.5 w-4.5 text-[#1e86e0]" />
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
                        className="h-auto border-0 bg-transparent p-0 text-xs font-semibold text-[#263c5a] placeholder:text-[#8ea2be] shadow-none ring-0 focus-visible:ring-0"
                      />
                      <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="shrink-0 text-[#95a7bf]">
                        {showConfirmPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                    {confirmPasswordError ? (
                      <p className="px-1 text-xs font-semibold text-red-600">{confirmPasswordError}</p>
                    ) : null}
                  </div>

                  {/* Password Policy Real-time Verification Checklist Widget */}
                  <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Password Requirements</p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-0.5">
                      <RequirementRow label="Min 8 characters" met={newPassword.length >= 8} />
                      <RequirementRow label="Uppercase letter" met={/[A-Z]/.test(newPassword)} />
                      <RequirementRow label="Lowercase letter" met={/[a-z]/.test(newPassword)} />
                      <RequirementRow label="One number" met={/\d/.test(newPassword)} />
                      <RequirementRow label="Special character" met={/[^A-Za-z0-9\s]/.test(newPassword)} />
                      <RequirementRow label="No spaces" met={newPassword.length > 0 && !/\s/.test(newPassword)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-[40px] rounded-xl border-[#d5e2f0] bg-white text-xs font-bold text-[#1f86df] hover:bg-[#f1f8ff]"
                      onClick={() => {
                        setOtpSent(false)
                        setOtpVerified(false)
                        setOtp('')
                        setOtpVals(Array(6).fill(''))
                      }}
                      disabled={isResetting}
                    >
                      Change Email
                    </Button>
                    <Button
                      type="button"
                      className="h-[40px] rounded-xl bg-gradient-to-r from-[#1f92f2] to-[#116ed8] text-xs font-bold text-white shadow-[0_8px_16px_rgba(17,110,216,0.15)] hover:brightness-[1.03] transition-all"
                      onClick={handleResetPassword}
                      disabled={isResetting}
                    >
                      {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Reset Password
                    </Button>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </>
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
