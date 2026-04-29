'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function formatRoleLabel(role: string | null | undefined) {
  const value = String(role || '').trim().toUpperCase()
  if (!value) return 'Unknown'
  if (value === 'SUPER_ADMIN') return 'Admin'
  return value
    .split('_')
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ')
}

export function UsersView() {
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isVerificationSending, setIsVerificationSending] = useState(false)
  const [isVerificationConfirming, setIsVerificationConfirming] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [emailVerificationRequested, setEmailVerificationRequested] = useState(false)
  const [emailVerificationCode, setEmailVerificationCode] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [emailVerificationToken, setEmailVerificationToken] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    roleId: '',
    password: '',
    confirmPassword: '',
    isActive: true,
  })

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const [usersResponse, rolesResponse] = await Promise.all([fetch('/api/users?pageSize=200'), fetch('/api/roles')])
      if (usersResponse.ok) {
        const data = await usersResponse.json()
        const rows = toArray<any>(data?.data ?? data?.users ?? data).map((row) => ({
          ...row,
          roleId: String(row?.roleId || row?.role?.id || ''),
        }))
        setUsers(rows)
      }
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        setRoles(toArray(rolesData?.data ?? rolesData?.roles ?? rolesData))
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
    setForm({
      name: '',
      email: '',
      phone: '',
      roleId: '',
      password: '',
      confirmPassword: '',
      isActive: true,
    })
    setEmailVerificationRequested(false)
    setEmailVerificationCode('')
    setEmailVerified(false)
    setEmailVerificationToken('')
    setShowPassword(false)
    setEditingUser(null)
  }

  const openEdit = (user: any) => {
    const resolvedRoleId = String(user?.roleId || user?.role?.id || '')
    setEditingUser(user)
    setForm({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      roleId: resolvedRoleId,
      password: '',
      confirmPassword: '',
      isActive: !!user.isActive,
    })
    setEditOpen(true)
  }

  const saveUser = async (mode: 'create' | 'edit') => {
    if (!form.name.trim() || !form.email.trim() || !form.roleId) {
      toast.error('Name, email and role are required')
      return
    }
    if (mode === 'create' && !form.password) {
      toast.error('Password is required for new user')
      return
    }
    if (mode === 'create') {
      const passwordError = validatePasswordPolicy(form.password)
      if (passwordError) {
        toast.error(passwordError)
        return
      }
    }
    if (mode === 'create' && form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }
    if (mode === 'create' && !emailVerified) {
      toast.error('Verify the Gmail address before creating the user')
      return
    }

    if (mode === 'edit' && !form.isActive) {
      setDeleteConfirmOpen(true)
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = mode === 'create' ? '/api/users' : `/api/users/${editingUser.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
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
      toast.success(mode === 'create' ? 'User added' : 'User updated')
      setAddOpen(false)
      setEditOpen(false)
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
    if (!email.endsWith('@gmail.com') || email.split('@').length !== 2) {
      toast.error('Enter a full Gmail address, like name@gmail.com')
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
      setEmailVerificationRequested(true)
      setEmailVerificationCode('')
      setEmailVerified(false)
      setEmailVerificationToken('')
      toast.success('Verification code sent to the Gmail address')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send verification code')
    } finally {
      setIsVerificationSending(false)
    }
  }

  const confirmEmailVerification = async () => {
    const email = form.email.trim().toLowerCase()
    if (!emailVerificationCode.trim()) {
      toast.error('Enter the verification code first')
      return
    }
    setIsVerificationConfirming(true)
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accountType: 'staff', otp: emailVerificationCode.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify email')
      }
      setEmailVerificationToken(String(payload?.verificationToken || '').trim())
      setEmailVerified(true)
      toast.success('Email verified successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify email')
    } finally {
      setIsVerificationConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500">Manage staff accounts and permissions</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          {/* <Users className="h-4 w-4" /> */}
          Add User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12">
              {/* <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" /> */}
              <p className="text-gray-500">No users found</p>
              <Button className="mt-4">Add First User</Button>
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
                              {user.name?.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{user.name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-gray-500">{user.email}</td>
                      <td className="p-4">
                        <Badge variant="outline">{formatRoleLabel(user.role?.name)}</Badge>
                      </td>
                      <td className="p-4">
                        <Badge variant={user.isActive ? 'default' : 'secondary'}>
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

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>Create a new staff account.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => {
                    const nextEmail = e.target.value
                    setForm((f) => ({ ...f, email: nextEmail }))
                    setEmailVerificationRequested(false)
                    setEmailVerificationCode('')
                    setEmailVerified(false)
                    setEmailVerificationToken('')
                  }}
                />
                <Button type="button" variant="outline" onClick={requestEmailVerification} disabled={isVerificationSending}>
                  {isVerificationSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Send Code
                </Button>
              </div>
              <div className="text-xs text-gray-500">
                {emailVerified ? 'Gmail address verified.' : 'Send a code to the Gmail address, then enter it below.'}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                title="User Role"
                value={form.roleId}
                onChange={(e) => {
                  setForm((f) => ({ ...f, roleId: e.target.value }))
                  setEmailVerificationRequested(false)
                  setEmailVerificationCode('')
                  setEmailVerified(false)
                  setEmailVerificationToken('')
                }}
              >
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500">{PASSWORD_POLICY_MESSAGE}</p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Confirm Password</label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                placeholder="Confirm Password"
              />
              {form.confirmPassword && form.password !== form.confirmPassword ? (
                <p className="text-sm text-red-600">Passwords do not match</p>
              ) : null}
            </div>
            {emailVerificationRequested && !emailVerified ? (
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Verification Code</label>
                <div className="flex gap-2">
                  <Input
                    value={emailVerificationCode}
                    onChange={(e) => setEmailVerificationCode(e.target.value)}
                    placeholder="Enter the code sent to the Gmail address"
                  />
                  <Button type="button" onClick={confirmEmailVerification} disabled={isVerificationConfirming || !emailVerificationCode.trim()}>
                    {isVerificationConfirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Confirm
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveUser('create')} disabled={isSubmitting || !emailVerified}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !open && setEditOpen(false)}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update account profile, role and status.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Role</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="User Role" value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="User Status" value={form.isActive ? 'ACTIVE' : 'DELETE'} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'ACTIVE' }))}>
                <option value="ACTIVE">Active</option>
                <option value="DELETE">Delete User</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveUser('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {form.isActive ? 'Save Changes' : 'Delete User'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
