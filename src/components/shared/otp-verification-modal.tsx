'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronLeft, Lock } from 'lucide-react'
import { toast } from 'sonner'

interface OtpVerificationPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
  onVerify: (otp: string) => Promise<boolean>
  onResendCode: () => Promise<boolean>
  onBack?: () => void
  theme?: 'blue' | 'emerald' | 'sky'
  /**
   * 'dialog' is the shared modal the driver, admin and warehouse portals use. 'page'
   * is the full-bleed treatment the customer portal uses, matching the mobile app,
   * where verification is a screen of its own rather than a layer over the form.
   */
  variant?: 'dialog' | 'page'
}

type OtpVerificationModalProps = Omit<OtpVerificationPanelProps, 'variant'>

const OTP_LENGTH = 6
const EXPIRY_SECONDS = 120 // 2 minutes
const RESEND_COOLDOWN_SECONDS = 60 // 1 minute

/**
 * The verification UI itself. Rendered inside a Dialog by OtpVerificationModal below,
 * or straight onto the page by callers that pass variant="page".
 */
export function OtpVerificationPanel({
  open,
  onOpenChange,
  email,
  onVerify,
  onResendCode,
  onBack,
  theme = 'blue',
  variant = 'dialog',
}: OtpVerificationPanelProps) {
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [isVerifying, setIsVerifying] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [expirySeconds, setExpirySeconds] = useState(EXPIRY_SECONDS)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Reset state when the panel opens
  useEffect(() => {
    if (open) {
      setOtp(Array(OTP_LENGTH).fill(''))
      setError('')
      setExpirySeconds(EXPIRY_SECONDS)
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setIsVerifying(false)
      setIsResending(false)
      setTimeout(() => inputRefs.current[0]?.focus(), 120)
    }
  }, [open])

  // Expiry timer
  useEffect(() => {
    if (!open) return
    if (expirySeconds <= 0) return

    const interval = setInterval(() => {
      setExpirySeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          setError('OTP code has expired. Please request a new code.')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [open, expirySeconds])

  // Resend cooldown timer
  useEffect(() => {
    if (!open) return
    if (resendCooldown <= 0) return

    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [open, resendCooldown])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const isExpired = expirySeconds <= 0
  const isComplete = otp.every((digit) => digit !== '')
  const canVerify = isComplete && !isExpired && !isVerifying

  const handleOtpChange = useCallback(
    (index: number, value: string) => {
      if (error) setError('')
      const clean = value.replace(/\D/g, '').slice(-1)

      const newOtp = [...otp]
      newOtp[index] = clean
      setOtp(newOtp)

      // Auto-focus next input
      if (clean && index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus()
      }
    },
    [otp, error]
  )

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        if (otp[index]) {
          const newOtp = [...otp]
          newOtp[index] = ''
          setOtp(newOtp)
        } else if (index > 0) {
          e.preventDefault()
          const newOtp = [...otp]
          newOtp[index - 1] = ''
          setOtp(newOtp)
          inputRefs.current[index - 1]?.focus()
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        inputRefs.current[index - 1]?.focus()
      } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus()
      }
    },
    [otp]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault()
      const pastedData = e.clipboardData.getData('text/plain').replace(/\D/g, '').slice(0, 6)
      if (pastedData.length !== 6) {
        setError('Please paste a valid 6-digit code.')
        return
      }

      if (error) setError('')
      const digits = pastedData.split('')
      setOtp(digits)
      inputRefs.current[OTP_LENGTH - 1]?.focus()
    },
    [error]
  )

  const handleVerify = async () => {
    if (!canVerify) return
    setIsVerifying(true)
    setError('')

    try {
      const otpString = otp.join('')
      const success = await onVerify(otpString)
      if (success) {
        onOpenChange(false)
      } else {
        setError('Invalid OTP code. Please try again.')
        setOtp(Array(OTP_LENGTH).fill(''))
        inputRefs.current[0]?.focus()
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to verify code. Please try again.')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleResend = async () => {
    if (isResending || resendCooldown > 0) return
    setIsResending(true)

    try {
      const success = await onResendCode()
      if (success) {
        setOtp(Array(OTP_LENGTH).fill(''))
        setError('')
        setExpirySeconds(EXPIRY_SECONDS)
        setResendCooldown(RESEND_COOLDOWN_SECONDS)
        toast.success('A new OTP code has been sent to your email.')
        inputRefs.current[0]?.focus()
      }
    } catch {
      toast.error('Failed to resend code. Please try again.')
    } finally {
      setIsResending(false)
    }
  }

  const handleBack = () => {
    onOpenChange(false)
    onBack?.()
  }

  // Theme styling helpers
  const isEmerald = theme === 'emerald'
  const isSky = theme === 'sky'
  const isPage = variant === 'page'

  const iconBg = isEmerald ? 'bg-emerald-50 text-emerald-600' : isSky ? 'bg-sky-50 text-sky-600' : 'bg-blue-50 text-blue-600'
  const activeBoxStyle = isEmerald
    ? 'border-emerald-500 bg-emerald-50/40 text-emerald-950 focus:border-emerald-600 focus:ring-emerald-200'
    : isSky
    ? 'border-sky-400 bg-sky-50 text-slate-900 focus:border-sky-500 focus:ring-sky-100'
    : 'border-blue-400 bg-blue-50 text-slate-900 focus:border-blue-500 focus:ring-blue-100'
  const buttonStyle = isEmerald
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
    : isSky
    ? 'bg-sky-600 hover:bg-sky-700 text-white'
    : 'bg-blue-600 hover:bg-blue-700 text-white'
  const resendLinkStyle = isEmerald
    ? 'text-emerald-700 hover:text-emerald-800'
    : isSky
    ? 'text-sky-600 hover:text-sky-700'
    : 'text-blue-600 hover:text-blue-700'
  const timerHighlight = isEmerald ? 'text-emerald-700' : 'text-slate-800'

  const header = (
    <div className={isPage ? 'flex flex-col items-center gap-2 text-center' : 'flex flex-col gap-2 text-center sm:text-left'}>
          <div className={`relative flex w-full flex-col items-center ${isPage ? 'pt-1' : ''}`}>
            {onBack && !isPage && (
              <button
                type="button"
                onClick={handleBack}
                className="absolute left-0 top-1 rounded-lg p-1 transition-colors hover:bg-gray-100"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5 text-gray-500" />
              </button>
            )}
            <div className={`mb-2 grid place-items-center rounded-2xl ${isPage ? 'h-[52px] w-[52px]' : 'h-11 w-11'} ${iconBg}`}>
              <Lock className={isPage ? 'h-6 w-6' : 'h-5 w-5'} />
            </div>
            {/* Plain elements, not DialogTitle/Description: the panel also renders
                outside a Dialog, where those would throw. The modal wrapper supplies
                screen-reader-only versions of both. */}
            <p className={`font-bold text-slate-900 ${isPage ? 'text-[22px] leading-tight' : 'text-lg leading-none'}`}>
              Enter Verification Code
            </p>
            <p className={`mt-1 max-w-xs leading-relaxed text-slate-500 ${isPage ? 'text-[13px]' : 'text-xs'}`}>
              We sent a 6-digit verification code to <span className="font-semibold text-slate-800">{email}</span>
            </p>
          </div>
    </div>
  )

  const body = (
        <div className="space-y-4 py-2">
          {/* OTP Input Boxes */}
          <div className={`flex justify-center ${isPage ? 'gap-2' : 'gap-1.5 sm:gap-2'}`}>
            {otp.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleOtpChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                className={`rounded-xl border text-center font-bold outline-none transition-all
                  ${isPage ? 'h-14 min-w-0 max-w-[52px] flex-1 text-xl' : 'h-11 w-9 text-lg sm:h-13 sm:w-11 sm:text-xl'}
                  ${
                    error
                      ? 'border-red-400 bg-red-50 text-red-900'
                      : digit
                      ? activeBoxStyle
                      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                  }
                  focus:ring-2
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                placeholder={String(index + 1)}
                autoComplete="one-time-code"
                disabled={isExpired || isVerifying}
                aria-label={`Digit ${index + 1}`}
              />
            ))}
          </div>

          {/* Expiry timer */}
          <div className="text-center">
            {isExpired ? (
              <p className="text-xs sm:text-sm font-semibold text-red-600">Verification code has expired</p>
            ) : (
              <p className="text-xs sm:text-sm text-slate-500">
                Code expires in{' '}
                <span className={`font-mono font-bold ${expirySeconds <= 30 ? 'text-red-500' : timerHighlight}`}>
                  {formatTime(expirySeconds)}
                </span>
              </p>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2.5">
              <p className="text-center text-xs font-semibold text-red-600">{error}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5 pt-1">
            <Button
              type="button"
              className={`w-full rounded-xl font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isPage ? 'h-12' : 'h-11'} ${buttonStyle}`}
              onClick={handleVerify}
              disabled={!canVerify}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying Code...
                </>
              ) : (
                'Verify Code'
              )}
            </Button>

            <div className="text-center pt-1">
              {resendCooldown > 0 ? (
                <p className="text-xs text-slate-400">
                  Resend code in{' '}
                  <span className="font-mono font-semibold text-slate-600">{resendCooldown}s</span>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isResending}
                  className={`text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50 transition-colors ${resendLinkStyle}`}
                >
                  {isResending ? (
                    <>
                      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                      Sending new code...
                    </>
                  ) : (
                    'Resend Code'
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Cancel button */}
          <div className="text-center pt-1">
            <button
              type="button"
              onClick={handleBack}
              className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
  )

  if (isPage) {
    return (
      <div className="flex w-full flex-col">
        <button
          type="button"
          onClick={handleBack}
          className="-ml-1 inline-flex items-center gap-0.5 self-start rounded-lg py-2 pr-3 text-[13px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
          aria-label="Go back"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
          Back
        </button>
        {header}
        {body}
      </div>
    )
  }

  return (
    <>
      {header}
      {body}
    </>
  )
}

export function OtpVerificationModal(props: OtpVerificationModalProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[92vw] rounded-3xl border-slate-100 bg-white/95 p-5 shadow-2xl sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Enter Verification Code</DialogTitle>
        <DialogDescription className="sr-only">
          Enter the 6-digit verification code sent to your email address.
        </DialogDescription>
        <OtpVerificationPanel {...props} variant="dialog" />
      </DialogContent>
    </Dialog>
  )
}
