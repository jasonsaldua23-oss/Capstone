import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import { useNativeBack } from '@/hooks/use-native-back'
import { toast } from 'sonner'
import { validatePersonName } from '@/lib/person-name'
import { updateCustomerProfile, uploadCustomerAvatar } from './profile-api'
import { extractCustomerPayload } from '../shared/customer-common'
import { isValidPhilippinePhone } from '@/lib/philippine-phone'
import type { Dispatch, SetStateAction } from 'react'
import type { CustomerPortalState } from '../layout/portal-state'
import type { AuthUser } from '@/types'

/**
 * Profile editing for the customer: saving name and contact details, and the avatar upload with its crop/zoom interaction.
 */
export type CustomerProfileAvatarInputs = {
  activeView: CustomerPortalState['activeView']
  avatarCropSource: CustomerPortalState['avatarCropSource']
  avatarCropX: CustomerPortalState['avatarCropX']
  avatarCropY: CustomerPortalState['avatarCropY']
  avatarCropZoom: CustomerPortalState['avatarCropZoom']
  backAddressView: string
  backView: string
  cropDragRef: CustomerPortalState['cropDragRef']
  customerId: string
  loadCustomerProfile: (silent?: boolean) => Promise<void>
  profileAvatar: CustomerPortalState['profileAvatar']
  profileAvatarFile: CustomerPortalState['profileAvatarFile']
  profileEmail: CustomerPortalState['profileEmail']
  profileFirstName: CustomerPortalState['profileFirstName']
  profileLastName: CustomerPortalState['profileLastName']
  profileMiddleName: CustomerPortalState['profileMiddleName']
  profileNoMiddleName: CustomerPortalState['profileNoMiddleName']
  profilePhone: CustomerPortalState['profilePhone']
  profileSuffix: CustomerPortalState['profileSuffix']
  setActiveView: CustomerPortalState['setActiveView']
  setAvatarCropFile: CustomerPortalState['setAvatarCropFile']
  setAvatarCropSource: CustomerPortalState['setAvatarCropSource']
  setAvatarCropX: CustomerPortalState['setAvatarCropX']
  setAvatarCropY: CustomerPortalState['setAvatarCropY']
  setAvatarCropZoom: CustomerPortalState['setAvatarCropZoom']
  setIsAvatarCropDialogOpen: CustomerPortalState['setIsAvatarCropDialogOpen']
  setIsDraggingCrop: CustomerPortalState['setIsDraggingCrop']
  setIsSavingProfile: CustomerPortalState['setIsSavingProfile']
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
  setSelectedOrder: CustomerPortalState['setSelectedOrder']
  setShippingName: CustomerPortalState['setShippingName']
  setShippingPhone: CustomerPortalState['setShippingPhone']
  setUser: Dispatch<SetStateAction<AuthUser | null>>
  user: AuthUser | null
}

