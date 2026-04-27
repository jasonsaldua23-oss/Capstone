'use client'

import { useState, useEffect, useRef } from 'react'
import { getTabAuthToken } from '@/lib/client-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { prepareImageForUpload } from '@/lib/client-image'
import { Camera, Loader2 } from 'lucide-react'
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
  const [isUploadingLicensePhoto, setIsUploadingLicensePhoto] = useState(false)
  const [isReadingLicenseOcr, setIsReadingLicenseOcr] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const licenseCameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const licenseCameraStreamRef = useRef<MediaStream | null>(null)
  const [isLicenseCameraOpen, setIsLicenseCameraOpen] = useState(false)
  const [isLicenseCameraLoading, setIsLicenseCameraLoading] = useState(false)
  const [licenseCameraError, setLicenseCameraError] = useState('')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
    licensePhoto: '',
  })
  const [draft, setDraft] = useState({
    name: '',
    phone: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
    licensePhoto: '',
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
          licenseNumber: profile?.licenseNumber || '',
          licenseType: profile?.licenseType || '',
          licenseExpiry: profile?.licenseExpiry ? String(profile.licenseExpiry).slice(0, 10) : '',
          licensePhoto: profile?.licensePhoto || '',
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

  const normalizeDateToInput = (value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const isoLike = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
    if (isoLike) {
      const year = isoLike[1]
      const month = isoLike[2].padStart(2, '0')
      const day = isoLike[3].padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    const mdy = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/)
    if (mdy) {
      const month = mdy[1].padStart(2, '0')
      const day = mdy[2].padStart(2, '0')
      const year = mdy[3]
      return `${year}-${month}-${day}`
    }
    return ''
  }

  const extractLicenseFieldsFromText = (text: string) => {
    const normalized = String(text || '').toUpperCase().replace(/\s+/g, ' ')
    const licenseFromKeyword =
      normalized.match(/\b(?:LICEN[CS]E\s*(?:NO|NUM(?:BER)?)?|DL(?:\s*NO)?|ID(?:\s*NO)?)\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i)?.[1] || ''
    const genericMatches = normalized.match(/\b[A-Z0-9]{10,20}\b/g) || []
    const bestGeneric = genericMatches.find((token) => /[A-Z]/.test(token) && /\d/.test(token)) || genericMatches[0] || ''
    const licenseNumber = (licenseFromKeyword || bestGeneric || '').replace(/[^A-Z0-9]/g, '')

    const typeMatch = normalized.match(/\b(?:CLASS|TYPE)\s*[:#-]?\s*([A-Z0-9]{1,3})\b/)
    const expiryMatch = normalized.match(/\b(?:EXP|EXPIRY|EXPIRATION|VALID UNTIL)\s*[:#-]?\s*([0-9/-]{8,10})\b/)
    const fallbackDate = normalized.match(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/)

    return {
      licenseNumber,
      licenseType: typeMatch?.[1] || '',
      licenseExpiry: normalizeDateToInput(expiryMatch?.[1] || fallbackDate?.[0] || ''),
    }
  }

  const runLicenseOcr = async (file: File) => {
    setIsReadingLicenseOcr(true)
    let worker: any = null
    try {
      const { createWorker } = await import('tesseract.js')
      worker = await createWorker('eng')
      const { data } = await worker.recognize(file)
      const extracted = extractLicenseFieldsFromText(data?.text || '')

      let applied = false
      setDraft((prev) => {
        const next = { ...prev }
        if (extracted.licenseNumber && extracted.licenseNumber !== prev.licenseNumber) {
          next.licenseNumber = extracted.licenseNumber
          applied = true
        }
        if (extracted.licenseType && !prev.licenseType) {
          next.licenseType = extracted.licenseType
          applied = true
        }
        if (extracted.licenseExpiry && !prev.licenseExpiry) {
          next.licenseExpiry = extracted.licenseExpiry
          applied = true
        }
        return next
      })
      if (applied) {
        toast.success('License fields auto-filled from ID image')
      }
    } catch {
      // OCR should never block upload flow
    } finally {
      if (worker) {
        try {
          await worker.terminate()
        } catch {
          // ignore worker cleanup errors
        }
      }
      setIsReadingLicenseOcr(false)
    }
  }

  const openEdit = () => {
    setDraft({
      name: form.name,
      phone: form.phone,
      licenseNumber: form.licenseNumber,
      licenseType: form.licenseType,
      licenseExpiry: form.licenseExpiry,
      licensePhoto: form.licensePhoto,
    })
    setEditOpen(true)
  }

  const uploadLicensePhoto = async (file: File) => {
    setIsUploadingLicensePhoto(true)
    try {
      const optimizedFile = await prepareImageForUpload(file, { maxDimension: 1600, maxBytes: 2 * 1024 * 1024 })
      const formData = new FormData()
      formData.append('file', optimizedFile)

      const response = await fetch('/api/uploads/driver-license', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false || !payload?.imageUrl) {
        throw new Error(payload?.error || 'Failed to upload license image')
      }
      setDraft((prev) => ({ ...prev, licensePhoto: payload.imageUrl }))
      void runLicenseOcr(optimizedFile)
      toast.success('License image uploaded')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to upload license image')
    } finally {
      setIsUploadingLicensePhoto(false)
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  const stopLicenseCameraStream = () => {
    if (licenseCameraStreamRef.current) {
      licenseCameraStreamRef.current.getTracks().forEach((track) => track.stop())
      licenseCameraStreamRef.current = null
    }
  }

  const closeLicenseCamera = () => {
    stopLicenseCameraStream()
    setIsLicenseCameraOpen(false)
    setIsLicenseCameraLoading(false)
    setLicenseCameraError('')
  }

  const openLicenseCamera = () => {
    setLicenseCameraError('')
    setIsLicenseCameraOpen(true)
  }

  const captureLicenseFromCamera = async () => {
    const video = licenseCameraVideoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error('Camera is still loading')
      return
    }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Unable to capture photo')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Failed to capture photo')
      const file = new File([blob], `license-camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      closeLicenseCamera()
      await uploadLicensePhoto(file)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to capture photo')
    }
  }

  useEffect(() => {
    if (!isLicenseCameraOpen) return

    let cancelled = false
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera is not available on this device/browser.')
        }
        setIsLicenseCameraLoading(true)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        licenseCameraStreamRef.current = stream
        if (licenseCameraVideoRef.current) {
          licenseCameraVideoRef.current.srcObject = stream
          await licenseCameraVideoRef.current.play().catch(() => {})
        }
      } catch (error: any) {
        setLicenseCameraError(error?.message || 'Unable to access camera.')
      } finally {
        if (!cancelled) setIsLicenseCameraLoading(false)
      }
    }

    void start()
    return () => {
      cancelled = true
      stopLicenseCameraStream()
    }
  }, [isLicenseCameraOpen])

  const takeLicensePhoto = async () => {
    if (isUploadingLicensePhoto || isSaving) return
    try {
      const cap = (window as any)?.Capacitor
      const isNative = Boolean(cap?.isNativePlatform?.() || (typeof cap?.getPlatform === 'function' && cap.getPlatform() !== 'web'))
      if (!isNative) {
        openLicenseCamera()
        return
      }
      const cameraModule = await import('@capacitor/camera')
      const photo = await cameraModule.Camera.getPhoto({
        source: cameraModule.CameraSource.Camera,
        resultType: cameraModule.CameraResultType.Uri,
        quality: 90,
        allowEditing: false,
      })
      const photoPath = String(photo?.webPath || photo?.path || '').trim()
      if (!photoPath) throw new Error('Failed to capture photo')
      const fileResponse = await fetch(photoPath)
      const blob = await fileResponse.blob()
      const mimeType = blob.type || 'image/jpeg'
      const ext = mimeType.includes('png') ? 'png' : 'jpg'
      const file = new File([blob], `license-camera-${Date.now()}.${ext}`, { type: mimeType })
      await uploadLicensePhoto(file)
    } catch {
      openLicenseCamera()
    }
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
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licensePhoto: draft.licensePhoto,
      }
      if (draft.licenseExpiry) {
        payloadBody.licenseExpiry = new Date(`${draft.licenseExpiry}T00:00:00`).toISOString()
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
        licenseNumber: draft.licenseNumber,
        licenseType: draft.licenseType,
        licenseExpiry: draft.licenseExpiry,
        licensePhoto: draft.licensePhoto,
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

              <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                <div className="space-y-2">
                  <Label>License #</Label>
                  <p className="text-sm font-medium text-gray-900">{form.licenseNumber || 'N/A'}</p>
                </div>
                <div className="space-y-2">
                  <Label>License Type</Label>
                  <p className="text-sm font-medium text-gray-900">{form.licenseType || 'N/A'}</p>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>License Expiration</Label>
                  <p className="text-sm font-medium text-gray-900">{form.licenseExpiry || 'N/A'}</p>
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <Label>License Photo</Label>
                {form.licensePhoto ? (
                  <img
                    src={form.licensePhoto}
                    alt="Driver license"
                    className="h-40 w-full rounded-md border border-slate-200 object-cover"
                  />
                ) : (
                  <p className="text-sm text-gray-500">No license photo uploaded</p>
                )}
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
                Update your personal details and license info.
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

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="driver-license-number" className="text-[0.95rem] font-semibold text-[#17365d]">License #</Label>
                <Input
                  id="driver-license-number"
                  value={draft.licenseNumber}
                  onChange={(e) => onChange('licenseNumber', e.target.value)}
                  className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver-license-type" className="text-[0.95rem] font-semibold text-[#17365d]">License Type</Label>
                <Input
                  id="driver-license-type"
                  value={draft.licenseType}
                  onChange={(e) => onChange('licenseType', e.target.value)}
                  className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="driver-license-expiry" className="text-[0.95rem] font-semibold text-[#17365d]">License Expiration</Label>
              <Input
                id="driver-license-expiry"
                type="date"
                value={draft.licenseExpiry}
                onChange={(e) => onChange('licenseExpiry', e.target.value)}
                className="h-11 rounded-xl border-sky-200 bg-white/90 text-[0.98rem] text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:border-[#0d61ad] focus-visible:ring-[#0d61ad]/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[0.95rem] font-semibold text-[#17365d]">License Photo</Label>
              {draft.licensePhoto ? (
                <img
                  src={draft.licensePhoto}
                  alt="Driver license preview"
                  className="h-40 w-full rounded-2xl border border-sky-100 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.10)]"
                />
              ) : (
                <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-white/60 text-sm text-[#597393]">
                  No image selected
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-sky-200 bg-white/85 px-3 text-sm font-semibold text-[#0f4f8f] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50 hover:text-[#0d61ad]"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isUploadingLicensePhoto || isSaving}
                >
                  Upload from Gallery
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-emerald-200 bg-white/85 px-3 text-sm font-semibold text-[#1f7a38] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-emerald-50 hover:text-[#1a6a31]"
                  onClick={() => void takeLicensePhoto()}
                  disabled={isUploadingLicensePhoto || isSaving}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Take Photo
                </Button>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void uploadLicensePhoto(file)
                }}
              />
              {isUploadingLicensePhoto ? (
                <p className="text-xs text-[#4d6785]">Uploading license image...</p>
              ) : null}
              {isReadingLicenseOcr ? (
                <p className="text-xs text-[#4d6785]">Reading ID text and auto-filling fields...</p>
              ) : null}
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

      <Dialog
        open={isLicenseCameraOpen}
        onOpenChange={(open) => {
          if (!open) closeLicenseCamera()
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/75 bg-gradient-to-b from-[#f4fbff] via-white to-[#eef8f2] p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Take License Photo</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">Use your camera to capture the license ID.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="overflow-hidden rounded-xl border border-sky-100 bg-black shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
              <video ref={licenseCameraVideoRef} autoPlay playsInline muted className="h-64 w-full object-cover" />
            </div>
            {isLicenseCameraLoading ? <p className="text-sm text-[#4d6785]">Opening camera...</p> : null}
            {licenseCameraError ? <p className="text-sm text-red-600">{licenseCameraError}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50" onClick={closeLicenseCamera}>
                Cancel
              </Button>
              <Button type="button" className="h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]" onClick={() => void captureLicenseFromCamera()} disabled={Boolean(licenseCameraError)}>
                Capture
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
