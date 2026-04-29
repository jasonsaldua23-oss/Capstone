'use client'

import { useState, useEffect } from 'react'
import { getTabAuthToken } from '@/lib/client-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

async function fetchJsonWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryConfig: number | { retries?: number; timeoutMs?: number } = 5
) {
  const retries = typeof retryConfig === 'number' ? retryConfig : (retryConfig.retries ?? 5)
  const timeoutMs = typeof retryConfig === 'number' ? 10000 : (retryConfig.timeoutMs ?? 10000)
  let lastResponse: Response | null = null
  let lastData: any = {}
  let lastRaw = ''

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      const response = await fetch(input, {
        ...(init || {}),
        headers,
        credentials: init?.credentials ?? 'include',
        signal: controller.signal,
      })
      const raw = await response.text()
      const data = raw ? JSON.parse(raw) : {}
      lastResponse = response
      lastData = data
      lastRaw = raw
      if (response.ok && data?.success !== false) {
        return { response, data, raw }
      }
      if (response.status === 401 || response.status === 403) {
        return { response, data, raw }
      }
    } catch (error) {
      lastData = { error: error instanceof Error ? error.message : 'Request failed' }
      lastRaw = ''
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)))
    }
  }

  return { response: lastResponse, data: lastData, raw: lastRaw }
}
export function ProfileView({ user }: { user: any }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
  })
  const [draft, setDraft] = useState({
    name: '',
    phone: '',
  })

  useEffect(() => {
    async function fetchProfile() {
      try {
        const { response, data: payload } = await fetchJsonWithRetry('/api/driver/profile', { credentials: 'include' })
        if (!response?.ok) throw new Error('Failed to load profile')
        const profile = payload?.driver || payload?.profile || {}
        setForm({
          name: profile?.user?.name || user?.name || '',
          email: profile?.user?.email || user?.email || '',
          phone: profile?.phone || profile?.user?.phone || '',
        })
      } catch (error) {
        console.warn('Failed to load profile:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  }, [user?.email, user?.name])

  const onChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }


  const openEdit = () => {
    setDraft({
      name: form.name,
      phone: form.phone,
    })
    setEditOpen(true)
  }

  const onSave = async () => {
    if (!draft.name.trim()) {
      toast.error('Name is required')
      return
    }

    setIsSaving(true)
    try {
      const payloadBody: Record<string, string> = {
        name: draft.name,
        phone: draft.phone,
      }

      const response = await fetch('/api/driver/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payloadBody),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }
      setForm((prev) => ({
        ...prev,
        name: draft.name,
        phone: draft.phone,
      }))
      setEditOpen(false)
      toast.success('Profile updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
      <h2 className="text-xl font-bold text-gray-900 mb-4">My Profile</h2>
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="h-36 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-20 w-20 mb-4">
                  <AvatarFallback className="bg-blue-600 text-white text-2xl">
                    {(form.name || user?.name || 'D').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h3 className="text-lg font-semibold text-gray-900">{form.name || 'N/A'}</h3>
                <p className="text-sm text-gray-500">{form.email || 'N/A'}</p>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Phone</p>
                  <p className="text-sm font-medium text-gray-900">{form.phone || 'N/A'}</p>
                </div>
              </div>

              <Button className="w-full" onClick={openEdit}>
                Edit Profile
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">
                Edit <span className="text-[#2f9a34]">Profile</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Update your personal details.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3.5 overflow-y-auto px-5 pb-5 pt-4">
            <div className="space-y-2">
              <Label htmlFor="driver-name" className="text-[0.95rem] font-semibold text-[#17365d]">Full Name</Label>
              <Input
                id="driver-name"
                value={draft.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-phone" className="text-[0.95rem] font-semibold text-[#17365d]">Phone</Label>
              <Input
                id="driver-phone"
                value={draft.phone}
                onChange={(e) => onChange('phone', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => setEditOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]"
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
