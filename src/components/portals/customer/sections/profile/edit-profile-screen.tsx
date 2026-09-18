'use client'

import { formatFullName } from './profile-shared'
import { type Dispatch, type SetStateAction, type MutableRefObject } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPhilippinePhoneInput } from '@/lib/philippine-phone'
import { Camera, Loader2, MapPin, Phone, ArrowLeft } from 'lucide-react'

/**
 * Editable name, contact and avatar for the customer account.
 */
export type EditProfileScreenProps = {
  avatarInputRef: MutableRefObject<HTMLInputElement | null>
  canSaveProfile: boolean
  composedShippingAddress: string
  handleSaveProfile: () => Promise<void>
  initials: string
  isEditingProfile: boolean
  isSavingProfile: boolean
  openAvatarCropDialog: (file: File | null) => Promise<void>
  phoneError: string | null
  profileEmail: string
  profileFirstName: string
  profileLastName: string
  profileMiddleName: string
  profileNoMiddleName: boolean
  profileName: string
  profilePhone: string
  profileSuffix: string | undefined
  resolvedAvatarPreviewUrl: string | null
  setIsAddressDialogOpen: (value: boolean) => void
  setIsEditingProfile: Dispatch<SetStateAction<boolean>>
  setProfileEmail: (value: string) => void
  setProfileFirstName: (value: string) => void
  setProfileLastName: (value: string) => void
  setProfileMiddleName: (value: string) => void
  setProfileNoMiddleName: (value: boolean) => void
  setProfilePhone: (value: string) => void
  setProfileSuffix: ((value: string) => void) | undefined
  setSubView: Dispatch<SetStateAction<'menu' | 'edit' | 'empties-deposits' | 'security' | 'account-security' | 'change-password' | 'change-password-otp' | 'security-settings' | 'notifications' | 'real-notifications'>>
  shippingCity: string
  shippingProvince: string
  shippingZipCode: string
  user: any
}

