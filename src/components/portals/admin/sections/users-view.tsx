'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
  Mail,
  MailCheck,
  ChevronDown,
} from 'lucide-react'

import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
import { OtpVerificationModal } from '@/components/shared/otp-verification-modal'

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function formatRoleLabel(role: string | null | undefined) {
  const value = String(role || '').trim().toUpperCase()
  if (!value) return 'Unknown'
  if (value === 'SUPER_ADMIN') return 'Owner'
  return value
    .split('_')
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ')
}

function resolveRoleCode(value: any): string {
  return String(value?.roleId || value?.role?.id || value?.role?.name || value?.role || '').trim().toUpperCase()
}

interface FormState {
  lastName: string
  firstName: string
  middleName: string
  suffix: string
  email: string
  phone: string
  roleId: string
  password: string
  confirmPassword: string
  isActive: boolean
}

const initialFormState: FormState = {
  lastName: '',
  firstName: '',
  middleName: '',
  suffix: '',
  email: '',
  phone: '',
  roleId: '',
  password: '',
  confirmPassword: '',
  isActive: true,
}

function isFormEmpty(form: FormState): boolean {
  return !form.lastName && !form.firstName && !form.middleName && !form.suffix &&
    !form.email && !form.phone && !form.roleId && !form.password && !form.confirmPassword
}

