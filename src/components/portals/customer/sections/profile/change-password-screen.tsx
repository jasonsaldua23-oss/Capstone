'use client'

import { RequirementRow } from './profile-shared'
import { type Dispatch, type SetStateAction } from 'react'
import { getPasswordRequirementState } from '@shared/customer-logic/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ArrowLeft } from 'lucide-react'

/**
 * New password entry with the policy checklist, gated by an email code.
 */
export type ChangePasswordScreenProps = {
  confirmPassword: string
  isSendingOtp: boolean
  isUpdatingPassword: boolean
  newPassword: string
  otpExpiry: number
  otpSent: boolean
  otpVerified: boolean
  requestPasswordOtp: () => Promise<void>
  setConfirmPassword: Dispatch<SetStateAction<string>>
  setNewPassword: Dispatch<SetStateAction<string>>
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
  updatePassword: () => Promise<void>
}

export function ChangePasswordScreen({
  confirmPassword,
  isSendingOtp,
  isUpdatingPassword,
  newPassword,
  otpExpiry,
  otpSent,
  otpVerified,
  requestPasswordOtp,
  setConfirmPassword,
  setNewPassword,
  setSubView,
  updatePassword,
}: ChangePasswordScreenProps) {
  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
      <div className="flex items-center gap-3 px-4 pt-5 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
          onClick={() => setSubView('account-security')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Change Password</h2>
      </div>
      <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
        <div className="space-y-2">
          <Label htmlFor="customer-new-password" className="text-sm font-semibold text-slate-700">New Password</Label>
          <Input
            id="customer-new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
          />
          {/* Password Policy Real-time Verification Checklist */}
          <div className="mt-2 space-y-1 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Password Requirements</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1">
              {getPasswordRequirementState(newPassword).map((rule) => (
                <RequirementRow key={rule.label} label={rule.label} met={rule.met} />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-confirm-password" className="text-sm font-semibold text-slate-700">Confirm Password</Label>
          <Input
            id="customer-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
          />
        </div>
        {/* Security Verification Card */}
        <div className="space-y-3 rounded-2xl border border-emerald-100 bg-[#f4faf6] p-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Security Verification</p>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">OTP verification is required to change password.</p>
          </div>
          {otpVerified ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-emerald-800 text-sm font-semibold">
              <svg className="h-5 w-5 text-emerald-600 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              OTP Verified Successfully
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => {
                // A live code is entered, not replaced — requesting again would reset
                // the countdown the customer is already racing.
                if (otpSent && otpExpiry > 0) {
                  setSubView('change-password-otp')
                  return
                }
                void requestPasswordOtp()
              }}
              disabled={isSendingOtp}
              className="w-full h-11 rounded-xl bg-[#14532d] hover:bg-[#0f3f22] text-white font-semibold shadow-sm transition-colors"
            >
              {isSendingOtp ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending OTP...
                </>
              ) : otpSent && otpExpiry > 0 ? (
                'Enter OTP'
              ) : (
                'Request Verification OTP'
              )}
            </Button>
          )}
        </div>
      </div>
      <div className="px-4 pt-2">
        <Button
          type="button"
          onClick={updatePassword}
          disabled={isUpdatingPassword || !otpVerified || !newPassword || !confirmPassword}
          className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
        >
          {isUpdatingPassword ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating Password...
            </>
          ) : (
            'Update Password'
          )}
        </Button>
      </div>

      {/* OTP Dialog Popup */}
    </div>
  )
}
