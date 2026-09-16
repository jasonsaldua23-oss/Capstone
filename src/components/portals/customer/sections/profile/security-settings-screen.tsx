'use client'

import { type NotificationPrefs } from './profile-shared'
import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Two-factor, login alert and remembered-device switches.
 */
export type SecuritySettingsScreenProps = {
  isEditingSecurity: boolean
  isSavingSecurity: boolean
  loginAlertsEnabled: boolean
  notifications: NotificationPrefs
  rememberDeviceEnabled: boolean
  saveSecuritySetting: (field: 'twoFactorEnabled' | 'loginAlertsEnabled', value: boolean) => Promise<unknown>
  setIsEditingSecurity: Dispatch<SetStateAction<boolean>>
  setRememberDeviceEnabled: Dispatch<SetStateAction<boolean>>
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
  twoFactorEnabled: boolean
}

export function SecuritySettingsScreen({
  isEditingSecurity,
  isSavingSecurity,
  loginAlertsEnabled,
  notifications,
  rememberDeviceEnabled,
  saveSecuritySetting,
  setIsEditingSecurity,
  setRememberDeviceEnabled,
  setSubView,
  twoFactorEnabled,
}: SecuritySettingsScreenProps) {
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
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Security Settings</h2>
      </div>

      <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] divide-y divide-slate-100">
        <div className="flex items-center justify-between p-4">
          <div className="space-y-0.5 pr-4">
            <p className="text-sm font-semibold text-slate-900">Two-Factor Authentication (2FA)</p>
            <p className="text-xs text-slate-500 max-w-sm">Require a 6-digit OTP code when logging in to secure your account.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={twoFactorEnabled}
            disabled={isSavingSecurity || !isEditingSecurity}
            onClick={() => void saveSecuritySetting('twoFactorEnabled', !twoFactorEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
              twoFactorEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
            } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4">
          <div className="space-y-0.5 pr-4">
            <p className="text-sm font-semibold text-slate-900">Login Activity Alerts</p>
            <p className="text-xs text-slate-500 max-w-sm">Receive email notifications when your account is logged in from a new device.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={loginAlertsEnabled}
            disabled={isSavingSecurity || !isEditingSecurity}
            onClick={() => void saveSecuritySetting('loginAlertsEnabled', !loginAlertsEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
              loginAlertsEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
            } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${loginAlertsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4">
          <div className="space-y-0.5 pr-4">
            <p className="text-sm font-semibold text-slate-900">Remember Device Sessions</p>
            <p className="text-xs text-slate-500 max-w-sm">Keep trusted sessions active on your browser for faster access.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rememberDeviceEnabled}
            disabled={!isEditingSecurity}
            onClick={() => {
              const next = !rememberDeviceEnabled
              setRememberDeviceEnabled(next)
              if (typeof window !== 'undefined') localStorage.setItem('customer_remember_device_enabled', String(next))
              toast.success(next ? 'Device remembering enabled' : 'Device remembering disabled')
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
              rememberDeviceEnabled ? 'bg-[#14532d]' : 'bg-slate-200'
            } ${!isEditingSecurity ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${rememberDeviceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
      <div className="px-4 pt-2">
        <Button
          type="button"
          onClick={() => setIsEditingSecurity(!isEditingSecurity)}
          disabled={isSavingSecurity}
          className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
        >
          {isEditingSecurity ? 'Save Security Settings' : 'Edit Security Settings'}
        </Button>
      </div>
    </div>
  )
}
