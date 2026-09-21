import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { validatePersonName } from '@/lib/person-name'
import { fetchCustomerProfile, updateCustomerProfile } from '../profile/profile-api'
import { extractCustomerPayload } from '../shared/customer-common'
import { SERVICE_AREA_MESSAGE } from '@/lib/service-area'
import { isValidPhilippinePhone } from '@/lib/philippine-phone'
import { buildManualAddressQuery } from '../../customer-portal-utils'
import type { Dispatch, SetStateAction } from 'react'
import type { CustomerPortalState } from '../layout/portal-state'
import type { AuthUser } from '@/types'

/**
 * Delivery address for the customer: hydrating it from the profile, the manual form and map pin kept in step, service-area checks, geocoding search, and saving back to the profile.
 */
export type CustomerAddressInputs = {
  activeView: CustomerPortalState['activeView']
  addressSearch: CustomerPortalState['addressSearch']
  customerId: string
  isAddressDialogOpen: CustomerPortalState['isAddressDialogOpen']
  isInServiceArea: (lat: number, lng: number) => boolean
  isResolvingPinnedAddress: CustomerPortalState['isResolvingPinnedAddress']
  profileFirstName: CustomerPortalState['profileFirstName']
  profileLastName: CustomerPortalState['profileLastName']
  profileMiddleName: CustomerPortalState['profileMiddleName']
  profileNoMiddleName: CustomerPortalState['profileNoMiddleName']
  profileSuffix: CustomerPortalState['profileSuffix']
  setAddressSearchResults: CustomerPortalState['setAddressSearchResults']
  setCustomerDiscountAmountPerCase: Dispatch<SetStateAction<number>>
  setCustomerDiscountOption: Dispatch<SetStateAction<string>>
  setCustomerDiscountPercent: Dispatch<SetStateAction<number>>
  setCustomerDiscountStatus: Dispatch<SetStateAction<string>>
  setIsResolvingPinnedAddress: CustomerPortalState['setIsResolvingPinnedAddress']
  setIsSavingAddress: CustomerPortalState['setIsSavingAddress']
  setIsSearchingAddress: CustomerPortalState['setIsSearchingAddress']
  setProfileAvatar: CustomerPortalState['setProfileAvatar']
  setProfileAvatarFile: CustomerPortalState['setProfileAvatarFile']
  setProfileEmail: CustomerPortalState['setProfileEmail']
  setProfileFirstName: CustomerPortalState['setProfileFirstName']
  setProfileLastName: CustomerPortalState['setProfileLastName']
  setProfileMiddleName: CustomerPortalState['setProfileMiddleName']
  setProfileNoMiddleName: CustomerPortalState['setProfileNoMiddleName']
  setProfileName: CustomerPortalState['setProfileName']
  setProfilePhone: CustomerPortalState['setProfilePhone']
  setProfileSuffix: CustomerPortalState['setProfileSuffix']
  setShippingBarangay: CustomerPortalState['setShippingBarangay']
  setShippingCity: CustomerPortalState['setShippingCity']
  setShippingCountry: CustomerPortalState['setShippingCountry']
  setShippingHouseNumber: CustomerPortalState['setShippingHouseNumber']
  setShippingLatitude: CustomerPortalState['setShippingLatitude']
  setShippingLongitude: CustomerPortalState['setShippingLongitude']
  setShippingPhone: CustomerPortalState['setShippingPhone']
  setShippingProvince: CustomerPortalState['setShippingProvince']
  setShippingStreetName: CustomerPortalState['setShippingStreetName']
  setShippingSubdivision: CustomerPortalState['setShippingSubdivision']
  setShippingZipCode: CustomerPortalState['setShippingZipCode']
  shippingBarangay: CustomerPortalState['shippingBarangay']
  shippingCity: CustomerPortalState['shippingCity']
  shippingCountry: CustomerPortalState['shippingCountry']
  shippingHouseNumber: CustomerPortalState['shippingHouseNumber']
  shippingLatitude: CustomerPortalState['shippingLatitude']
  shippingLongitude: CustomerPortalState['shippingLongitude']
  shippingName: CustomerPortalState['shippingName']
  shippingPhone: CustomerPortalState['shippingPhone']
  shippingProvince: CustomerPortalState['shippingProvince']
  shippingStreetName: CustomerPortalState['shippingStreetName']
  shippingSubdivision: CustomerPortalState['shippingSubdivision']
  shippingZipCode: CustomerPortalState['shippingZipCode']
}

