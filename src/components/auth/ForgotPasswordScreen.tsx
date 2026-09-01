'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Minus,
  RotateCcw,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { cn } from '@/lib/utils'

type Portal = 'admin' | 'driver' | 'warehouse' | 'customer'

type ForgotPasswordScreenProps = {
  accountType: 'staff' | 'customer'
  portal: Portal
}

/**
 * One accent and one deep brand tone per portal, both flat. Everything else on the
 * page - ink, muted text, hairlines - is shared, so a single hue carries emphasis.
 */
const portalThemes: Record<Portal, { name: string; accent: string; accentTint: string; rail: string }> = {
  admin: { name: 'Administrator Portal', accent: '#0E6FE0', accentTint: '#EAF2FC', rail: '#12377F' },
  warehouse: { name: 'Warehouse Staff Portal', accent: '#0F4FD3', accentTint: '#E9F0FF', rail: '#0B3AA8' },
  driver: { name: 'Driver Portal', accent: '#12874A', accentTint: '#E8F5EE', rail: '#0F5C33' },
  customer: { name: 'Customer Shop', accent: '#3B8F31', accentTint: '#EDF6EA', rail: '#14532D' },
}

type Step = 'email' | 'otp' | 'password' | 'done'

const steps: { key: Step; title: string; caption: string }[] = [
  { key: 'email', title: 'Confirm your email', caption: 'We send a 6-digit code to the address on your account.' },
  { key: 'otp', title: 'Enter the code', caption: 'The code stays valid for two minutes.' },
  { key: 'password', title: 'Set a new password', caption: 'It has to meet every requirement listed.' },
]

// Shared control geometry: one 48px height and one 12px radius across every field and
// button, so no two controls on the page disagree.
const fieldShell =
  'flex h-12 items-center gap-3 rounded-xl border border-[#D7DDE5] bg-white px-4 transition-colors focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20 motion-reduce:transition-none'
const fieldInput =
  'h-full border-0 bg-transparent p-0 text-sm font-medium text-[#2A2A2A] shadow-none ring-0 placeholder:font-normal placeholder:text-[#98A2B3] focus-visible:ring-0'
const primaryButton =
  'h-12 w-full rounded-xl bg-[var(--accent)] text-sm font-semibold text-white transition-colors hover:brightness-[0.94] disabled:opacity-60 motion-reduce:transition-none'

