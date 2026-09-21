import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { validatePersonName } from '@/lib/person-name'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { isValidPhilippinePhone } from '@/lib/philippine-phone'
import { useAvatarCrop } from '@/hooks/use-avatar-crop'
import { formatFullName } from '../../warehouse-portal-utils'
import type { Dispatch, SetStateAction } from 'react'
import type { AuthUser } from '@/types'

/**
 * Profile, password and security-settings state for the warehouse portal, including the OTP verification steps that guard email and password changes.
 */
export type WarehouseProfileSettingsInputs = {
  setUser: Dispatch<SetStateAction<AuthUser | null>>
  user: AuthUser | null
}

export function useWarehouseProfileSettings(inputs: WarehouseProfileSettingsInputs) {
  const {
    setUser,
    user,
  } = inputs

  const [profileName, setProfileName] = useState('')
  const [profileFirstName, setProfileFirstName] = useState('')
  const [profileMiddleName, setProfileMiddleName] = useState('')
  const [profileNoMiddleName, setProfileNoMiddleName] = useState(false)
  const [profileLastName, setProfileLastName] = useState('')
  const [profileSuffix, setProfileSuffix] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null)
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const profileAvatarCrop = useAvatarCrop()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [otpModalKind, setOtpModalKind] = useState<'current-email' | 'profile' | 'password' | null>(null)
  const [profileOtp, setProfileOtp] = useState('')
  const [profileOtpSent, setProfileOtpSent] = useState(false)
  const [profileOtpVerified, setProfileOtpVerified] = useState(false)
  const [profileOtpToken, setProfileOtpToken] = useState('')
  const [oldEmailVerificationToken, setOldEmailVerificationToken] = useState('')
  const [isEmailChangeUnlocked, setIsEmailChangeUnlocked] = useState(false)
  const [isSendingProfileOtp, setIsSendingProfileOtp] = useState(false)
  const [isVerifyingProfileOtp, setIsVerifyingProfileOtp] = useState(false)
  const [passwordOtp, setPasswordOtp] = useState('')
  const [passwordOtpSent, setPasswordOtpSent] = useState(false)
  const [passwordOtpVerified, setPasswordOtpVerified] = useState(false)
  const [passwordOtpToken, setPasswordOtpToken] = useState('')
  const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false)
  const [isVerifyingPasswordOtp, setIsVerifyingPasswordOtp] = useState(false)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(true)
  const [isSavingSecuritySettings, setIsSavingSecuritySettings] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isEditingSecurity, setIsEditingSecurity] = useState(false)
  const hasNewPassword = newPassword.length > 0
  const passwordRequirements = [
    { id: 'length', label: 'At least 8 characters', met: newPassword.length >= 8 },
    { id: 'upper', label: 'At least 1 uppercase letter', met: hasNewPassword && /[A-Z]/.test(newPassword) },
    { id: 'lower', label: 'At least 1 lowercase letter', met: hasNewPassword && /[a-z]/.test(newPassword) },
    { id: 'number', label: 'At least 1 number', met: hasNewPassword && /\d/.test(newPassword) },
    { id: 'special', label: 'At least 1 special character', met: hasNewPassword && /[^A-Za-z0-9\s]/.test(newPassword) },
    { id: 'no-spaces', label: 'No spaces', met: hasNewPassword && !/\s/.test(newPassword) },
  ]

  useEffect(() => {
    setProfileName(String((user as any)?.name || ''))
    const nameParts = String((user as any)?.name || '').trim().split(/\s+/).filter(Boolean)
    setProfileFirstName(String((user as any)?.firstName || nameParts[0] || ''))
    setProfileMiddleName(String((user as any)?.middleName || ''))
    setProfileNoMiddleName(!(user as any)?.middleName)
    setProfileLastName(String((user as any)?.lastName || nameParts.slice(1).join(' ') || ''))
    setProfileSuffix(String((user as any)?.suffix || ''))
    setProfileEmail(String((user as any)?.email || ''))
    setProfilePhone(String((user as any)?.phone || ''))
    setProfileAvatarFile(null)
    setTwoFactorEnabled(Boolean((user as any)?.twoFactorEnabled ?? (user as any)?.two_factor_enabled))
    setLoginAlertsEnabled((user as any)?.loginAlertsEnabled ?? (user as any)?.login_alerts_enabled ?? true)
    setNewPassword('')
    setConfirmPassword('')
  }, [user])

  const accountEmail = String((user as any)?.email || '').trim().toLowerCase()
  const accountRoleId = String((user as any)?.role || '').trim().toUpperCase()
  const normalizedProfileEmail = profileEmail.trim().toLowerCase()
  const isProfileEmailChanged = normalizedProfileEmail !== accountEmail

  const requestOtp = async (targetEmail: string, kind: 'current-email' | 'profile' | 'password') => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    if (!emailToVerify) {
      toast.error('Email is required')
      return false
    }
    if (kind === 'profile' || kind === 'current-email') setIsSendingProfileOtp(true)
    else setIsSendingPasswordOtp(true)
    try {
      const endpoint = kind === 'password'
        ? '/api/auth/password-reset/request-otp'
        : kind === 'current-email'
          ? '/api/auth/email-verification/request-existing'
          : '/api/auth/email-verification/request'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, accountType: 'staff', portal: 'warehouse', roleId: accountRoleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      if (kind === 'profile') {
        setProfileOtpSent(true)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
        setProfileOtp('')
      } else if (kind === 'password') {
        setPasswordOtpSent(true)
        setPasswordOtpVerified(false)
        setPasswordOtpToken('')
        setPasswordOtp('')
      }
      setOtpModalKind(kind)
      toast.success('Verification OTP code sent to your email')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
      return false
    } finally {
      if (kind === 'profile' || kind === 'current-email') setIsSendingProfileOtp(false)
      else setIsSendingPasswordOtp(false)
    }
  }

  const verifyOtp = async (targetEmail: string, kind: 'current-email' | 'profile' | 'password', otpValue?: string) => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    const otp = (otpValue || (kind === 'profile' || kind === 'current-email' ? profileOtp : passwordOtp)).trim()
    if (!emailToVerify) {
      toast.error('Email is required')
      return false
    }
    if (!otp) {
      toast.error('Enter OTP first')
      return false
    }
    if (kind === 'profile' || kind === 'current-email') setIsVerifyingProfileOtp(true)
    else setIsVerifyingPasswordOtp(true)
    try {
      const endpoint = kind === 'password'
        ? '/api/auth/password-reset/verify-otp'
        : kind === 'current-email'
          ? '/api/auth/email-verification/confirm-existing'
          : '/api/auth/email-verification/confirm'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, accountType: 'staff', portal: 'warehouse', otp }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      if (kind === 'current-email') {
        const token = String(payload?.verificationToken || '').trim()
        if (!token) throw new Error('Missing verification token')
        // Added: keep the email read-only until the current address is confirmed.
        setOldEmailVerificationToken(token)
        setIsEmailChangeUnlocked(true)
      } else if (kind === 'profile') {
        const token = String(payload?.verificationToken || '').trim()
        if (!token) throw new Error('Missing verification token')
        setProfileOtpVerified(true)
        setProfileOtpToken(token)
      } else {
        setPasswordOtpVerified(true)
        setPasswordOtpToken(otp)
      }
      toast.success('OTP verified successfully')
      setOtpModalKind(null)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify OTP')
      return false
    } finally {
      if (kind === 'profile' || kind === 'current-email') setIsVerifyingProfileOtp(false)
      else setIsVerifyingPasswordOtp(false)
    }
  }

  const saveCroppedAvatar = async (file: File) => {
    const userId = String((user as any)?.userId || (user as any)?.id || '').trim()
    if (!userId) throw new Error('Unable to resolve account ID')
    setIsSavingProfile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadResponse = await fetch('/api/uploads/customer-avatar', { method: 'POST', body: formData })
      const uploadPayload = await uploadResponse.json().catch(() => ({}))
      if (!uploadResponse.ok || !uploadPayload?.imageUrl) throw new Error(uploadPayload?.error || 'Failed to upload avatar')
      const avatar = String(uploadPayload.imageUrl).trim()
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to save avatar')
      setUser((previous: any) => ({ ...(previous || {}), avatar }))
      setProfileAvatarFile(null)
      toast.success('Profile photo updated')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const saveProfileSettings = async () => {
    const userId = String((user as any)?.userId || (user as any)?.id || '').trim()
    if (!userId) {
      toast.error('Unable to resolve account ID')
      return
    }
    if (!profileFirstName.trim() || !profileLastName.trim() || (!profileNoMiddleName && !profileMiddleName.trim()) || !profileEmail.trim()) {
      toast.error('First name, last name, middle name, and email are required.')
      return
    }
    const nameError = validatePersonName(profileFirstName, profileMiddleName, profileLastName, profileSuffix)
    if (nameError) {
      // Fix: reject numeric warehouse-staff profile names before saving.
      toast.error(nameError)
      return
    }
    if (!isValidPhilippinePhone(profilePhone)) {
      toast.error('Please enter a valid Philippine mobile number')
      return
    }
    if (isProfileEmailChanged && (!isEmailChangeUnlocked || !oldEmailVerificationToken || !profileOtpVerified || !profileOtpToken)) {
      toast.error('Verify OTP for the new email before saving')
      return
    }

    setIsSavingProfile(true)
    try {
      let avatarToSave = String((user as any)?.avatar || '').trim() || null
      if (profileAvatarFile) {
        const formData = new FormData()
        formData.append('file', profileAvatarFile)
        const uploadResponse = await fetch('/api/uploads/customer-avatar', { method: 'POST', body: formData })
        const uploadPayload = await uploadResponse.json().catch(() => ({}))
        if (!uploadResponse.ok || !uploadPayload?.imageUrl) throw new Error(uploadPayload?.error || 'Failed to upload avatar')
        avatarToSave = String(uploadPayload.imageUrl).trim()
      }
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName),
          firstName: profileFirstName.trim(),
          middleName: profileNoMiddleName ? null : profileMiddleName.trim(),
          lastName: profileLastName.trim(),
          suffix: profileSuffix.trim() || null,
          email: profileEmail.trim(),
          phone: profilePhone.trim() || null,
          avatar: avatarToSave,
          emailVerificationToken: isProfileEmailChanged ? profileOtpToken : undefined,
          oldEmailVerificationToken: isProfileEmailChanged ? oldEmailVerificationToken : undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      const nextUser = payload?.user || {}
      setUser((prev: any) => ({
        ...(prev || {}),
        name: nextUser.name ?? formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName.trim()),
        firstName: nextUser.firstName ?? profileFirstName.trim(),
        middleName: nextUser.middleName ?? profileMiddleName.trim(),
        lastName: nextUser.lastName ?? profileLastName.trim(),
        suffix: nextUser.suffix ?? profileSuffix.trim(),
        email: nextUser.email ?? profileEmail.trim(),
        phone: nextUser.phone ?? (profilePhone.trim() || ''),
        avatar: nextUser.avatar ?? avatarToSave,
      }))
      setProfileAvatarFile(null)
      // Fix: saving always locks email again, including when only other profile fields changed.
      setIsEmailChangeUnlocked(false)
      setOldEmailVerificationToken('')
      if (isProfileEmailChanged) {
        setProfileOtpSent(false)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
        setProfileOtp('')
        setOldEmailVerificationToken('')
        setIsEmailChangeUnlocked(false)
      }
      // Added: return the successful profile save to its read-only Edit state.
      setIsEditingProfile(false)
      toast.success('Profile updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const updateProfilePassword = async () => {
    const accountEmailForReset = String((user as any)?.email || '').trim().toLowerCase()
    if (!accountEmailForReset) {
      toast.error('Unable to resolve account email')
      return
    }
    if (!newPassword.trim()) {
      toast.error('New password is required')
      return
    }
    if (!confirmPassword.trim()) {
      toast.error('Confirm your new password')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    const passwordError = validatePasswordPolicy(newPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }
    if (!passwordOtpVerified) {
      toast.error('Verify OTP before updating password')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const response = await fetch('/api/auth/password-reset/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accountEmailForReset,
          accountType: 'staff',
          portal: 'warehouse',
          otp: passwordOtpToken,
          newPassword,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update password')
      }
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOtp('')
      setPasswordOtpSent(false)
      setPasswordOtpVerified(false)
      setPasswordOtpToken('')
      toast.success('Password updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }
  const saveSecuritySettings = async () => {
    const userId = String((user as any)?.userId || (user as any)?.id || '').trim()
    if (!userId) {
      toast.error('Unable to resolve account ID')
      return
    }

    setIsSavingSecuritySettings(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twoFactorEnabled,
          loginAlertsEnabled,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update security settings')
      }

      const nextUser = payload?.user || {}
      setUser((prev: any) => ({
        ...(prev || {}),
        twoFactorEnabled: Boolean(nextUser.twoFactorEnabled ?? nextUser.two_factor_enabled ?? twoFactorEnabled),
        loginAlertsEnabled: Boolean(nextUser.loginAlertsEnabled ?? nextUser.login_alerts_enabled ?? loginAlertsEnabled),
      }))
      toast.success('Security settings updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update security settings')
    } finally {
      setIsSavingSecuritySettings(false)
    }
  }

  return {
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
    otpModalKind,
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
    saveCroppedAvatar,
    saveProfileSettings,
    saveSecuritySettings,
    setConfirmPassword,
    setIsEditingProfile,
    setIsEditingSecurity,
    setLoginAlertsEnabled,
    setNewPassword,
    setOtpModalKind,
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
    verifyOtp,
  }
}

/** Everything the hook manages, for the settings screen that renders it. */
export type WarehouseProfileSettings = ReturnType<typeof useWarehouseProfileSettings>
