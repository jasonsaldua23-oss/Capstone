'use client'

import type { MutableRefObject } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Camera, User } from 'lucide-react'

type CustomerProfileViewProps = {
  avatarPreviewUrl: string | null
  profileName: string
  profileEmail: string
  profilePhone: string
  composedShippingAddress: string
  shippingCity: string
  shippingProvince: string
  shippingZipCode: string
  user: any
  isSavingProfile: boolean
  avatarInputRef: MutableRefObject<HTMLInputElement | null>
  openAvatarCropDialog: (file: File | null) => Promise<void>
  setIsProfileDialogOpen: (value: boolean) => void
}

export function CustomerProfileView({
  avatarPreviewUrl,
  profileName,
  profileEmail,
  profilePhone,
  composedShippingAddress,
  shippingCity,
  shippingProvince,
  shippingZipCode,
  user,
  isSavingProfile,
  avatarInputRef,
  openAvatarCropDialog,
  setIsProfileDialogOpen,
}: CustomerProfileViewProps) {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center">
            <div className="relative mb-3">
              <Avatar className="h-16 w-16">
                {avatarPreviewUrl ? <AvatarImage src={avatarPreviewUrl} alt={profileName || user?.name || 'Profile'} /> : null}
                <AvatarFallback className="bg-teal-700 text-white">{(profileName || user?.name || 'C').charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
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
              <Button
                type="button"
                size="icon"
                className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-teal-700 p-0 text-white hover:bg-teal-800"
                onClick={() => avatarInputRef.current?.click()}
                disabled={isSavingProfile}
              >
                <Camera className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="font-semibold">{profileName || user?.name}</p>
            <p className="text-sm text-gray-500">{profilePhone || 'No phone number'}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Profile Preview</CardTitle>
          <CardDescription>View your account details. Edit opens in a popup.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 text-sm">
            <p><span className="font-medium">Name:</span> {profileName || 'Not set'}</p>
            <p><span className="font-medium">Email:</span> {profileEmail || 'Not set'}</p>
            <p><span className="font-medium">Phone:</span> {profilePhone || 'Not set'}</p>
            <p><span className="font-medium">Delivery Address:</span> {composedShippingAddress || 'Not set'}</p>
            <p><span className="font-medium">City/Province:</span> {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'}` : 'Not set'}</p>
            <p><span className="font-medium">Postal Code:</span> {shippingZipCode || 'Not set'}</p>
          </div>
          <Button className="w-full" onClick={() => setIsProfileDialogOpen(true)}>
            <User className="h-4 w-4 mr-2" />
            Edit Profile
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

