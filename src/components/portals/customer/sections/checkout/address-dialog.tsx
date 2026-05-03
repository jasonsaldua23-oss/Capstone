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
      <DialogContent showCloseButton={false} className="max-w-md max-h-[95vh] overflow-y-auto rounded-3xl border border-emerald-100 bg-white p-0 shadow-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Edit Address</DialogTitle>
          <DialogDescription>Set your address in Negros Occidental, Philippines.</DialogDescription>
        </DialogHeader>
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-600 hover:bg-emerald-50 hover:text-emerald-700">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </DialogClose>
            <h2 className="text-base font-semibold text-slate-900">Edit Address</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-slate-600 hover:bg-rose-50 hover:text-rose-700"
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

          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="Full name" value={shippingName} onChange={(e) => setShippingName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Phone number</Label>
              <div className="flex h-11 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center whitespace-nowrap border-r border-slate-200 px-3 text-sm font-medium text-slate-600">PH +63</div>
                <Input
                  className="h-11 rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="9460056944"
                  value={shippingPhone}
                  onChange={(e) => setShippingPhone(e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Address</Label>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                <p className="text-xs text-slate-500">Fill up manually, or use Search Address, or pin on the map.</p>

                <div className="space-y-2">
                  <Label className="text-xs text-slate-600">Search Address (Alternative)</Label>
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
                      <p className="text-sm font-medium text-slate-500">Nearby locations</p>
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
                              <MapPin className="mt-1 h-5 w-5 shrink-0 text-slate-500" />
                              <span className="block">
                                <span className="block text-sm font-semibold text-slate-900">{title}</span>
                                <span className="block text-sm text-slate-500">{subtitle}</span>
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
                    <Label className="text-xs text-slate-600">House number (optional)</Label>
                    <Input placeholder="House number" value={shippingHouseNumber} onChange={(e) => setShippingHouseNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Street name</Label>
                    <Input placeholder="Street name" value={shippingStreetName} onChange={(e) => setShippingStreetName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Subdivision (optional)</Label>
                    <Input placeholder="Subdivision" value={shippingSubdivision} onChange={(e) => setShippingSubdivision(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Barangay</Label>
                    <Input placeholder="Barangay" value={shippingBarangay} onChange={(e) => setShippingBarangay(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">City / Municipality</Label>
                    <Input placeholder="City / Municipality" value={shippingCity} onChange={(e) => setShippingCity(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Province</Label>
                    <Input placeholder="Province" value={shippingProvince} onChange={(e) => setShippingProvince(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Postal code</Label>
                    <Input placeholder="Postal code" value={shippingZipCode} onChange={(e) => setShippingZipCode(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Country</Label>
                    <Input value={shippingCountry} disabled readOnly />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Full address: {composedShippingAddress || 'Not complete yet'}
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  Pin Address on Map
                </Label>
                <Button type="button" variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={useCurrentLocation}>
                  <MapPin className="h-4 w-4 mr-1" />
                  Use Current Location
                </Button>
              </div>
              <AddressMapPicker latitude={shippingLatitude} longitude={shippingLongitude} onChange={handlePinnedLocation} />
              <p className="text-xs text-slate-600">
                {shippingLatitude !== null && shippingLongitude !== null
                  ? `Pinned: ${shippingLatitude.toFixed(6)}, ${shippingLongitude.toFixed(6)}`
                  : 'No location pinned yet'}
              </p>
              {isResolvingPinnedAddress && (
                <p className="flex items-center gap-1 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Auto-filling address from pinned location...
                </p>
              )}
            </div>

            <p className="text-center text-xs text-slate-500">
              By clicking Save, you acknowledge that you have read the Privacy Policy.
            </p>

            <Button
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
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