export function ForgotPasswordScreen({ accountType, portal }: ForgotPasswordScreenProps) {
  const theme = portalThemes[portal]
  const searchParams = useSearchParams()
  const loginPath = `/login/${portal}`

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpVals, setOtpVals] = useState<string[]>(Array(6).fill(''))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpSent, setOtpSent] = useState(false)

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

  // The login form hands over whatever address was already typed there.
  useEffect(() => {
    const prefill = searchParams?.get('email')
    if (prefill) setEmail(prefill)
  }, [searchParams])

  useEffect(() => {
    if (!otpSent) return
    const interval = setInterval(() => {
      setOtpExpiry((prev) => (prev > 0 ? prev - 1 : 0))
      setOtpCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [otpSent])

  const activeStepIndex = useMemo(() => {
    if (step === 'done') return steps.length
    return steps.findIndex((entry) => entry.key === step)
  }, [step])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleSendOtp = async () => {
    if (!email.trim()) {
      setEmailError('Enter the email address on your account.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(normalizedEmail)) {
      setEmailError('That address looks incomplete. Check it for typos.')
      return
    }
    setEmailError('')
    setIsSending(true)
    setOtpError('')
    try {
      const response = await fetch('/api/auth/password-reset/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, accountType }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'We could not send the code. Try again in a moment.')
      }
      setOtpSent(true)
      setOtpExpiry(120)
      setOtpCooldown(60)
      setOtpVals(Array(6).fill(''))
      setOtp('')
      setStep('otp')
      toast.success('Code sent. Check your email inbox.')
      setTimeout(() => {
        document.getElementById('forgot-otp-input-0')?.focus()
      }, 200)
    } catch (error: any) {
      toast.error(error?.message || 'We could not send the code. Try again in a moment.')
    } finally {
      setIsSending(false)
    }
  }

  const verifyForgotPasswordOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!otp.trim()) {
      setOtpError('Enter the 6-digit code from your email.')
      return
    }
    setIsVerifyingOtp(true)
    setOtpError('')
    try {
      const response = await fetch('/api/auth/password-reset/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, accountType, otp: otp.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'That code is wrong or has expired. Request a new one.')
      }
      setStep('password')
      toast.success('Code verified.')
    } catch (error: any) {
      setOtpError(error?.message || 'That code is wrong or has expired. Request a new one.')
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleResetPassword = async () => {
    let hasError = false

    if (!otp.trim()) {
      setOtpError('Verify the code before setting a new password.')
      hasError = true
    }

    if (!newPassword) {
      setNewPasswordError('Enter a new password.')
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

    if (!confirmPassword) {
      setConfirmPasswordError('Re-enter the new password to confirm it.')
      hasError = true
    } else if (newPassword !== confirmPassword) {
      setConfirmPasswordError('Both passwords have to match.')
      hasError = true
    } else {
      setConfirmPasswordError('')
    }

    if (hasError) return

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
        throw new Error(data?.error || 'We could not update the password. Try again in a moment.')
      }
      setOtpSent(false)
      setStep('done')
      toast.success('Password updated. You can log in now.')
    } catch (error: any) {
      toast.error(error?.message || 'We could not update the password. Try again in a moment.')
    } finally {
      setIsResetting(false)
    }
  }

  const returnToEmailStep = () => {
    setStep('email')
    setOtpSent(false)
    setOtp('')
    setOtpVals(Array(6).fill(''))
    setOtpError('')
    setNewPassword('')
    setConfirmPassword('')
    setNewPasswordError('')
    setConfirmPasswordError('')
  }

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
    if (e.key === 'Backspace' && !otpVals[idx] && idx > 0) {
      document.getElementById(`forgot-otp-input-${idx - 1}`)?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    setOtpError('')
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pastedData.length === 6) {
      setOtpVals(pastedData.split(''))
      setOtp(pastedData)
      document.getElementById('forgot-otp-input-5')?.focus()
    }
  }

  return (
    <div
      className="relative min-h-dvh w-full bg-[#E9EEF2] bg-cover bg-center bg-no-repeat sm:min-h-screen"
      style={
        {
          backgroundImage: "url('/customer-login-bg.png')",
          '--accent': theme.accent,
          '--accent-tint': theme.accentTint,
          '--rail': theme.rail,
        } as React.CSSProperties
      }
    >
      {/* Flat scrim, not a gradient: one translucent wash so the card stays legible
          over the product photography the login screens also use. */}
      <div className="absolute inset-0 bg-[#E9EEF2]/75" aria-hidden />

      <Toaster position="top-right" />

      <div className="relative mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6 sm:py-12">
        <Link
          href={loginPath}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#2A2A2A] transition-colors hover:text-[var(--accent)] motion-reduce:transition-none"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>

        <div className="overflow-hidden rounded-2xl border border-[#DDE3EA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_16px_32px_-16px_rgba(16,24,40,0.24)]">
          <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
            {/* Brand rail: identity plus where the reset stands - the context a full
                page has room for and a small dialog never did. */}
            <aside className="bg-[var(--rail)] px-6 py-8 text-white sm:px-8">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1.5">
                  <img src="/ann-anns-logo.png" alt="Ann Ann's Beverages Trading logo" className="h-full w-full object-contain" />
                </span>
                <span className="text-sm leading-5">
                  <span className="block font-semibold">Ann Ann&apos;s Beverages</span>
                  <span className="block text-white/70">{theme.name}</span>
                </span>
              </div>

              <h1 className="mt-8 text-2xl font-semibold leading-8">Reset your password</h1>
              <p className="mt-2 text-sm leading-6 text-white/70">
                Three steps: confirm your email, enter the code we send, then choose a new password.
              </p>

              <ol className="mt-8 space-y-6">
                {steps.map((entry, index) => {
                  const isDone = index < activeStepIndex
                  const isActive = index === activeStepIndex
                  return (
                    <li key={entry.key} className="relative flex gap-4">
                      {index < steps.length - 1 ? (
                        <span className="absolute left-[13px] top-9 h-[calc(100%+0.5rem)] w-px bg-white/20" aria-hidden />
                      ) : null}
                      <span
                        className={cn(
                          'relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors motion-reduce:transition-none',
                          isActive
                            ? 'border-white bg-white text-[var(--rail)]'
                            : isDone
                              ? 'border-white/60 bg-transparent text-white'
                              : 'border-white/30 bg-transparent text-white/60'
                        )}
                        aria-current={isActive ? 'step' : undefined}
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      <span className="block">
                        <span className={cn('block text-sm font-semibold leading-5', isActive || isDone ? 'text-white' : 'text-white/60')}>
                          {entry.title}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-white/60">{entry.caption}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>

              <p className="mt-8 border-t border-white/15 pt-6 text-xs leading-5 text-white/60">
                Codes go only to addresses already registered with Ann Ann&apos;s Beverages Trading. Nothing in your inbox? Check
                the spam folder before asking for another.
              </p>
            </aside>

            <section className="px-6 py-8 sm:px-10 sm:py-10">
              {step === 'email' ? (
                <form
                  key="email"
                  className="auth-step-enter mx-auto max-w-[400px]"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSendOtp()
                  }}
                >
                  <StepHeading
                    icon={<Mail className="h-5 w-5 text-[var(--accent)]" />}
                    eyebrow="Step 1 of 3"
                    title="Confirm your email"
                    description="We send a one-time code to the email address registered on your account."
                  />

                  <div className="mt-8 space-y-2">
                    <Label htmlFor="forgot-password-email" className="text-xs font-semibold text-[#2A2A2A]">
                      Email address
                    </Label>
                    <div className={cn(fieldShell, emailError && 'border-[#B42318]')}>
                      <Mail className="h-4 w-4 shrink-0 text-[#667085]" aria-hidden />
                      <Input
                        id="forgot-password-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (emailError) setEmailError('')
                        }}
                        placeholder="you@example.com"
                        aria-invalid={Boolean(emailError)}
                        className={fieldInput}
                      />
                    </div>
                    {emailError ? <FieldError>{emailError}</FieldError> : null}
                  </div>

                  <Button type="submit" disabled={isSending} className={cn('mt-6', primaryButton)}>
                    {isSending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send verification code
                  </Button>

                  <p className="mt-6 text-center text-sm text-[#667085]">
                    Remembered it after all?{' '}
                    <Link href={loginPath} className="font-semibold text-[var(--accent)] hover:underline">
                      Back to login
                    </Link>
                  </p>
                </form>
              ) : null}

              {step === 'otp' ? (
                <form
                  key="otp"
                  className="auth-step-enter mx-auto max-w-[400px]"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void verifyForgotPasswordOtp()
                  }}
                >
                  <StepHeading
                    icon={<ShieldCheck className="h-5 w-5 text-[var(--accent)]" />}
                    eyebrow="Step 2 of 3"
                    title="Enter the code"
                    description={
                      <>
                        We sent a 6-digit code to <span className="font-semibold text-[#2A2A2A]">{email.trim().toLowerCase()}</span>
                      </>
                    }
                  />

                  <div className="mt-8 flex justify-between gap-2" onPaste={handleOtpPaste}>
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <input
                        key={idx}
                        id={`forgot-otp-input-${idx}`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        aria-label={`Digit ${idx + 1} of 6`}
                        value={otpVals[idx] || ''}
                        onChange={(e) => handleOtpChange(e.target.value, idx)}
                        onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                        className={cn(
                          'h-12 w-12 rounded-xl border bg-white text-center text-lg font-semibold text-[#2A2A2A] transition-colors focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 motion-reduce:transition-none',
                          otpError ? 'border-[#B42318]' : 'border-[#D7DDE5]'
                        )}
                      />
                    ))}
                  </div>

                  {otpError ? <FieldError className="mt-3">{otpError}</FieldError> : null}

                  <p className="mt-4 text-sm text-[#667085]">
                    {otpExpiry > 0 ? (
                      <>
                        Code expires in <span className="font-semibold tabular-nums text-[#2A2A2A]">{formatTime(otpExpiry)}</span>
                      </>
                    ) : (
                      <span className="font-semibold text-[#B42318]">This code has expired. Ask for a new one.</span>
                    )}
                  </p>

                  <Button
                    type="submit"
                    disabled={isVerifyingOtp || otp.length < 6 || otpExpiry === 0}
                    className={cn('mt-6', primaryButton)}
                  >
                    {isVerifyingOtp ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
                        Verifying code
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <div className="mt-6 flex items-center justify-between gap-4 text-sm">
                    <button
                      type="button"
                      onClick={returnToEmailStep}
                      className="inline-flex items-center gap-2 font-semibold text-[#667085] transition-colors hover:text-[#2A2A2A] motion-reduce:transition-none"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Use another email
                    </button>
                    {otpCooldown > 0 ? (
                      <span className="text-[#667085]">
                        Resend in <span className="font-semibold tabular-nums">{otpCooldown}s</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSendOtp()}
                        disabled={isSending}
                        className="inline-flex items-center gap-2 font-semibold text-[var(--accent)] hover:underline disabled:opacity-60"
                      >
                        <RotateCcw className={cn('h-4 w-4', isSending && 'auth-spin-ccw')} />
                        {isSending ? 'Sending' : 'Send a new code'}
                      </button>
                    )}
                  </div>
                </form>
              ) : null}

              {step === 'password' ? (
                <form
                  key="password"
                  className="auth-step-enter mx-auto max-w-[420px]"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleResetPassword()
                  }}
                >
                  <StepHeading
                    icon={<KeyRound className="h-5 w-5 text-[var(--accent)]" />}
                    eyebrow="Step 3 of 3"
                    title="Set a new password"
                    description="Pick something you have not used before on this account."
                  />

                  <div className="mt-8 space-y-6">
                    <PasswordField
                      id="forgot-password-new-password"
                      label="New password"
                      placeholder="Enter new password"
                      value={newPassword}
                      error={newPasswordError}
                      visible={showNewPassword}
                      onToggle={() => setShowNewPassword((v) => !v)}
                      onChange={(value) => {
                        setNewPassword(value)
                        if (newPasswordError) setNewPasswordError('')
                      }}
                    />

                    <PasswordField
                      id="forgot-password-confirm-password"
                      label="Confirm new password"
                      placeholder="Repeat new password"
                      value={confirmPassword}
                      error={confirmPasswordError}
                      visible={showConfirmPassword}
                      onToggle={() => setShowConfirmPassword((v) => !v)}
                      onChange={(value) => {
                        setConfirmPassword(value)
                        if (confirmPasswordError) setConfirmPasswordError('')
                      }}
                    />

                    <div className="rounded-xl border border-[#E4E7EC] bg-[#F7F8FA] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#667085]">Password requirements</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <RequirementRow label="At least 8 characters" met={newPassword.length >= 8} />
                        <RequirementRow label="An uppercase letter" met={/[A-Z]/.test(newPassword)} />
                        <RequirementRow label="A lowercase letter" met={/[a-z]/.test(newPassword)} />
                        <RequirementRow label="A number" met={/\d/.test(newPassword)} />
                        <RequirementRow label="A special character" met={/[^A-Za-z0-9\s]/.test(newPassword)} />
                        <RequirementRow label="No spaces" met={newPassword.length > 0 && !/\s/.test(newPassword)} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={returnToEmailStep}
                      disabled={isResetting}
                      className="h-12 rounded-xl border-[#D7DDE5] bg-white px-6 text-sm font-semibold text-[#2A2A2A] transition-colors hover:bg-[#F7F8FA] motion-reduce:transition-none"
                    >
                      Start over
                    </Button>
                    <Button type="submit" disabled={isResetting} className={primaryButton}>
                      {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                      Save new password
                    </Button>
                  </div>
                </form>
              ) : null}

              {step === 'done' ? (
                <div key="done" className="auth-step-enter mx-auto max-w-[400px] py-6">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--accent-tint)]">
                    <CircleCheck className="h-6 w-6 text-[var(--accent)]" />
                  </span>
                  <h2 className="mt-6 text-2xl font-semibold leading-8 text-[#2A2A2A]">Password updated</h2>
                  <p className="mt-2 text-sm leading-6 text-[#667085]">
                    The password for <span className="font-semibold text-[#2A2A2A]">{email.trim().toLowerCase()}</span> has changed.
                    Use it the next time you log in.
                  </p>
                  <Link href={loginPath} className="mt-8 block">
                    <Button className={primaryButton}>
                      Go to login
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-5 text-[#4B5563] lg:hidden">
          Codes go only to registered addresses. Check your spam folder before asking for another.
        </p>
      </div>
    </div>
  )
}

