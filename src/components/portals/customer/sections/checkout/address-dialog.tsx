'use client'

import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2, MapPin, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function CustomerAddressDialog(props: any) {
  const {
    isAddressDialogOpen,
    setIsAddressDialogOpen,
    setShippingHouseNumber,
    setShippingStreetName,
    setShippingSubdivision,
    setShippingBarangay,
    setShippingCity,
    setShippingProvince,
    setShippingZipCode,
    setShippingLatitude,
    setShippingLongitude,
    setAddressSearch,
    setAddressSearchResults,
    shippingName,
    setShippingName,
    shippingPhone,
    setShippingPhone,
    addressSearch,
    isSearchingAddress,
    searchAddressInNegrosOccidental,
    addressSearchResults,
    handlePinnedLocation,
    shippingHouseNumber,
    shippingStreetName,
    shippingSubdivision,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    shippingZipCode,
    shippingCountry,
    composedShippingAddress,
    useCurrentLocation,
    shippingLatitude,
    shippingLongitude,
    isResolvingPinnedAddress,
    saveAddressToProfile,
    isSavingAddress,
  } = props

  return (
    <Dialog open={isAddressDialogOpen} onOpenChange={setIsAddressDialogOpen}>
      <DialogContent showCloseButton={false} className="max-w-md max-h-[95vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Edit Address</DialogTitle>
          <DialogDescription>Set your address in Negros Occidental, Philippines.</DialogDescription>
        </DialogHeader>
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <div className="border-b px-4 py-3 flex items-center justify-between">
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </DialogClose>
            <h2 className="text-base font-semibold">Edit Address</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setShippingHouseNumber('')
                setShippingStreetName('')
                setShippingSubdivision('')
                setShippingBarangay('')
                setShippingCity('')
                setShippingProvince('Negros Occidental')
                setShippingZipCode('')
                setShippingLatitude(null)
                setShippingLongitude(null)
                setAddressSearch('')
                setAddressSearchResults([])
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="Full name" value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Phone number</Label>
              <div className="flex rounded-md border bg-white">
                <div className="px-3 py-2 text-sm text-gray-600 border-r">PH +63</div>
                <Input
                  className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="9460056944"
                  value={shippingPhone}
                  onChange={(e) => setShippingPhone(e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <div className="rounded-md border bg-gray-50 p-3 space-y-3">
                <p className="text-xs text-gray-500">Fill up manually, or use Search Address, or pin on the map.</p>

                <div className="space-y-2">
                  <Label className="text-xs text-gray-600">Search Address (Alternative)</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search street, barangay, or city in Negros Occidental"
                      value={addressSearch}
                      onChange={(e) => setAddressSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          searchAddressInNegrosOccidental()
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={searchAddressInNegrosOccidental} disabled={isSearchingAddress}>
                      {isSearchingAddress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                  {addressSearchResults.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-500">Nearby locations</p>
                      <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {addressSearchResults.map((item: any, index: number) => {
                          const parts = item.displayName.split(',')
                          const title = parts[0]?.trim() || 'Address result'
                          const subtitle = parts.slice(1).join(',').trim()
                          return (
                            <button
                              key={`${item.latitude}-${item.longitude}-${index}`}
                              type="button"
                              className="w-full text-left flex items-start gap-3"
                              onClick={() => {
                                setAddressSearch(title)
                                setAddressSearchResults([])
                                void handlePinnedLocation(item.latitude, item.longitude)
                              }}
                            >
                              <MapPin className="h-5 w-5 text-gray-500 mt-1 shrink-0" />
                              <span className="block">
                                <span className="block font-semibold text-sm text-gray-900">{title}</span>
                                <span className="block text-sm text-gray-500">{subtitle}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">House number (optional)</Label>
                    <Input placeholder="House number" value={shippingHouseNumber} onChange={(e) => setShippingHouseNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Street name</Label>
                    <Input placeholder="Street name" value={shippingStreetName} onChange={(e) => setShippingStreetName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Subdivision (optional)</Label>
                    <Input placeholder="Subdivision" value={shippingSubdivision} onChange={(e) => setShippingSubdivision(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Barangay</Label>
                    <Input placeholder="Barangay" value={shippingBarangay} onChange={(e) => setShippingBarangay(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">City / Municipality</Label>
                    <Input placeholder="City / Municipality" value={shippingCity} onChange={(e) => setShippingCity(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Province</Label>
                    <Input placeholder="Province" value={shippingProvince} onChange={(e) => setShippingProvince(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Postal code</Label>
                    <Input placeholder="Postal code" value={shippingZipCode} onChange={(e) => setShippingZipCode(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Country</Label>
                    <Input value={shippingCountry} disabled readOnly />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Full address: {composedShippingAddress || 'Not complete yet'}
                </p>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  Pin Address on Map
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={useCurrentLocation}>
                  <MapPin className="h-4 w-4 mr-1" />
                  Use Current Location
                </Button>
              </div>
              <AddressMapPicker latitude={shippingLatitude} longitude={shippingLongitude} onChange={handlePinnedLocation} />
              <p className="text-xs text-gray-600">
                {shippingLatitude !== null && shippingLongitude !== null
                  ? `Pinned: ${shippingLatitude.toFixed(6)}, ${shippingLongitude.toFixed(6)}`
                  : 'No location pinned yet'}
              </p>
              {isResolvingPinnedAddress && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Auto-filling address from pinned location...
                </p>
              )}
            </div>

            <p className="text-xs text-center text-gray-500">
              By clicking Save, you acknowledge that you have read the Privacy Policy.
            </p>

            <Button
              className="w-full rounded-full bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                const saved = await saveAddressToProfile()
                if (saved) setIsAddressDialogOpen(false)
              }}
              disabled={isSavingAddress}
            >
              {isSavingAddress ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
