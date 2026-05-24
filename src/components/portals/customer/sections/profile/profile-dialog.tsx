'use client'

import type { MutableRefObject } from 'react'
import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Camera, Loader2, MapPin } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveClientImageUrl } from '@/lib/client-image'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'

export function CustomerProfileDialog(props: any) {
  const {
    isProfileDialogOpen,
    setIsProfileDialogOpen,
    profileName,
    setProfileName,
    profileEmail,
    setProfileEmail,
    profilePhone,
    setProfilePhone,
    composedShippingAddress,
    shippingCity,
    shippingProvince,
    shippingZipCode,
    setIsAddressDialogOpen,
    saveProfile,
    isSavingProfile,
    avatarPreviewUrl,
    user,
    avatarInputRef,
    openAvatarCropDialog,
  } = props

  const resolvedAvatarPreviewUrl = resolveClientImageUrl(avatarPreviewUrl)
  const phoneError = useMemo(() => {
    if (!profilePhone || profilePhone.length === 0) return null
    if (!isValidPhilippinePhone(profilePhone)) {
      return 'Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567)'
    }
    return null
  }, [profilePhone])

  const canSaveProfile = useMemo(() => {
    return !phoneError && profilePhone.length > 0
  }, [phoneError, profilePhone])

  return (
    <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
      <DialogContent className="max-w-md border-emerald-100 bg-white/95">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <DialogHeader>
            <DialogTitle className="text-slate-900">Edit Profile</DialogTitle>
            <DialogDescription className="text-slate-500">Update your account details and profile picture.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
              <div className="relative">
                <Avatar className="h-16 w-16 border border-white shadow-sm">
                  {resolvedAvatarPreviewUrl ? <AvatarImage src={resolvedAvatarPreviewUrl} alt={profileName || user?.name || 'Profile'} className="object-cover" /> : null}
                  <AvatarFallback className="bg-teal-700 text-white">{(profileName || user?.name || 'C').charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <input
                  ref={avatarInputRef as MutableRefObject<HTMLInputElement | null>}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Upload profile photo"
                  title="Upload profile photo"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    if (avatarInputRef?.current) {
                      avatarInputRef.current.value = ''
                    }
                    void openAvatarCropDialog(file)
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-teal-700 p-0 text-white hover:bg-teal-800"
                  onClick={() => avatarInputRef?.current?.click()}
                  disabled={isSavingProfile}
                >
                  <Camera className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{profileName || user?.name || 'Customer'}</p>
                <p className="text-sm text-slate-500">{profileEmail || user?.email || 'No email provided'}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-name" className="text-slate-800">Full Name</Label>
              <Input
                id="customer-profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Enter your full name"
                className="border-slate-200 bg-white text-slate-800 focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-email" className="text-slate-800">Email</Label>
              <Input
                id="customer-profile-email"
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                placeholder="Enter your email"
                className="border-slate-200 bg-white text-slate-800 focus-visible:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-phone" className="text-slate-800">Phone</Label>
              <Input
                id="customer-profile-phone"
                value={profilePhone}
                onChange={(e) => setProfilePhone(formatPhilippinePhoneInput(e.target.value))}
                placeholder="09XX XXX XXXX"
                maxLength={13}
                inputMode="numeric"
                className={`border-slate-200 bg-white text-slate-800 focus-visible:ring-emerald-500 ${phoneError ? 'border-red-300 focus-visible:ring-red-400' : ''}`}
              />
              {phoneError && (
                <p className="text-xs text-red-600">{phoneError}</p>
              )}
            </div>
            <div className="space-y-2 rounded-md border border-emerald-100 bg-emerald-50/40 p-3">
              <Label className="text-slate-900">Delivery Address</Label>
              <p className="text-sm text-slate-700">{composedShippingAddress || 'Not set'}</p>
              <p className="text-xs text-slate-500">
                {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'} ${shippingZipCode || ''}`.trim() : 'City/Province not set'}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                onClick={() => {
                  setIsProfileDialogOpen(false)
                  setIsAddressDialogOpen(true)
                }}
              >
                <MapPin className="h-4 w-4 mr-2" />
                Edit Delivery Address
              </Button>
            </div>
            <Button
              onClick={async () => {
                if (!canSaveProfile) return
                const saved = await saveProfile()
                if (saved) setIsProfileDialogOpen(false)
              }}
              disabled={isSavingProfile || !canSaveProfile}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {isSavingProfile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Profile'
              )}
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
