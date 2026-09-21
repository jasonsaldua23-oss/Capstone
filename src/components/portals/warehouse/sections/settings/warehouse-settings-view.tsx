'use client'

import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
import { formatFullName } from '../../warehouse-portal-utils'
import {
  Settings,
  Loader2,
  Eye,
  CircleCheck,
  CheckCircle2,
  ShieldCheck,
  KeyRound,
  Lock,
  EyeOff,
  User,
  Phone,
  XCircle,
} from 'lucide-react'
import type { WarehouseProfileSettings } from './use-warehouse-profile-settings'
import type { AuthUser } from '@/types'

/**
 * Account profile, password and security settings for warehouse staff.
 */
export type WarehouseSettingsViewProps = {
  accountEmail: WarehouseProfileSettings['accountEmail']
  confirmPassword: WarehouseProfileSettings['confirmPassword']
  isEditingProfile: WarehouseProfileSettings['isEditingProfile']
  isEmailChangeUnlocked: WarehouseProfileSettings['isEmailChangeUnlocked']
  isEditingSecurity: WarehouseProfileSettings['isEditingSecurity']
  isProfileEmailChanged: WarehouseProfileSettings['isProfileEmailChanged']
  isSavingProfile: WarehouseProfileSettings['isSavingProfile']
  isSavingSecuritySettings: WarehouseProfileSettings['isSavingSecuritySettings']
  isSendingPasswordOtp: WarehouseProfileSettings['isSendingPasswordOtp']
  isSendingProfileOtp: WarehouseProfileSettings['isSendingProfileOtp']
  isUpdatingPassword: WarehouseProfileSettings['isUpdatingPassword']
  loginAlertsEnabled: WarehouseProfileSettings['loginAlertsEnabled']
  newPassword: WarehouseProfileSettings['newPassword']
  normalizedProfileEmail: WarehouseProfileSettings['normalizedProfileEmail']
  passwordOtpSent: WarehouseProfileSettings['passwordOtpSent']
  passwordOtpVerified: WarehouseProfileSettings['passwordOtpVerified']
  passwordRequirements: WarehouseProfileSettings['passwordRequirements']
  profileAvatarCrop: WarehouseProfileSettings['profileAvatarCrop']
  profileAvatarFile: WarehouseProfileSettings['profileAvatarFile']
  profileAvatarInputRef: WarehouseProfileSettings['profileAvatarInputRef']
  profileEmail: WarehouseProfileSettings['profileEmail']
  profileFirstName: WarehouseProfileSettings['profileFirstName']
  profileLastName: WarehouseProfileSettings['profileLastName']
  profileMiddleName: WarehouseProfileSettings['profileMiddleName']
  profileNoMiddleName: WarehouseProfileSettings['profileNoMiddleName']
  profileName: WarehouseProfileSettings['profileName']
  profileOtpSent: WarehouseProfileSettings['profileOtpSent']
  profileOtpVerified: WarehouseProfileSettings['profileOtpVerified']
  profilePhone: WarehouseProfileSettings['profilePhone']
  profileSuffix: WarehouseProfileSettings['profileSuffix']
  requestOtp: WarehouseProfileSettings['requestOtp']
  saveProfileSettings: WarehouseProfileSettings['saveProfileSettings']
  saveSecuritySettings: WarehouseProfileSettings['saveSecuritySettings']
  setConfirmPassword: WarehouseProfileSettings['setConfirmPassword']
  setIsEditingProfile: WarehouseProfileSettings['setIsEditingProfile']
  setIsEditingSecurity: WarehouseProfileSettings['setIsEditingSecurity']
  setLoginAlertsEnabled: WarehouseProfileSettings['setLoginAlertsEnabled']
  setNewPassword: WarehouseProfileSettings['setNewPassword']
  setProfileEmail: WarehouseProfileSettings['setProfileEmail']
  setProfileFirstName: WarehouseProfileSettings['setProfileFirstName']
  setProfileLastName: WarehouseProfileSettings['setProfileLastName']
  setProfileMiddleName: WarehouseProfileSettings['setProfileMiddleName']
  setProfileNoMiddleName: WarehouseProfileSettings['setProfileNoMiddleName']
  setProfileOtp: WarehouseProfileSettings['setProfileOtp']
  setProfileOtpSent: WarehouseProfileSettings['setProfileOtpSent']
  setProfileOtpToken: WarehouseProfileSettings['setProfileOtpToken']
  setProfileOtpVerified: WarehouseProfileSettings['setProfileOtpVerified']
  setProfilePhone: WarehouseProfileSettings['setProfilePhone']
  setProfileSuffix: WarehouseProfileSettings['setProfileSuffix']
  setShowConfirmPassword: WarehouseProfileSettings['setShowConfirmPassword']
  setShowNewPassword: WarehouseProfileSettings['setShowNewPassword']
  setTwoFactorEnabled: WarehouseProfileSettings['setTwoFactorEnabled']
  showConfirmPassword: WarehouseProfileSettings['showConfirmPassword']
  showNewPassword: WarehouseProfileSettings['showNewPassword']
  twoFactorEnabled: WarehouseProfileSettings['twoFactorEnabled']
  updateProfilePassword: WarehouseProfileSettings['updateProfilePassword']
  user: AuthUser | null
}

