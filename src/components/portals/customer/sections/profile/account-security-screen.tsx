'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronRight, ShieldCheck, ArrowLeft, KeyRound } from 'lucide-react'

/**
 * Entry menu for password and security settings.
 */
export type AccountSecurityScreenProps = {
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
}

export function AccountSecurityScreen({
  setSubView,
}: AccountSecurityScreenProps) {
  return (
    <div className="space-y-5 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] md:pb-6 bg-[#f8f9fa] min-h-screen">
      <div className="flex items-center gap-3 px-4 pt-5 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full hover:bg-slate-100 text-slate-700"
          onClick={() => setSubView('menu')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Account Security</h2>
      </div>

      <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
        <button
          type="button"
          onClick={() => setSubView('change-password')}
          className="w-full flex items-center justify-between p-4 hover:bg-slate-50 border-b border-slate-100 transition-colors text-left"
        >
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center shrink-0">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Change Password</p>
              <p className="text-xs text-slate-500 mt-0.5">Update your password with OTP verification</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => setSubView('security-settings')}
          className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-[#14532d] grid place-items-center shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Security Settings</p>
              <p className="text-xs text-slate-500 mt-0.5">Configure 2FA login verification and security alerts</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
        </button>
      </div>
    </div>
  )
}