export function EditProfileScreen({
  avatarInputRef,
  canSaveProfile,
  composedShippingAddress,
  handleSaveProfile,
  initials,
  isEditingProfile,
  isSavingProfile,
  openAvatarCropDialog,
  phoneError,
  profileEmail,
  profileFirstName,
  profileLastName,
  profileMiddleName,
  profileNoMiddleName,
  profileName,
  profilePhone,
  profileSuffix,
  resolvedAvatarPreviewUrl,
  setIsAddressDialogOpen,
  setIsEditingProfile,
  setProfileEmail,
  setProfileFirstName,
  setProfileLastName,
  setProfileMiddleName,
  setProfileNoMiddleName,
  setProfilePhone,
  setProfileSuffix,
  setSubView,
  shippingCity,
  shippingProvince,
  shippingZipCode,
  user,
}: EditProfileScreenProps) {
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
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Edit Profile</h2>
      </div>
      <div className="flex flex-col items-center py-4 bg-white border-y border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="relative">
          <Avatar className="h-20 w-20 border-2 border-white shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
            {resolvedAvatarPreviewUrl ? (
              <AvatarImage src={resolvedAvatarPreviewUrl} alt={profileName || user?.name || 'Profile'} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-teal-700 text-2xl font-bold text-white">{initials}</AvatarFallback>
          </Avatar>
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white shadow-md border-2 border-white hover:bg-teal-800 active:scale-95 transition"
            title="Change Avatar"
            disabled={isSavingProfile}
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Upload profile photo"
            title="Upload profile photo"
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (avatarInputRef.current) {
                avatarInputRef.current.value = ''
              }
              void openAvatarCropDialog(file)
            }}
          />
        </div>
        <p className="mt-2 text-base font-bold text-slate-900">
          {formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName || 'Your Name')}
        </p>
      </div>
      <div className="mx-4 p-5 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="customer-profile-first-name" className="text-sm font-semibold text-slate-700">First Name <span className="text-red-500">*</span></Label>
            <Input id="customer-profile-first-name" value={profileFirstName} onChange={(e) => setProfileFirstName(e.target.value)} placeholder="First name" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-profile-last-name" className="text-sm font-semibold text-slate-700">Last Name <span className="text-red-500">*</span></Label>
            <Input id="customer-profile-last-name" value={profileLastName} onChange={(e) => setProfileLastName(e.target.value)} placeholder="Last name" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-profile-middle-name" className="text-sm font-semibold text-slate-700">Middle Name {!profileNoMiddleName && <span className="text-red-500">*</span>}</Label>
            <Input id="customer-profile-middle-name" value={profileMiddleName} onChange={(e) => setProfileMiddleName(e.target.value)} placeholder="Middle name" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile || profileNoMiddleName} />
            <label className="flex items-center gap-2 text-xs text-slate-600">
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
          <div className="space-y-2">
            <Label htmlFor="customer-profile-suffix" className="text-sm font-semibold text-slate-700">Suffix <span className="text-xs font-normal text-slate-400">(Optional)</span></Label>
            <Input id="customer-profile-suffix" value={profileSuffix} onChange={(e) => setProfileSuffix?.(e.target.value)} placeholder="e.g. Jr., Sr., III" className="h-11 rounded-xl border-slate-200" disabled={!isEditingProfile} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-profile-email" className="text-sm font-semibold text-slate-700">Email Address</Label>
          <Input
            id="customer-profile-email"
            type="email"
            value={profileEmail}
            onChange={(e) => setProfileEmail(e.target.value)}
            placeholder="Enter your email"
            className="h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200"
            disabled={!isEditingProfile}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-profile-phone" className="text-sm font-semibold text-slate-700">Phone Number</Label>
          <Input
            id="customer-profile-phone"
            value={profilePhone}
            onChange={(e) => {
              setProfilePhone(formatPhilippinePhoneInput(e.target.value))
            }}
            placeholder="09XX XXX XXXX"
            maxLength={13}
            inputMode="numeric"
            className={`h-11 rounded-xl border-slate-200 bg-white text-slate-800 focus-visible:border-emerald-500 focus-visible:ring-emerald-200 ${
              phoneError ? 'border-red-300 focus-visible:border-red-500 focus-visible:ring-red-200' : ''
            }`}
            disabled={!isEditingProfile}
          />
          {phoneError && <p className="text-xs text-red-600 font-medium">{phoneError}</p>}
        </div>
        <div className="space-y-2.5 rounded-2xl border border-emerald-100 bg-[#f9fdfa] p-4">
          <Label className="text-sm font-semibold text-[#14532d]">Delivery Address</Label>
          <p className="text-sm text-slate-700 font-medium">{composedShippingAddress || 'Not set'}</p>
          <p className="text-xs text-slate-400">
            {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'} ${shippingZipCode || ''}`.trim() : 'City/Province not set'}
          </p>
          {/* Fix: keep address changes locked with the rest of the profile fields. */}
          <Button
            type="button"
            variant="outline"
            className="w-full h-10 mt-1 rounded-xl border-emerald-200 bg-white text-[#14532d] hover:bg-[#eef8f2] hover:text-[#14532d] font-semibold"
            onClick={() => setIsAddressDialogOpen(true)}
            disabled={!isEditingProfile}
          >
            <MapPin className="h-4 w-4 mr-2" />
            Change Delivery Address
          </Button>
        </div>
      </div>
      <div className="px-4 pt-2">
        <Button
          type="button"
          onClick={() => {
            if (isEditingProfile) {
              handleSaveProfile()
            } else {
              setIsEditingProfile(true)
            }
          }}
          disabled={isSavingProfile || !canSaveProfile}
          className="w-full h-12 bg-[#14532d] text-white rounded-xl font-semibold hover:bg-[#0f3f22] transition-colors shadow-[0_4px_12px_rgba(20,83,45,0.12)]"
        >
          {isSavingProfile ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving Changes...
            </>
          ) : isEditingProfile ? (
            'Save Changes'
          ) : (
            'Edit Profile'
          )}
        </Button>
      </div>
    </div>
  )
}