export function useCustomerAddress(inputs: CustomerAddressInputs) {
  const {
    activeView,
    addressSearch,
    customerId,
    isAddressDialogOpen,
    isInServiceArea,
    isResolvingPinnedAddress,
    profileFirstName,
    profileLastName,
    profileMiddleName,
    profileNoMiddleName,
    profileSuffix,
    setAddressSearchResults,
    setCustomerDiscountAmountPerCase,
    setCustomerDiscountOption,
    setCustomerDiscountPercent,
    setCustomerDiscountStatus,
    setIsResolvingPinnedAddress,
    setIsSavingAddress,
    setIsSearchingAddress,
    setProfileAvatar,
    setProfileAvatarFile,
    setProfileEmail,
    setProfileFirstName,
    setProfileLastName,
    setProfileMiddleName,
    setProfileNoMiddleName,
    setProfileName,
    setProfilePhone,
    setProfileSuffix,
    setShippingBarangay,
    setShippingCity,
    setShippingCountry,
    setShippingHouseNumber,
    setShippingLatitude,
    setShippingLongitude,
    setShippingPhone,
    setShippingProvince,
    setShippingStreetName,
    setShippingSubdivision,
    setShippingZipCode,
    shippingBarangay,
    shippingCity,
    shippingCountry,
    shippingHouseNumber,
    shippingLatitude,
    shippingLongitude,
    shippingName,
    shippingPhone,
    shippingProvince,
    shippingStreetName,
    shippingSubdivision,
    shippingZipCode,
  } = inputs

  const manualAddressPinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualAddressPinAbortRef = useRef<AbortController | null>(null)
  const lastManualAddressQueryRef = useRef('')
  const wasAddressEditorOpenRef = useRef(false)
  const lastOutsideServiceAreaQueryRef = useRef('')
  // Added: the last customer record the server returned, so the profile editor can
  // throw away unsaved edits instead of leaving them in the shared form state.
  const lastSavedProfileRef = useRef<any | null>(null)
  const applyProfileFields = (customer: any) => {
    const customerNameParts = String(customer?.name || '').trim().split(/\s+/).filter(Boolean)
    setProfileName(String(customer?.name || '').trim())
    setProfileFirstName(String(customer?.firstName || customerNameParts[0] || '').trim())
    setProfileMiddleName(String(customer?.middleName || '').trim())
    setProfileNoMiddleName(!String(customer?.middleName || '').trim())
    setProfileLastName(String(customer?.lastName || customerNameParts.slice(1).join(' ') || '').trim())
    setProfileSuffix(String(customer?.suffix || '').trim())
    setProfileEmail(String(customer?.email || '').trim())
    setProfilePhone(String(customer?.phone || '').trim())
    setProfileAvatar(customer?.avatar ? String(customer.avatar) : null)
    setProfileAvatarFile(null)
  }
  const resetProfileForm = () => {
    if (lastSavedProfileRef.current) applyProfileFields(lastSavedProfileRef.current)
  }
  const hydrateAddressFromProfile = (customer: any) => {
    lastSavedProfileRef.current = customer
    const rawAddress = String(customer?.address || '').trim()
    const city = String(customer?.city || '').trim()
    const state = String(customer?.province || '').trim() || 'Negros Occidental'
    const zipCode = String(customer?.zipCode || '').trim()

    const parts = rawAddress
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    const normalizeToken = (value: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()
    const isCountryLike = (value: string) => /philippines/i.test(String(value || ''))
    const isPostalLike = (value: string) => /^\d{4}$/.test(String(value || '').trim())
    const isHouseLike = (value: string) => /^(\d+|#|lot|blk|block)\b/i.test(String(value || '').trim())
    const isBarangayLike = (value: string) => /\b(barangay|brgy\.?|poblacion)\b/i.test(String(value || ''))
    const isSubdivisionLike = (value: string) =>
      /\b(subdivision|homes?|villages?|heights?|plains?|residences?)\b/i.test(String(value || ''))

    const tokens = [...parts]
    if (tokens.length > 0 && isCountryLike(tokens[tokens.length - 1])) tokens.pop()
    if (tokens.length > 0 && isPostalLike(tokens[tokens.length - 1])) tokens.pop()
    if (tokens.length > 0 && normalizeToken(tokens[tokens.length - 1]) === normalizeToken(state)) tokens.pop()
    if (city && tokens.length > 0 && normalizeToken(tokens[tokens.length - 1]) === normalizeToken(city)) tokens.pop()

    let houseNumber = ''
    let streetName = ''
    let subdivision = ''
    let barangay = String(customer?.barangay || customer?.brgy || '').trim()

    if (tokens.length === 1) {
      streetName = tokens[0] || ''
    } else if (tokens.length >= 2) {
      if (isHouseLike(tokens[0])) {
        houseNumber = tokens[0] || ''
        streetName = tokens[1] || ''
      } else {
        streetName = tokens[0] || ''
      }

      const remaining = tokens.slice(isHouseLike(tokens[0]) ? 2 : 1)
      const barangayCandidate =
        remaining.find((token) => isBarangayLike(token)) ||
        remaining.find((token) => !isSubdivisionLike(token)) ||
        ''
      if (!barangay && barangayCandidate && !isSubdivisionLike(barangayCandidate)) {
        barangay = barangayCandidate
      }

      // Optional field: only populate when token explicitly looks like subdivision.
      const subdivisionCandidate = remaining.find(
        (token) => isSubdivisionLike(token) && !isBarangayLike(token)
      )
      if (subdivisionCandidate) {
        subdivision = subdivisionCandidate
      }
    }

    const hydratedPhone = String(customer?.phone || '').trim()
    setShippingPhone(hydratedPhone)
    setShippingHouseNumber(houseNumber)
    setShippingStreetName(streetName)
    setShippingSubdivision(subdivision)
    setShippingBarangay(barangay)
    setShippingCity(city)
    setShippingProvince(state)
    setShippingZipCode(zipCode)
    setShippingCountry('Philippines')
    const hydratedLatitude = typeof customer?.latitude === 'number' ? customer.latitude : null
    const hydratedLongitude = typeof customer?.longitude === 'number' ? customer.longitude : null
    setShippingLatitude(hydratedLatitude)
    setShippingLongitude(hydratedLongitude)

    // The saved fields and the saved pin belong together, so record them as synced and
    // let the map keep the exact coordinates the customer saved.
    lastManualAddressQueryRef.current =
      hydratedLatitude !== null && hydratedLongitude !== null
        ? buildManualAddressQuery({
            house: houseNumber,
            street: streetName,
            subdivision,
            barangay,
            city,
            province: state,
            zip: zipCode,
            country: 'Philippines',
          })
        : ''
    applyProfileFields(customer)
    setCustomerDiscountOption(String(customer?.discountOption || 'NO_DISCOUNT').toUpperCase())
    setCustomerDiscountStatus(String(customer?.discountStatus || 'REMOVED').toUpperCase())
    setCustomerDiscountPercent(Number(customer?.discountPercent || 0))
    setCustomerDiscountAmountPerCase(Number(customer?.discountAmountPerCase || 0))
  }

  const loadCustomerProfile = useCallback(async (silent = true) => {
    if (!customerId) return
    try {
      const { response, data: payload } = await fetchCustomerProfile(customerId)
      if (!response?.ok) throw new Error('Failed to load customer profile')
      const customer = extractCustomerPayload(payload)
      if (!customer) throw new Error('Customer profile is missing')
      hydrateAddressFromProfile(customer)
    } catch (error: any) {
      console.warn('Failed to load customer profile:', error)
    }
  }, [customerId])

  useEffect(() => {
    loadCustomerProfile()
  }, [loadCustomerProfile])
  const composedShippingAddress = useMemo(() => {
    return [
      shippingHouseNumber,
      shippingStreetName,
      shippingSubdivision,
      shippingBarangay,
      shippingCity,
      shippingProvince || 'Negros Occidental',
      shippingZipCode,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ')
  }, [
    shippingHouseNumber,
    shippingStreetName,
    shippingSubdivision,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    shippingZipCode,
  ])
  const saveAddressToProfile = async () => {
    if (!customerId) {
      toast.error('Unable to save address right now')
      return false
    }
    // Fix: the middle name is optional for every customer, ticked box or not.
    if (!profileFirstName.trim() || !profileLastName.trim()) {
      toast.error('First name and last name are required.')
      return false
    }
    const nameError = validatePersonName(shippingName, profileFirstName, profileMiddleName, profileLastName, profileSuffix)
    if (nameError) {
      toast.error(nameError)
      return false
    }
    if (
      !shippingStreetName ||
      !shippingCity ||
      !shippingProvince ||
      !shippingZipCode
    ) {
      toast.error('Please complete street, city, province, and postal code before saving')
      return false
    }
    if (shippingLatitude === null || shippingLongitude === null) {
      toast.error('Please pin your address on the map before saving')
      return false
    }
    if (!isInServiceArea(shippingLatitude, shippingLongitude)) {
      toast.error(SERVICE_AREA_MESSAGE)
      return false
    }
    const normalizedShippingPhone = String(shippingPhone || '').replace(/\D/g, '')
    if (!normalizedShippingPhone || !isValidPhilippinePhone(normalizedShippingPhone)) {
      toast.error('Please enter a valid Philippine mobile number before saving')
      return false
    }

    setIsSavingAddress(true)
    try {
      const { response, payload: data } = await updateCustomerProfile(customerId, {
        // Keep Contact Information and Profile backed by the same structured name fields.
        firstName: profileFirstName.trim(),
        middleName: (profileNoMiddleName ? '' : profileMiddleName.trim()) || null,
        lastName: profileLastName.trim(),
        suffix: profileSuffix.trim(),
        address: composedShippingAddress,
        barangay: shippingBarangay,
        subdivision: shippingSubdivision,
        streetName: shippingStreetName,
        houseNumber: shippingHouseNumber,
        city: shippingCity,
        province: shippingProvince || 'Negros Occidental',
        zipCode: shippingZipCode,
        country: 'Philippines',
        latitude: shippingLatitude,
        longitude: shippingLongitude,
        phone: normalizedShippingPhone,
      })
      if (!response.ok || data?.success === false) throw new Error(data?.error || 'Failed to save')
      const updatedCustomer = extractCustomerPayload(data)
      if (updatedCustomer) {
        hydrateAddressFromProfile(updatedCustomer)
      }
      await loadCustomerProfile()
      toast.success('Address saved successfully')
      return true
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save address')
      return false
    } finally {
      setIsSavingAddress(false)
    }
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        if (!isInServiceArea(lat, lng)) {
          toast.error(`Your current location is outside our delivery area. ${SERVICE_AREA_MESSAGE}`)
          return
        }
        await handlePinnedLocation(lat, lng)
        toast.success('Current location pinned')
      },
      () => {
        toast.error('Failed to get your current location')
      }
    )
  }

  const handleOutsideServiceArea = () => {
    toast.error(SERVICE_AREA_MESSAGE)
  }

  const handlePinnedLocation = async (lat: number, lng: number) => {
    // Last line of defence for callers that do not pre-check (saved-address picks,
    // search results), so a pin can never land outside the delivery area.
    if (!isInServiceArea(lat, lng)) {
      toast.error(SERVICE_AREA_MESSAGE)
      return
    }

    setShippingLatitude(lat)
    setShippingLongitude(lng)
    setIsResolvingPinnedAddress(true)

    try {
      const fetchReverse = async (zoom: number) => {
        const reverseResponse = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&countrycodes=ph&zoom=${zoom}`,
          {
            headers: {
              Accept: 'application/json',
            },
          }
        )
        if (!reverseResponse.ok) {
          throw new Error('Reverse geocoding failed')
        }
        return reverseResponse.json()
      }

      const data = await fetchReverse(18)

      const addr = data?.address || {}
      const displayName = String(data?.display_name || '')
      const displayParts = displayName
        .split(',')
        .map((part: string) => part.trim())
        .filter(Boolean)
      const postcodeFromDisplay = displayName.match(/\b\d{4}\b/)?.[0] || ''
      const normalizeAddressToken = (value: string) =>
        String(value || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .trim()
      const isPostalLike = (value: string) => /^\d{4}$/.test(String(value || '').trim())
      const isCountryLike = (value: string) => /philippines/i.test(String(value || ''))
      const isBarangayLike = (value: string) => /\b(barangay|brgy\.?|poblacion)\b/i.test(String(value || ''))
      const isSubdivisionLike = (value: string) =>
        /\b(subdivision|homes?|villages?|heights?|plains?|residences?)\b/i.test(String(value || ''))
      const isStreetLike = (value: string) =>
        /\b(street|st\.?|road|rd\.?|avenue|ave\.?|highway|hwy|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|way|purok\s*\d*)\b/i.test(String(value || ''))

      const barangayFromDisplay =
        displayParts.find((part: string) => /^(barangay|brgy\.?)\s+/i.test(part)) ||
        displayParts.find((part: string) => /\b(barangay|brgy\.?)\b/i.test(part)) ||
        ''

      const houseNumber = String(addr.house_number || '').trim()
      const streetName = String(
        addr.road ||
        addr.residential ||
        addr.pedestrian ||
        addr.path ||
        addr.footway ||
        addr.street ||
        displayParts[0] ||
        ''
      ).trim()
      let subdivision = String(
        addr.subdivision ||
        // Keep optional subdivision conservative: only explicit subdivision-like fields.
        addr.allotments ||
        addr.village ||
        ''
      ).trim()
      if (subdivision && !isSubdivisionLike(subdivision)) {
        subdivision = ''
      }
      let city = String(
        addr.city ||
        addr.town ||
        addr.municipality ||
        ''
      ).trim()
      let province = String(addr.state || addr.region || '').trim()
      const postcode = String(addr.postcode || postcodeFromDisplay || '').trim()
      const country = String(addr.country || 'Philippines').trim()

      if (!province) {
        province =
          displayParts.find((part: string) => /negros occidental/i.test(part)) ||
          displayParts.find((part: string) => /province|occidental/i.test(part)) ||
          'Negros Occidental'
      }

      if (!city) {
        const provinceIndex = displayParts.findIndex(
          (part: string) => normalizeAddressToken(part) === normalizeAddressToken(province)
        )
        if (provinceIndex > 0) {
          city = displayParts[provinceIndex - 1] || ''
        } else {
          city =
            displayParts.find((part: string) => /city|municipality|silay|bacolod|talisay|bago|cadiz|escalante|victorias|himamaylan|kabankalan|sagay|san carlos|la carlota/i.test(part)) ||
            ''
        }
      }

      const localityTokens = displayParts.filter((part: string) => {
        const normalized = normalizeAddressToken(part)
        if (!normalized) return false
        if (isCountryLike(part)) return false
        if (isPostalLike(part)) return false
        if (normalizeAddressToken(part) === normalizeAddressToken(province)) return false
        if (city && normalizeAddressToken(part) === normalizeAddressToken(city)) return false
        if (streetName && normalizeAddressToken(part) === normalizeAddressToken(streetName)) return false
        if (isStreetLike(part)) return false
        return true
      })

      let barangay = String(
        addr.barangay ||
        addr.suburb ||
        addr.neighbourhood ||
        addr.quarter ||
        addr.city_district ||
        addr.hamlet ||
        barangayFromDisplay ||
        ''
      ).trim()

      // Prefer explicit barangay tokens from display name when available.
      if (barangayFromDisplay) {
        barangay = barangayFromDisplay
      }

      // If reverse geocoder omits barangay, infer it from display tokens nearest to city/province.
      if (!barangay) {
        const likelyBarangay =
          localityTokens.find((token) => /barangay|brgy|poblacion|purok|sitio/i.test(token)) ||
          localityTokens.find((token) => !isStreetLike(token) && !isSubdivisionLike(token)) ||
          ''
        barangay = String(likelyBarangay || '').trim()
      }

      // Never keep barangay-like text in subdivision.
      if (subdivision && isBarangayLike(subdivision)) {
        if (!barangay) barangay = subdivision
        subdivision = ''
      }

      // Avoid duplicate values between subdivision and barangay.
      if (
        subdivision &&
        barangay &&
        normalizeAddressToken(subdivision) === normalizeAddressToken(barangay)
      ) {
        subdivision = ''
      }

      // Avoid putting city value into barangay when reverse geocoder returns coarse data.
      if (barangay && city && normalizeAddressToken(barangay) === normalizeAddressToken(city)) {
        barangay = ''
      }
      if (barangay && streetName && normalizeAddressToken(barangay) === normalizeAddressToken(streetName)) {
        barangay = ''
      }
      if (barangay && isStreetLike(barangay)) {
        barangay = ''
      }
      if (barangay && isSubdivisionLike(barangay)) {
        if (!subdivision) subdivision = barangay
        barangay = ''
      }

      // Fallback: if barangay is still missing at high zoom (POI-level),
      // request a coarser reverse-geocode to recover locality-level barangay.
      if (!barangay) {
        try {
          const coarseData = await fetchReverse(15)
          const coarseAddr = coarseData?.address || {}
          const coarseDisplayName = String(coarseData?.display_name || '')
          const coarseDisplayParts = coarseDisplayName
            .split(',')
            .map((part: string) => part.trim())
            .filter(Boolean)
          const coarseBarangayFromDisplay =
            coarseDisplayParts.find((part: string) => /^(barangay|brgy\.?)\s+/i.test(part)) ||
            coarseDisplayParts.find((part: string) => /\b(barangay|brgy\.?|poblacion|sitio|purok)\b/i.test(part)) ||
            ''
          const coarseCandidate = String(
            coarseAddr.barangay ||
            coarseAddr.suburb ||
            coarseAddr.neighbourhood ||
            coarseAddr.quarter ||
            coarseAddr.city_district ||
            coarseAddr.hamlet ||
            coarseBarangayFromDisplay ||
            ''
          ).trim()
          if (
            coarseCandidate &&
            (!city || normalizeAddressToken(coarseCandidate) !== normalizeAddressToken(city)) &&
            (!streetName || normalizeAddressToken(coarseCandidate) !== normalizeAddressToken(streetName)) &&
            !isStreetLike(coarseCandidate) &&
            !isSubdivisionLike(coarseCandidate)
          ) {
            barangay = coarseCandidate
          }
        } catch {
          // Keep manual entry flow when coarse lookup fails.
        }
      }

      // Final fallback: use nearest locality token if still empty.
      if (!barangay) {
        const finalLocalityToken =
          localityTokens.find((token) => /barangay|brgy|poblacion|sitio|purok/i.test(token)) ||
          localityTokens.find((token) => !isStreetLike(token) && !isSubdivisionLike(token)) ||
          ''
        if (
          finalLocalityToken &&
          (!city || normalizeAddressToken(finalLocalityToken) !== normalizeAddressToken(city)) &&
          (!streetName || normalizeAddressToken(finalLocalityToken) !== normalizeAddressToken(streetName))
        ) {
          barangay = String(finalLocalityToken).trim()
        }
      }

      setShippingHouseNumber(houseNumber)
      setShippingStreetName(streetName)
      setShippingSubdivision(subdivision)
      setShippingBarangay(barangay)
      setShippingCity(city)
      setShippingProvince(province)
      setShippingZipCode(postcode)
      setShippingCountry(country)

      // These fields describe the coordinates we were just handed, so mark them as
      // already synced — otherwise the manual-typing effect geocodes them right back
      // and drags the pin off the spot the user chose.
      lastManualAddressQueryRef.current = buildManualAddressQuery({
        house: houseNumber,
        street: streetName,
        subdivision,
        barangay,
        city,
        province,
        zip: postcode,
        country,
      })
    } catch {
      // Auto-fill failed, but the pin is still where the customer put it. Freeze whatever
      // is already typed against it so the manual-typing sync does not move it away.
      lastManualAddressQueryRef.current = buildManualAddressQuery({
        house: shippingHouseNumber,
        street: shippingStreetName,
        subdivision: shippingSubdivision,
        barangay: shippingBarangay,
        city: shippingCity,
        province: shippingProvince,
        zip: shippingZipCode,
        country: shippingCountry,
      })
      toast.error('Pinned location set, but address auto-fill failed. You can fill fields manually.')
    } finally {
      setIsResolvingPinnedAddress(false)
    }
  }
  // The address form lives in the dialog on some flows and on its own page on others;
  // both need the map pin kept in step with the fields.
  const isAddressEditorOpen = isAddressDialogOpen || activeView === 'edit-address'

  useEffect(() => {
    if (!isAddressEditorOpen) {
      wasAddressEditorOpenRef.current = false
      return
    }
    if (wasAddressEditorOpenRef.current) return
    wasAddressEditorOpenRef.current = true
    lastOutsideServiceAreaQueryRef.current = ''

    // A saved address opens with its own saved pin. Treat it as already synced so
    // opening the form never re-geocodes it and nudges the pin somewhere new.
    if (shippingLatitude !== null && shippingLongitude !== null) {
      lastManualAddressQueryRef.current = buildManualAddressQuery({
        house: shippingHouseNumber,
        street: shippingStreetName,
        subdivision: shippingSubdivision,
        barangay: shippingBarangay,
        city: shippingCity,
        province: shippingProvince,
        zip: shippingZipCode,
        country: shippingCountry,
      })
    } else {
      lastManualAddressQueryRef.current = ''
    }
  }, [
    isAddressEditorOpen,
    shippingHouseNumber,
    shippingStreetName,
    shippingSubdivision,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    shippingZipCode,
    shippingCountry,
    shippingLatitude,
    shippingLongitude,
  ])

  useEffect(() => {
    if (!isAddressEditorOpen) return
    if (isResolvingPinnedAddress) return

    const street = String(shippingStreetName || '').trim()
    const city = String(shippingCity || '').trim()
    const province = String(shippingProvince || '').trim()

    if (!street || !city || !province) return

    const query = buildManualAddressQuery({
      house: shippingHouseNumber,
      street: shippingStreetName,
      subdivision: shippingSubdivision,
      barangay: shippingBarangay,
      city: shippingCity,
      province: shippingProvince,
      zip: shippingZipCode,
      country: shippingCountry,
    })
    if (!query) return
    // Already resolved outside the delivery area; re-asking would only repeat the warning.
    if (query === lastOutsideServiceAreaQueryRef.current) return
    // With no pin on the map there is nothing in sync yet, so geocode even a query we
    // have seen before (e.g. the user cleared the form and retyped the same address).
    const hasPin = shippingLatitude !== null && shippingLongitude !== null
    if (hasPin && query === lastManualAddressQueryRef.current) return

    if (manualAddressPinDebounceRef.current) {
      clearTimeout(manualAddressPinDebounceRef.current)
    }

    manualAddressPinDebounceRef.current = setTimeout(async () => {
      try {
        if (manualAddressPinAbortRef.current) {
          manualAddressPinAbortRef.current.abort()
        }
        const controller = new AbortController()
        manualAddressPinAbortRef.current = controller

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        )
        if (!response.ok) return

        const data = await response.json()
        const top = Array.isArray(data) ? data[0] : null
        const lat = Number(top?.lat)
        const lng = Number(top?.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

        if (!isInServiceArea(lat, lng)) {
          // Drop the pin rather than leave it pointing at a previous, valid address while
          // the fields describe somewhere we do not deliver.
          setShippingLatitude(null)
          setShippingLongitude(null)
          lastManualAddressQueryRef.current = ''
          // Typing is noisy, so warn once per settled address instead of per keystroke.
          if (lastOutsideServiceAreaQueryRef.current !== query) {
            lastOutsideServiceAreaQueryRef.current = query
            toast.error(`That address is outside our delivery area. ${SERVICE_AREA_MESSAGE}`)
          }
          return
        }

        lastOutsideServiceAreaQueryRef.current = ''

        const sameLat = shippingLatitude !== null && Math.abs(shippingLatitude - lat) < 0.00001
        const sameLng = shippingLongitude !== null && Math.abs(shippingLongitude - lng) < 0.00001
        if (sameLat && sameLng) {
          lastManualAddressQueryRef.current = query
          return
        }

        setShippingLatitude(lat)
        setShippingLongitude(lng)
        lastManualAddressQueryRef.current = query
      } catch {
        // Keep manual typing flow uninterrupted when geocoding fails.
      }
    }, 700)

    return () => {
      if (manualAddressPinDebounceRef.current) {
        clearTimeout(manualAddressPinDebounceRef.current)
        manualAddressPinDebounceRef.current = null
      }
    }
  }, [
    isAddressEditorOpen,
    isResolvingPinnedAddress,
    shippingHouseNumber,
    shippingStreetName,
    shippingSubdivision,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    shippingZipCode,
    shippingCountry,
    shippingLatitude,
    shippingLongitude,
    setShippingLatitude,
    setShippingLongitude,
  ])

  useEffect(() => {
    return () => {
      if (manualAddressPinDebounceRef.current) {
        clearTimeout(manualAddressPinDebounceRef.current)
      }
      if (manualAddressPinAbortRef.current) {
        manualAddressPinAbortRef.current.abort()
      }
    }
  }, [])

  const searchAddressInNegrosOccidental = async () => {
    const query = addressSearch.trim()
    if (!query) {
      toast.error('Type an address to search')
      return
    }

    setIsSearchingAddress(true)
    try {
      const [localResponse, broadResponse] = await Promise.all([
        fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=15&addressdetails=1&q=${encodeURIComponent(
            `${query}, Negros Occidental, Philippines`
          )}`
        ),
        fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&limit=15&addressdetails=1&q=${encodeURIComponent(
            `${query}, Philippines`
          )}`
        ),
      ])

      if (!localResponse.ok && !broadResponse.ok) throw new Error('Search failed')

      type SearchAddress = {
        house_number?: string
        road?: string
        pedestrian?: string
        path?: string
        barangay?: string
        village?: string
        suburb?: string
        neighbourhood?: string
        city?: string
        town?: string
        municipality?: string
        province?: string
      }
      type SearchItem = {
        display_name: string
        lat: string
        lon: string
        address?: SearchAddress
      }

      const localData: SearchItem[] = localResponse.ok ? await localResponse.json() : []
      const broadData: SearchItem[] = broadResponse.ok ? await broadResponse.json() : []
      const data = [...localData, ...broadData]

      const results = (data || [])
        .map((item) => ({
          displayName: (() => {
            const addr = item.address || {}
            const isSubdivisionLike = (value: string) =>
              /\b(subdivision|homes?|villages?|heights?|plains?|residences?)\b/i.test(String(value || ''))
            const street = [addr.house_number, addr.road || addr.pedestrian || addr.path].filter(Boolean).join(' ')
            const barangay = addr.barangay || ''
            const subdivision = isSubdivisionLike(String(addr.village || '')) ? String(addr.village) : ''
            const area = addr.suburb || addr.neighbourhood || subdivision || ''
            const city = addr.city || addr.town || addr.municipality || ''
            const province = addr.province || ''
            const parts = [street, barangay, area, city, province].filter(Boolean)
            return parts.length > 0 ? parts.join(', ') : item.display_name
          })(),
          latitude: Number(item.lat),
          longitude: Number(item.lon),
        }))
        .filter(
          (item) =>
            Number.isFinite(item.latitude) &&
            Number.isFinite(item.longitude) &&
            isInServiceArea(item.latitude, item.longitude)
        )
        .filter((item, index, arr) => arr.findIndex((x) => x.latitude === item.latitude && x.longitude === item.longitude) === index)
        .slice(0, 10)

      setAddressSearchResults(results)
      if (results.length === 0) {
        toast.error(`No matching address found. ${SERVICE_AREA_MESSAGE}`)
      }
    } catch {
      toast.error('Failed to search address')
      setAddressSearchResults([])
    } finally {
      setIsSearchingAddress(false)
    }
  }

  return {
    composedShippingAddress,
    handleOutsideServiceArea,
    handlePinnedLocation,
    loadCustomerProfile,
    resetProfileForm,
    saveAddressToProfile,
    searchAddressInNegrosOccidental,
    useCurrentLocation,
  }
}
