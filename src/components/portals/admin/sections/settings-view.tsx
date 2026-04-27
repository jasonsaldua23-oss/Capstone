'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PASSWORD_POLICY_MESSAGE, validatePasswordPolicy } from '@/lib/password-policy'

function formatRoleLabel(role: string | null | undefined) {
  if (!role) return 'Unknown'
  return role
    .split('_')
    .map((segment) => segment.charAt(0) + segment.slice(1).toLowerCase())
    .join(' ')
}

export function SettingsView() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)

  const userId = (user as any)?.userId || (user as any)?.id

  const handleProfileSave = async () => {
    if (!userId) {
      toast.error('Unable to resolve user ID')
      return
    }

    setIsSavingProfile(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to save profile')
      }
      toast.success('Profile updated successfully')
    } catch (error) {
      console.error('Profile update failed:', error)
      toast.error('Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handlePasswordUpdate = async () => {
    if (!userId) {
      toast.error('Unable to resolve user ID')
      return
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Fill all password fields')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match')
      return
    }
    const passwordError = validatePasswordPolicy(newPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }

    setIsUpdatingPassword(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const data = await response.json()
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to update password')
      }
      toast.success('Password updated successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error('Password update failed:', error)
      toast.error('Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name</label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button onClick={handleProfileSave} disabled={isSavingProfile}>
                {isSavingProfile ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Change your password</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="current-password" className="text-sm font-medium text-gray-700">Current Password</label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="new-password" className="text-sm font-medium text-gray-700">New Password</label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-gray-500">{PASSWORD_POLICY_MESSAGE}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">Confirm Password</label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button onClick={handlePasswordUpdate} disabled={isUpdatingPassword}>
                {isUpdatingPassword ? 'Updating...' : 'Update Password'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Role</p>
                  <p className="font-medium">{formatRoleLabel(user?.role)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Account Type</p>
                  <p className="font-medium capitalize">{user?.type}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">User ID</p>
                  <p className="font-medium font-mono text-sm">{user?.id}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Email Notifications</span>
                  <span className="text-xs text-gray-500">Configured by system admin</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Two-Factor Auth</span>
                  <span className="text-xs text-gray-500">Not enabled</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