export function WarehouseSettingsView({
  accountEmail,
  confirmPassword,
  isEditingProfile,
  isEmailChangeUnlocked,
  isEditingSecurity,
  isProfileEmailChanged,
  isSavingProfile,
  isSavingSecuritySettings,
  isSendingPasswordOtp,
  isSendingProfileOtp,
  isUpdatingPassword,
  loginAlertsEnabled,
  newPassword,
  normalizedProfileEmail,
  passwordOtpSent,
  passwordOtpVerified,
  passwordRequirements,
  profileAvatarCrop,
  profileAvatarFile,
  profileAvatarInputRef,
  profileEmail,
  profileFirstName,
  profileLastName,
  profileMiddleName,
  profileNoMiddleName,
  profileName,
  profileOtpSent,
  profileOtpVerified,
  profilePhone,
  profileSuffix,
  requestOtp,
  saveProfileSettings,
  saveSecuritySettings,
  setConfirmPassword,
  setIsEditingProfile,
  setIsEditingSecurity,
  setLoginAlertsEnabled,
  setNewPassword,
  setProfileEmail,
  setProfileFirstName,
  setProfileLastName,
  setProfileMiddleName,
  setProfileNoMiddleName,
  setProfileOtp,
  setProfileOtpSent,
  setProfileOtpToken,
  setProfileOtpVerified,
  setProfilePhone,
  setProfileSuffix,
  setShowConfirmPassword,
  setShowNewPassword,
  setTwoFactorEnabled,
  showConfirmPassword,
  showNewPassword,
  twoFactorEnabled,
  updateProfilePassword,
  user,
}: WarehouseSettingsViewProps) {
  return (
    <>
      <div className="w-full max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500">Manage your account and preferences</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <Avatar className="h-16 w-16 border border-slate-200 shadow-sm">
                  {(profileAvatarFile || String((user as any)?.avatar || '').trim()) ? (
                    <AvatarImage src={profileAvatarFile ? URL.createObjectURL(profileAvatarFile) : String((user as any)?.avatar || '').trim()} alt={`${profileName || user?.name || 'User'} avatar`} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="bg-linear-to-br from-cyan-600 to-emerald-600 text-lg font-semibold text-white">
                    {(String(profileName || user?.name || 'U')
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part.charAt(0).toUpperCase())
                      .join('')) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <input ref={profileAvatarInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { profileAvatarCrop.open(event.target.files?.[0] || null); event.currentTarget.value = '' }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName || user?.name || 'User')}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">{profileEmail || user?.email || 'No email provided'}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={() => profileAvatarInputRef.current?.click()}>
                    {profileAvatarFile ? 'Change Selected Avatar' : 'Change Avatar'}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="warehouse-profile-first-name" className="text-xs font-semibold text-slate-600">First Name <span className="text-red-500">*</span></Label>
                    <Input id="warehouse-profile-first-name" value={profileFirstName} onChange={(e) => setProfileFirstName(e.target.value)} disabled={!isEditingProfile} />
                  </div>
                  <div>
                    <Label htmlFor="warehouse-profile-last-name" className="text-xs font-semibold text-slate-600">Last Name <span className="text-red-500">*</span></Label>
                    <Input id="warehouse-profile-last-name" value={profileLastName} onChange={(e) => setProfileLastName(e.target.value)} disabled={!isEditingProfile} />
                  </div>
                  <div>
                    <Label htmlFor="warehouse-profile-middle-name" className="text-xs font-semibold text-slate-600">Middle Name {!profileNoMiddleName && <span className="text-red-500">*</span>}</Label>
                    <Input id="warehouse-profile-middle-name" value={profileMiddleName} onChange={(e) => setProfileMiddleName(e.target.value)} disabled={!isEditingProfile || profileNoMiddleName} />
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={profileNoMiddleName}
                        onChange={(e) => {
                          setProfileNoMiddleName(e.target.checked)
                          if (e.target.checked) setProfileMiddleName('')
                        }}
                        disabled={!isEditingProfile}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      No middle name
                    </label>
                  </div>
                  <div>
                    <Label htmlFor="warehouse-profile-suffix" className="text-xs font-semibold text-slate-600">Suffix <span className="text-xs font-normal text-slate-400">(Optional)</span></Label>
                    <Input id="warehouse-profile-suffix" value={profileSuffix} onChange={(e) => setProfileSuffix(e.target.value)} placeholder="e.g. Jr., Sr., III" disabled={!isEditingProfile} />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouse-profile-email" className="text-xs font-semibold text-slate-700">Email</Label>
                <div className="flex gap-2">
                  <Input
                    id="warehouse-profile-email"
                    type="email"
                    value={profileEmail}
                    onChange={(e) => {
                      setProfileEmail(e.target.value)
                      setProfileOtpSent(false)
                      setProfileOtpVerified(false)
                      setProfileOtpToken('')
                      setProfileOtp('')
                    }}
                    readOnly={!isEmailChangeUnlocked}
                    aria-readonly={!isEmailChangeUnlocked}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!isEditingProfile || isSendingProfileOtp || (isEmailChangeUnlocked && profileOtpVerified)}
                    onClick={() => {
                      if (!isEmailChangeUnlocked) {
                        void requestOtp(accountEmail, 'current-email')
                        return
                      }
                      if (!isProfileEmailChanged) {
                        toast.error('Enter a new email address first')
                        return
                      }
                      void requestOtp(normalizedProfileEmail, 'profile')
                    }}
                  >
                    {isSendingProfileOtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {profileOtpVerified ? 'Verified' : isEmailChangeUnlocked ? 'Verify Email' : 'Change Email'}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouse-profile-phone" className="text-xs font-semibold text-slate-700">Phone</Label>
                <Input id="warehouse-profile-phone" inputMode="numeric" maxLength={12} value={profilePhone} onChange={(e) => setProfilePhone(formatPhilippinePhoneInput(e.target.value))} disabled={!isEditingProfile} />
                {profilePhone && !isValidPhilippinePhone(profilePhone) ? (
                  <p className="text-xs font-medium text-red-600">Please enter a valid Philippine mobile number</p>
                ) : null}
              </div>
              <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => {
                if (isEditingProfile) {
                  void saveProfileSettings()
                } else {
                  setIsEditingProfile(true)
                }
              }} disabled={isSavingProfile}>
                {isSavingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isSavingProfile ? 'Saving...' : isEditingProfile ? 'Save Changes' : 'Edit Profile'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage 2FA verification and login protection</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">2FA Verification</p>
                  <p className="text-xs text-slate-500">Require OTP when signing in to warehouse portal</p>
                </div>
                <Button
                  type="button"
                  className={twoFactorEnabled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}
                  onClick={() => setTwoFactorEnabled((prev) => !prev)}
                  disabled={!isEditingSecurity}
                >
                  {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Login Alerts</p>
                  <p className="text-xs text-slate-500">Send alert when your account signs in from a new device</p>
                </div>
                <Button
                  type="button"
                  className={loginAlertsEnabled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}
                  onClick={() => setLoginAlertsEnabled((prev) => !prev)}
                  disabled={!isEditingSecurity}
                >
                  {loginAlertsEnabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>

              <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => {
                if (isEditingSecurity) {
                  void saveSecuritySettings()
                } else {
                  setIsEditingSecurity(true)
                }
              }} disabled={isSavingSecuritySettings}>
                {isSavingSecuritySettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isSavingSecuritySettings ? 'Saving...' : isEditingSecurity ? 'Save Security Settings' : 'Edit Security Settings'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your account password separately.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="warehouse-profile-new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="warehouse-profile-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" onClick={() => setShowNewPassword((v) => !v)} aria-label={showNewPassword ? 'Hide password' : 'Show password'}>
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="space-y-1">
                {passwordRequirements.map((rule) => (
                  <div key={rule.id} className="flex items-start gap-2 text-xs">
                    {rule.met ? (
                      <CircleCheck className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 text-red-500" aria-hidden="true" />
                    )}
                    <span className={rule.met ? 'text-emerald-600' : 'text-gray-500'}>{rule.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="warehouse-profile-confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="warehouse-profile-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" onClick={() => setShowConfirmPassword((v) => !v)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg p-2 bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">Security Verification</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    A verification code will be sent to <span className="font-medium text-slate-700">{accountEmail}</span> to confirm this password change.
                  </p>
                </div>
              </div>

              {passwordOtpVerified ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Identity verified for password update</span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 font-medium h-9 text-xs"
                  onClick={() => void requestOtp(accountEmail, 'password')}
                  disabled={
                    isSendingPasswordOtp ||
                    !newPassword ||
                    !confirmPassword ||
                    newPassword !== confirmPassword ||
                    Boolean(validatePasswordPolicy(newPassword))
                  }
                >
                  {isSendingPasswordOtp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {isSendingPasswordOtp ? 'Sending Security Code...' : passwordOtpSent ? 'Resend Security Code' : 'Request Security Code'}
                </Button>
              )}
            </div>

            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => void updateProfilePassword()}
              disabled={isUpdatingPassword || !passwordOtpVerified}
            >
              {isUpdatingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
              Update Password
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
