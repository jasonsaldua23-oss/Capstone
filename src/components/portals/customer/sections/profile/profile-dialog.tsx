'use client'

import { motion } from 'framer-motion'
import { Loader2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  } = props

  return (
    <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
      <DialogContent className="max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update your account details and profile picture.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="customer-profile-name">Full Name</Label>
              <Input
                id="customer-profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-email">Email</Label>
              <Input
                id="customer-profile-email"
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-profile-phone">Phone</Label>
              <Input
                id="customer-profile-phone"
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                placeholder="Enter your phone number"
              />
            </div>
            <div className="space-y-2 rounded-md border p-3 bg-slate-50">
              <Label>Delivery Address</Label>
              <p className="text-sm text-slate-700">{composedShippingAddress || 'Not set'}</p>
              <p className="text-xs text-slate-500">
                {shippingCity ? `${shippingCity}, ${shippingProvince || 'Negros Occidental'} ${shippingZipCode || ''}`.trim() : 'City/Province not set'}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
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
                const saved = await saveProfile()
                if (saved) setIsProfileDialogOpen(false)
              }}
              disabled={isSavingProfile}
              className="w-full"
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
