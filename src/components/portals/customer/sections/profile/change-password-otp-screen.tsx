'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Lock, ArrowLeft } from 'lucide-react'

/**
 * Six-digit code entry that confirms a password change.
 */
export type ChangePasswordOtpScreenProps = {
  formatTime: (seconds: number) => string
  handleOtpChange: (value: string, idx: number) => void
  handleOtpKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => void
  handleOtpPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
  handleResendOtp: () => Promise<void>
  isSendingOtp: boolean
  isVerifyingOtp: boolean
  otp: string
  otpError: string | null
  otpExpiry: number
  otpVals: string[]
  profileEmail: string
  resendCooldown: number
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
  user: any
  verifyPasswordOtp: () => Promise<void>
}

export function ChangePasswordOtpScreen({
  formatTime,
  handleOtpChange,
  handleOtpKeyDown,
  handleOtpPaste,
  handleResendOtp,
  isSendingOtp,
  isVerifyingOtp,
  otp,
  otpError,
  otpExpiry,
  otpVals,
  profileEmail,
  resendCooldown,
  setSubView,
  user,
  verifyPasswordOtp,
}: ChangePasswordOtpScreenProps) {
  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-white min-h-screen">
      <div className="flex items-center gap-3 px-4 pt-5 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
          onClick={() => setSubView('change-password')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Enter Verification Code</h2>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col items-center px-6">
        <div className="h-13 w-13 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center mb-2 p-3">
          <Lock className="h-6 w-6" />
        </div>
        <p className="mt-1 max-w-xs text-center text-[13px] leading-relaxed text-slate-500">
          We sent a 6-digit verification code to{' '}
          <span className="font-semibold text-slate-700">{profileEmail || user?.email}</span>
        </p>

        {otpError && (
          <div className="mt-4 w-full rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-600">
            {otpError}
          </div>
        )}

        <div className="mt-5 flex w-full justify-center gap-2" onPaste={handleOtpPaste}>
          {Array.from({ length: 6 }).map((_, idx) => (
            <input
              key={idx}
              id={`otp-input-${idx}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={otpVals[idx] || ''}
              placeholder={String(idx + 1)}
              onChange={(e) => handleOtpChange(e.target.value, idx)}
              onKeyDown={(e) => handleOtpKeyDown(e, idx)}
              className="h-14 min-w-0 max-w-[52px] flex-1 rounded-xl border border-slate-200 bg-white text-center text-xl font-bold text-slate-800 transition-all placeholder:text-slate-300 focus:border-[#14532d] focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          ))}
        </div>

        <div className="mt-4 text-center">
          {otpExpiry > 0 ? (
            <p className="text-xs font-semibold text-slate-500">
              Code expires in <span className="text-[#14532d] font-bold">{formatTime(otpExpiry)}</span>
            </p>
          ) : (
            <p className="text-xs font-bold text-red-500">Verification code has expired.</p>
          )}
        </div>

        <Button
          type="button"
          onClick={verifyPasswordOtp}
          disabled={isVerifyingOtp || otp.length < 6 || otpExpiry === 0}
          className="mt-4 h-12 w-full rounded-xl bg-[#14532d] font-semibold text-white hover:bg-[#0f3f22]"
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

        <div className="mt-3 text-center">
          {resendCooldown > 0 ? (
            <span className="text-xs font-medium text-slate-400">
              Resend code in <span className="font-semibold">{resendCooldown}s</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={isSendingOtp}
              className="text-xs font-bold text-[#14532d] hover:underline"
            >
              {isSendingOtp ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSubView('change-password')}
          className="mt-5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
        >
          Back to Change Password
        </button>
      </div>
    </div>
  )
}