function StepHeading({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ReactNode
  eyebrow: string
  title: string
  description: React.ReactNode
}) {
  return (
    <div>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--accent-tint)]">{icon}</span>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold leading-8 text-[#2A2A2A]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#667085]">{description}</p>
    </div>
  )
}

function FieldError({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('text-sm text-[#B42318]', className)}>
      {children}
    </p>
  )
}

function PasswordField({
  id,
  label,
  placeholder,
  value,
  error,
  visible,
  onToggle,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  error: string
  visible: boolean
  onToggle: () => void
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-semibold text-[#2A2A2A]">
        {label}
      </Label>
      <div className={cn(fieldShell, error && 'border-[#B42318]')}>
        <Lock className="h-4 w-4 shrink-0 text-[#667085]" aria-hidden />
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          className={fieldInput}
        />
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 text-[#667085] transition-colors hover:text-[#2A2A2A] motion-reduce:transition-none"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function RequirementRow({ label, met }: { label: string; met: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm leading-5">
      {met ? (
        <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
      ) : (
        <Minus className="h-4 w-4 shrink-0 text-[#98A2B3]" aria-hidden />
      )}
      <span className={met ? 'text-[#2A2A2A]' : 'text-[#667085]'}>{label}</span>
      <span className="sr-only">{met ? '(met)' : '(not met yet)'}</span>
    </p>
  )
}
