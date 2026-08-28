'use client'

import dynamic from 'next/dynamic'
import { ArrowLeft, Loader2, MapPin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function CustomerEditAddressPage(props: any) {
  const {
    onBack,
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
    handlePinnedLocation,
    handleOutsideServiceArea,
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
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-5 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      {/* ── Top Nav / Header ── */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 md:px-5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <h2 className="text-base font-bold text-slate-900 md:text-lg">Edit Address</h2>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
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
          title="Clear address fields"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>

      {/* ── Form Body ── */}
      <div className="mx-auto max-w-2xl px-3 pt-4 pb-6 md:px-6 md:pt-5 space-y-5">
        {/* Contact Info */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
          <p className="text-sm font-bold text-slate-900">Contact Information</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Full Name</Label>
              <Input
                placeholder="Full name"
                className="h-10 rounded-lg border-slate-200"
                value={shippingName}
                onChange={(e) => setShippingName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Phone Number</Label>
              <Input
                className="h-10 rounded-lg border-slate-200"
                placeholder="09XX XXX XXXX or 639XX XXX XXXX"
                maxLength={13}
                required
                value={shippingPhone}
                onChange={(e) => {
                  const next = formatPhilippinePhoneInput(e.target.value)
                  setShippingPhone(next)
                  e.currentTarget.setCustomValidity('')
                }}
                onInvalid={(e) => {
                  const el = e.currentTarget
                  const value = String(el.value || '').trim()
                  if (!value) {
                    el.setCustomValidity('Please enter a Philippine mobile number.')
                    return
                  }
                  if (!isValidPhilippinePhone(value)) {
                    el.setCustomValidity(
                      'Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567).'
                    )
                    return
                  }
                  el.setCustomValidity('')
                }}
                onBlur={(e) => {
                  const el = e.currentTarget
                  const value = String(el.value || '').trim()
                  if (!value || isValidPhilippinePhone(value)) {
                    el.setCustomValidity('')
                    return
                  }
                  el.setCustomValidity(
                    'Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567).'
                  )
                  el.reportValidity()
                }}
              />
            </div>
          </div>
        </div>

        {/* Address Details */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
          <div>
            <p className="text-sm font-bold text-slate-900">Address Details</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Fill up the fields manually or select your location on the map below.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">House number (optional)</Label>
              <Input
                placeholder="House number"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingHouseNumber}
                onChange={(e) => setShippingHouseNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Street name</Label>
              <Input
                placeholder="Street name"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingStreetName}
                onChange={(e) => setShippingStreetName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Subdivision (optional)</Label>
              <Input
                placeholder="Subdivision"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingSubdivision}
                onChange={(e) => setShippingSubdivision(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Barangay</Label>
              <Input
                placeholder="Barangay"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingBarangay}
                onChange={(e) => setShippingBarangay(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">City / Municipality</Label>
              <Input
                placeholder="City / Municipality"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingCity}
                onChange={(e) => setShippingCity(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Province</Label>
              <Input
                placeholder="Province"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingProvince}
                onChange={(e) => setShippingProvince(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Postal code</Label>
              <Input
                placeholder="Postal code"
                className="h-9 text-xs rounded-lg border-slate-200"
                value={shippingZipCode}
                onChange={(e) => setShippingZipCode(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Country</Label>
              <Input
                className="h-9 text-xs rounded-lg border-slate-200 bg-slate-50 text-slate-500"
                value={shippingCountry}
                disabled
                readOnly
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
            <p className="text-xs font-medium text-slate-700">Full Address Preview:</p>
            <p className="mt-0.5 text-xs text-slate-600">
              {composedShippingAddress || 'Not complete yet'}
            </p>
          </div>
        </div>

        {/* Map Picker */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <MapPin className="h-4 w-4 text-emerald-600" />
              Pin Address on Map
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50"
              onClick={useCurrentLocation}
            >
              <MapPin className="h-3.5 w-3.5 mr-1" />
              Use Current Location
            </Button>
          </div>

          <AddressMapPicker
            latitude={shippingLatitude}
            longitude={shippingLongitude}
            onChange={handlePinnedLocation}
            onOutsideServiceArea={handleOutsideServiceArea}
          />

          <p className="text-xs text-slate-600">
            {shippingLatitude !== null && shippingLongitude !== null
              ? `Pinned Location: ${shippingLatitude.toFixed(6)}, ${shippingLongitude.toFixed(6)}`
              : 'No location pinned yet'}
          </p>

          {isResolvingPinnedAddress && (
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              Auto-filling address from pinned location...
            </p>
          )}
        </div>

        {/* Save button */}
        <div className="space-y-2 pt-2">
          <Button
            className="w-full h-11 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
            onClick={async () => {
              const saved = await saveAddressToProfile?.()
              if (saved) onBack?.()
            }}
            disabled={isSavingAddress}
          >
            {isSavingAddress ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Address
          </Button>

          <p className="text-center text-[11px] text-slate-400">
            By clicking Save, you acknowledge that you have read the Privacy Policy.
          </p>
        </div>
      </div>
    </section>
  )
}