export function useCustomerProfileAvatar(inputs: CustomerProfileAvatarInputs) {
  const {
    activeView,
    avatarCropSource,
    avatarCropX,
    avatarCropY,
    avatarCropZoom,
    backAddressView,
    backView,
    cropDragRef,
    customerId,
    loadCustomerProfile,
    profileAvatar,
    profileAvatarFile,
    profileEmail,
    profileFirstName,
    profileLastName,
    profileMiddleName,
    profileNoMiddleName,
    profilePhone,
    profileSuffix,
    setActiveView,
    setAvatarCropFile,
    setAvatarCropSource,
    setAvatarCropX,
    setAvatarCropY,
    setAvatarCropZoom,
    setIsAvatarCropDialogOpen,
    setIsDraggingCrop,
    setIsSavingProfile,
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
    setSelectedOrder,
    setShippingName,
    setShippingPhone,
    setUser,
    user,
  } = inputs

  const avatarPreviewUrl = useMemo(() => {
    if (profileAvatarFile) return URL.createObjectURL(profileAvatarFile)
    return profileAvatar
  }, [profileAvatar, profileAvatarFile])

  useEffect(() => {
    if (!profileAvatarFile) return
    return () => {
      if (avatarPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl)
      }
    }
  }, [avatarPreviewUrl, profileAvatarFile])

  const uploadProfileAvatar = async (file: File) => {
    const { response, payload } = await uploadCustomerAvatar(file)
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload profile photo')
    }
    return String(payload.imageUrl)
  }

  const saveProfile = async () => {
    if (!customerId) {
      toast.error('Unable to save profile right now')
      return false
    }
    // Fix: the middle name is optional, so an empty one never blocks a save.
    if (!profileFirstName.trim() || !profileLastName.trim()) {
      toast.error('First name and last name are required.')
      return false
    }
    const nameError = validatePersonName(profileFirstName, profileMiddleName, profileLastName, profileSuffix)
    if (nameError) {
      // Fix: customer profile names cannot contain numeric characters.
      toast.error(nameError)
      return false
    }
    if (!profileEmail.trim()) {
      toast.error('Email is required')
      return false
    }
    // Fix: PUT /api/customers/:id (and the mobile app) accept a profile with no phone --
    // Google sign-ups start without one -- so only a number that was typed is checked.
    // Checkout and the address page still require a phone for delivery.
    const normalizedProfilePhone = String(profilePhone || '').replace(/\D/g, '')
    if (normalizedProfilePhone && !isValidPhilippinePhone(normalizedProfilePhone)) {
      toast.error('Please enter a valid Philippine mobile number before saving')
      return false
    }

    setIsSavingProfile(true)
    try {
      let avatarToSave = profileAvatar
      if (profileAvatarFile) {
        avatarToSave = await uploadProfileAvatar(profileAvatarFile)
      }
      const { response, payload } = await updateCustomerProfile(customerId, {
        firstName: profileFirstName.trim(),
        middleName: (profileNoMiddleName ? '' : profileMiddleName.trim()) || null,
        lastName: profileLastName.trim(),
        suffix: profileSuffix.trim(),
        email: profileEmail.trim(),
        phone: normalizedProfilePhone || null,
        avatar: avatarToSave,
      })
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      const updatedCustomer = extractCustomerPayload(payload)
      if (updatedCustomer) {
        setProfileName(String(updatedCustomer.name || '').trim())
        setProfileFirstName(String(updatedCustomer.firstName || '').trim())
        setProfileMiddleName(String(updatedCustomer.middleName || '').trim())
        setProfileNoMiddleName(!String(updatedCustomer.middleName || '').trim())
        setProfileLastName(String(updatedCustomer.lastName || '').trim())
        setProfileSuffix(String(updatedCustomer.suffix || '').trim())
        setProfileEmail(String(updatedCustomer.email || '').trim())
        setProfilePhone(String(updatedCustomer.phone || '').trim())
        setProfileAvatar(updatedCustomer.avatar ? String(updatedCustomer.avatar) : null)
        setProfileAvatarFile(null)
        if (updatedCustomer.phone !== undefined) {
          setShippingPhone(String(updatedCustomer.phone || '').trim())
        }
        if (updatedCustomer.name) {
          setShippingName(String(updatedCustomer.name).trim())
        }
        if (user) {
          setUser({
            ...(user as any),
            name: String(updatedCustomer.name || [profileFirstName, profileMiddleName, profileLastName, profileSuffix].filter(Boolean).join(' ')).trim(),
            firstName: String(updatedCustomer.firstName || profileFirstName).trim(),
            middleName: String(updatedCustomer.middleName || profileMiddleName).trim(),
            lastName: String(updatedCustomer.lastName || profileLastName).trim(),
            suffix: String(updatedCustomer.suffix || profileSuffix).trim(),
            email: String(updatedCustomer.email || profileEmail).trim(),
            avatar: updatedCustomer.avatar ? String(updatedCustomer.avatar) : null,
          })
        }
      }

      await loadCustomerProfile()
      toast.success('Profile updated successfully')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
      return false
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleAvatarUpload = async (file: File | null) => {
    if (!file) return
    if (!customerId) {
      toast.error('Unable to upload photo right now')
      return
    }

    setIsSavingProfile(true)
    try {
      const avatarUrl = await uploadProfileAvatar(file)
      const { response, payload } = await updateCustomerProfile(customerId, { avatar: avatarUrl })
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile photo')
      }

      setProfileAvatar(avatarUrl)
      if (user) {
        setUser({
          ...(user as any),
          avatar: avatarUrl,
        })
      }
      await loadCustomerProfile()
      toast.success('Profile photo updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile photo')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const openAvatarCropDialog = async (file: File | null) => {
    if (!file) return
    try {
      const objectUrl = URL.createObjectURL(file)
      setAvatarCropFile(file)
      setAvatarCropSource(objectUrl)
      setAvatarCropZoom(1)
      setAvatarCropX(0)
      setAvatarCropY(0)
      setIsAvatarCropDialogOpen(true)
    } catch {
      toast.error('Failed to open image cropper')
    }
  }

  const createCroppedAvatarFile = async (): Promise<File | null> => {
    if (!avatarCropSource) return null

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = avatarCropSource
    })

    const outputSize = 512
    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof (ctx as any).clearRect !== 'function' || typeof (ctx as any).drawImage !== 'function') {
      toast.error('Image editor is unavailable on this device. Please try another photo.')
      return null
    }

    const baseScale = Math.max(outputSize / image.width, outputSize / image.height)
    const scale = baseScale * avatarCropZoom
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const x = (outputSize - drawWidth) / 2 + avatarCropX
    const y = (outputSize - drawHeight) / 2 + avatarCropY

    try {
      ctx.clearRect(0, 0, outputSize, outputSize)
      ctx.drawImage(image, x, y, drawWidth, drawHeight)
    } catch {
      toast.error('Failed to process the selected image.')
      return null
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.92)
    })
    if (!blob) return null
    return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
  }

  const clampCropOffset = (value: number) => Math.max(-160, Math.min(160, value))

  const handleCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!avatarCropSource) return
    cropDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      initialX: avatarCropX,
      initialY: avatarCropY,
    }
    setIsDraggingCrop(true)
  }

  const handleCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropDragRef.current.active) return
    const dx = event.clientX - cropDragRef.current.startX
    const dy = event.clientY - cropDragRef.current.startY
    setAvatarCropX(clampCropOffset(cropDragRef.current.initialX + dx))
    setAvatarCropY(clampCropOffset(cropDragRef.current.initialY + dy))
  }

  const handleCropPointerUp = () => {
    if (!cropDragRef.current.active) return
    cropDragRef.current.active = false
    setIsDraggingCrop(false)
  }

  // Fix: mirror in-app Back destinations without losing the cart or selected order.
  useNativeBack(() => {
    if (activeView === 'checkout') { setActiveView('cart'); return true }
    if (activeView === 'order-detail') { setSelectedOrder(null); setActiveView(backView); return true }
    if (activeView === 'edit-address') { setActiveView(backAddressView); return true }
    if (activeView === 'purchase-request-detail') { setSelectedOrder(null); setActiveView('purchase-requests'); return true }
    if (activeView === 'track') { setActiveView('orders'); return true }
    if (activeView !== 'home') { setActiveView('home'); return true }
    return false
  })

  return {
    avatarPreviewUrl,
    createCroppedAvatarFile,
    handleAvatarUpload,
    handleCropPointerDown,
    handleCropPointerMove,
    handleCropPointerUp,
    openAvatarCropDialog,
    saveProfile,
  }
}