export function UsersView() {
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerificationSending, setIsVerificationSending] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [emailVerified, setEmailVerified] = useState(false)
  const [emailVerificationToken, setEmailVerificationToken] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otpModalOpen, setOtpModalOpen] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<FormState>({ ...initialFormState })

  const hasPassword = form.password.length > 0
  const passwordRequirements = [
    { id: 'length', label: 'At least 8 characters', met: form.password.length >= 8 },
    { id: 'upper', label: 'At least 1 uppercase letter', met: hasPassword && /[A-Z]/.test(form.password) },
    { id: 'lower', label: 'At least 1 lowercase letter', met: hasPassword && /[a-z]/.test(form.password) },
    { id: 'number', label: 'At least 1 number', met: hasPassword && /\d/.test(form.password) },
    { id: 'special', label: 'At least 1 special character', met: hasPassword && /[^A-Za-z0-9\s]/.test(form.password) },
    { id: 'no-spaces', label: 'No spaces', met: hasPassword && !/\s/.test(form.password) },
  ]
  const passwordPolicySatisfied = passwordRequirements.every((rule) => rule.met)
  const passwordsMatch = form.password !== '' && form.password === form.confirmPassword

  const isValidEmail = useCallback((email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  }, [])

  const isValidPhone = useCallback((phone: string): boolean => {
    if (!phone) return false
    return isValidPhilippinePhone(phone)
  }, [])

  const canSendCode = useMemo(() => {
    return form.email.trim() !== '' && isValidEmail(form.email.trim())
  }, [form.email, isValidEmail])

  const canSave = useMemo(() => {
    return (
      form.lastName.trim() !== '' &&
      form.firstName.trim() !== '' &&
      isValidEmail(form.email.trim()) &&
      emailVerified &&
      isValidPhone(form.phone) &&
      form.roleId !== '' &&
      passwordPolicySatisfied &&
      passwordsMatch
    )
  }, [form, emailVerified, isValidEmail, isValidPhone, passwordPolicySatisfied, passwordsMatch])

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const [usersResponse, rolesResponse] = await Promise.all([fetch('/api/users?pageSize=200'), fetch('/api/roles')])
      if (usersResponse.ok) {
        const data = await usersResponse.json()
        const rows = toArray<any>(data?.data ?? data?.users ?? data)
          .map((row) => ({
            ...row,
            roleId: resolveRoleCode(row),
          }))
          .filter((row) => {
            const roleCode = String(row?.roleId || '').trim().toUpperCase()
            return roleCode !== 'SUPER_ADMIN' && roleCode !== 'ADMIN'
          })
        setUsers(rows)
      }
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        const rawRoles = toArray<any>(rolesData?.data ?? rolesData?.roles ?? rolesData)
        const seen = new Set<string>()
        const filtered = rawRoles.filter((role) => {
          const roleCode = String(role?.id || role?.name || '').trim().toUpperCase()
          if (!roleCode || roleCode === 'CUSTOMER' || roleCode === 'SUPER_ADMIN' || roleCode === 'ADMIN') return false
          const labelKey = formatRoleLabel(roleCode).toUpperCase()
          if (seen.has(labelKey)) return false
          seen.add(labelKey)
          return true
        })
        setRoles(filtered)
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const resetForm = () => {
    setForm({ ...initialFormState })
    setEmailVerified(false)
    setEmailVerificationToken('')
    setShowPassword(false)
    setEditingUser(null)
    setFormErrors({})
    setTouched({})
  }

  const openEdit = (user: any) => {
    const resolvedRoleId = resolveRoleCode(user)
    setEditingUser(user)
    setForm({
      lastName: user.lastName || user.name?.split(' ').slice(-1)[0] || '',
      firstName: user.firstName || user.name?.split(' ')[0] || '',
      middleName: user.middleName || '',
      suffix: user.suffix || '',
      email: user.email || '',
      phone: user.phone || '',
      roleId: resolvedRoleId,
      password: '',
      confirmPassword: '',
      isActive: !!user.isActive,
    })
    setFormErrors({})
    setTouched({})
    setEditOpen(true)
  }

  const validateField = (field: string, value: string): string => {
    switch (field) {
      case 'lastName':
        return !value.trim() ? 'This field is required.' : ''
      case 'firstName':
        return !value.trim() ? 'This field is required.' : ''
      case 'email': {
        if (!value.trim()) return 'This field is required.'
        if (!isValidEmail(value.trim())) return 'Please enter a valid email address.'
        return ''
      }
      case 'phone': {
        if (!value) return 'This field is required.'
        if (!isValidPhilippinePhone(value)) return 'Please enter a valid phone number.'
        return ''
      }
      case 'roleId':
        return !value ? 'Please select a role.' : ''
      default:
        return ''
    }
  }

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    const error = validateField(field, form[field as keyof FormState] as string)
    setFormErrors((prev) => ({ ...prev, [field]: error }))
  }

  const updateField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // Clear errors on change
    if (formErrors[field]) {
      setFormErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  const saveUser = async (mode: 'create' | 'edit') => {
    if (mode === 'create' && !canSave) {
      toast.error('Please complete all required fields.')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = mode === 'create' ? '/api/users' : `/api/users/${editingUser.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'

      const fullName = [form.firstName.trim(), form.middleName.trim(), form.lastName.trim()]
        .filter(Boolean)
        .join(' ') + (form.suffix.trim() ? `, ${form.suffix.trim()}` : '')

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName || form.firstName.trim() + ' ' + form.lastName.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          middleName: form.middleName.trim() || null,
          suffix: form.suffix.trim() || null,
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          roleId: form.roleId,
          emailVerificationToken: mode === 'create' ? emailVerificationToken : undefined,
          password: form.password || undefined,
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save user')
      }
      toast.success(mode === 'create' ? 'User account created successfully.' : 'User updated')
      setAddOpen(false)
      setEditOpen(false)
      setSaveConfirmOpen(false)
      resetForm()
      await fetchUsers()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save user')
    } finally {
      setIsSubmitting(false)
    }
  }

  const confirmDeleteUser = async () => {
    if (!editingUser?.id) return
    setIsSubmitting(true)
    try {
      const deleteResponse = await fetch(`/api/users/${editingUser.id}`, {
        method: 'DELETE',
      })
      const deletePayload = await deleteResponse.json().catch(() => ({}))
      if (!deleteResponse.ok || deletePayload?.success === false) {
        throw new Error(deletePayload?.error || 'Failed to delete user')
      }
      toast.success('User deleted')
      setDeleteConfirmOpen(false)
      setEditOpen(false)
      resetForm()
      await fetchUsers()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete user')
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestEmailVerification = async () => {
    const email = form.email.trim().toLowerCase()
    if (!email) {
      toast.error('Enter an email address first')
      return
    }
    if (!isValidEmail(email)) {
      toast.error('Please enter a valid email address.')
      return
    }
    if (!form.roleId) {
      toast.error('Select a role first')
      return
    }

    setIsVerificationSending(true)
    try {
      const response = await fetch('/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff', roleId: form.roleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send verification code')
      }
      setOtpModalOpen(true)
      toast.success('Verification code sent to your email')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send verification code')
    } finally {
      setIsVerificationSending(false)
    }
  }

  const handleVerifyOtp = async (otp: string): Promise<boolean> => {
    const email = form.email.trim().toLowerCase()
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff', otp }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        return false
      }
      setEmailVerificationToken(String(payload?.verificationToken || '').trim())
      setEmailVerified(true)
      toast.success('Email verified successfully')
      return true
    } catch {
      return false
    }
  }

  const handleResendOtp = async (): Promise<boolean> => {
    const email = form.email.trim().toLowerCase()
    try {
      const response = await fetch('/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff', roleId: form.roleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        return false
      }
      return true
    } catch {
      return false
    }
  }

  const handleAddOpenChange = (open: boolean) => {
    if (!open && !isFormEmpty(form)) {
      setPendingCloseAction(() => () => {
        setAddOpen(false)
        resetForm()
      })
      setDiscardConfirmOpen(true)
    } else if (!open) {
      setAddOpen(false)
      resetForm()
    }
  }

  const handleDiscardConfirm = () => {
    pendingCloseAction?.()
    setDiscardConfirmOpen(false)
    setPendingCloseAction(null)
  }

  const handleCancelSave = () => {
    if (!isFormEmpty(form)) {
      setPendingCloseAction(() => () => {
        setAddOpen(false)
        resetForm()
      })
      setDiscardConfirmOpen(true)
    } else {
      setAddOpen(false)
      resetForm()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500">Manage staff accounts and permissions</p>
        </div>
        <Button className="gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={() => setAddOpen(true)}>
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <PortalTableSkeleton rows={6} columns={6} className="border-0 shadow-none" />
          ) : users.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">User</th>
                    <th className="text-left p-4 font-medium text-gray-600">Email</th>
                    <th className="text-left p-4 font-medium text-gray-600">Role</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-blue-600 text-white text-sm">
                              {(user.firstName || user.name || '?').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim()}</span>
                        </div>
                      </td>
                      <td className="p-4 text-gray-500">{user.email}</td>
                      <td className="p-4">
                        <Badge variant="outline">{formatRoleLabel(resolveRoleCode(user))}</Badge>
                      </td>
                      <td className="p-4">
                        <Badge className={user.isActive ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-red-100 text-red-700 hover:bg-red-100'}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <Button variant="outline" size="sm" onClick={() => openEdit(user)}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add User Modal */}
      <Dialog open={addOpen} onOpenChange={handleAddOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-md w-full p-3 pt-4">
          <DialogHeader className="pb-0">
            <DialogTitle className="text-base font-semibold text-gray-900">Add User</DialogTitle>
            <DialogDescription className="text-[11px] text-gray-500">Create a new staff account.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Last Name */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">
                Last Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Last Name"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
                onBlur={() => handleBlur('lastName')}
                className={`h-8 text-sm ${touched.lastName && formErrors.lastName ? 'border-red-400 ring-red-200' : ''}`}
              />
              {touched.lastName && formErrors.lastName && (
                <p className="text-[10px] text-red-500">{formErrors.lastName}</p>
              )}
            </div>

            {/* First Name */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">
                First Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="First Name"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
                onBlur={() => handleBlur('firstName')}
                className={`h-8 text-sm ${touched.firstName && formErrors.firstName ? 'border-red-400 ring-red-200' : ''}`}
              />
              {touched.firstName && formErrors.firstName && (
                <p className="text-[10px] text-red-500">{formErrors.firstName}</p>
              )}
            </div>

            {/* Middle Name */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Middle Name</label>
              <Input
                placeholder="Middle Name"
                value={form.middleName}
                onChange={(e) => updateField('middleName', e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            {/* Suffix */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Suffix</label>
              <Input
                placeholder="Jr., Sr., III"
                value={form.suffix}
                onChange={(e) => updateField('suffix', e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            {/* Email */}
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-medium text-gray-700">
                Email <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-row items-center gap-1.5">
                <div className="flex-1 relative">
                  <Input
                    type="email"
                    autoComplete="off"
                    placeholder="email@example.com"
                    value={form.email}
                    onChange={(e) => {
                      updateField('email', e.target.value)
                      if (emailVerified) {
                        setEmailVerified(false)
                        setEmailVerificationToken('')
                      }
                    }}
                    onBlur={() => handleBlur('email')}
                    className={`h-8 text-sm w-full pr-8 ${touched.email && formErrors.email ? 'border-red-400 ring-red-200' : ''} ${emailVerified ? 'border-green-400 ring-green-200' : ''}`}
                  />
                  {emailVerified ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                      <MailCheck className="h-4 w-4 text-green-500" />
                    </div>
                  ) : (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                      <Mail className="h-4 w-4 text-gray-400" />
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestEmailVerification}
                  disabled={!canSendCode || isVerificationSending || emailVerified}
                  className="h-8 text-xs whitespace-nowrap px-3 shrink-0"
                >
                  {isVerificationSending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : emailVerified ? (
                    <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                  ) : null}
                  {emailVerified ? 'Verified' : 'Send Code'}
                </Button>
              </div>
              {touched.email && formErrors.email && (
                <p className="text-[10px] text-red-500">{formErrors.email}</p>
              )}
              {emailVerified && (
                <div className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  Email verified
                </div>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">
                Phone <span className="text-red-500">*</span>
              </label>
              <Input
                autoComplete="off"
                placeholder="09XX XXX XXXX"
                maxLength={13}
                value={form.phone}
                onChange={(e) => updateField('phone', formatPhilippinePhoneInput(e.target.value))}
                onBlur={() => handleBlur('phone')}
                className={`h-8 text-sm ${touched.phone && formErrors.phone ? 'border-red-400 ring-red-200' : ''}`}
              />
              {touched.phone && formErrors.phone && (
                <p className="text-[10px] text-red-500">{formErrors.phone}</p>
              )}
            </div>

            {/* Role */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">
                Role <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  className={`w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs appearance-none cursor-pointer
                    ${touched.roleId && formErrors.roleId ? 'border-red-400 ring-red-200' : 'border-gray-300'}
                    focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 transition-all`}
                  title="User Role"
                  value={form.roleId}
                  onChange={(e) => {
                    updateField('roleId', e.target.value)
                    if (emailVerified) {
                      setEmailVerified(false)
                      setEmailVerificationToken('')
                    }
                  }}
                  onBlur={() => handleBlur('roleId')}
                >
                  <option value="">Select role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                </div>
              </div>
              {touched.roleId && formErrors.roleId && (
                <p className="text-[10px] text-red-500">{formErrors.roleId}</p>
              )}
            </div>

            {/* Password */}
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-medium text-gray-700">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  className="h-8 pr-9 w-full text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                {passwordRequirements.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-1.5 text-[10px]">
                    {rule.met ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                    )}
                    <span className={rule.met ? 'text-emerald-600' : 'text-gray-500'}>{rule.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Confirm Password */}
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-medium text-gray-700">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={form.confirmPassword}
                onChange={(e) => updateField('confirmPassword', e.target.value)}
                className={`h-8 w-full text-sm ${form.confirmPassword && form.password !== form.confirmPassword ? 'border-red-400 ring-red-200' : ''}`}
              />
              {form.confirmPassword && form.password !== form.confirmPassword ? (
                <p className="text-[10px] text-red-500">Passwords do not match.</p>
              ) : form.confirmPassword && form.password === form.confirmPassword ? (
                <p className="text-[10px] text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Passwords match
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-row gap-2 pt-2 mt-1 border-t border-gray-100">
            <Button
              variant="outline"
              className="flex-1 h-8 text-sm order-2 sm:order-1"
              onClick={handleCancelSave}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 h-8 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed order-1 sm:order-2"
              onClick={() => setSaveConfirmOpen(true)}
              disabled={!canSave || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : null}
              Save User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Confirmation Modal */}
      <AlertDialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Account Creation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to create this staff account?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={isSubmitting}>Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                className="bg-blue-600 text-white hover:bg-blue-700"
                disabled={isSubmitting}
                onClick={(event) => {
                  event.preventDefault()
                  void saveUser('create')
                }}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Confirm
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard Changes Modal */}
      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Any information you entered will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" onClick={() => { setDiscardConfirmOpen(false); setPendingCloseAction(null); }}>
                Continue Editing
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={(event) => {
                  event.preventDefault()
                  handleDiscardConfirm()
                }}
              >
                Discard
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* OTP Verification Modal */}
      <OtpVerificationModal
        open={otpModalOpen}
        onOpenChange={setOtpModalOpen}
        email={form.email.trim().toLowerCase()}
        onVerify={handleVerifyOtp}
        onResendCode={handleResendOtp}
        onBack={() => {}}
      />

      {/* Edit User Modal */}
      <Dialog open={editOpen} onOpenChange={(open) => !open && setEditOpen(false)}>
        <DialogContent className="max-w-[90vw] sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-900">Edit User</DialogTitle>
            <DialogDescription className="text-gray-500">Update account profile, role and status.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Last Name</label>
              <Input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">First Name</label>
              <Input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Middle Name</label>
              <Input
                value={form.middleName}
                onChange={(e) => setForm((f) => ({ ...f, middleName: e.target.value }))}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Suffix</label>
              <Input
                placeholder="Jr., Sr., III"
                value={form.suffix}
                onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <Input
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input
                autoComplete="off"
                placeholder="09XX XXX XXXX"
                maxLength={13}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: formatPhilippinePhoneInput(e.target.value) }))}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select
                className="w-full h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm appearance-none cursor-pointer border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                title="User Role"
                value={form.roleId}
                onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
              >
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Status</label>
              <select
                className="w-full h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm appearance-none cursor-pointer border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                title="User Status"
                value={form.isActive ? 'ACTIVE' : 'INACTIVE'}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'ACTIVE' }))}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="flex-1 h-11 bg-blue-600 text-white hover:bg-blue-700" onClick={() => saveUser('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User Account?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete <span className="font-semibold">{editingUser?.name || 'this user'}</span> ({editingUser?.email || 'no email'}).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={isSubmitting}>Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={isSubmitting}
                onClick={(event) => {
                  event.preventDefault()
                  void confirmDeleteUser()
                }}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Delete User
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}