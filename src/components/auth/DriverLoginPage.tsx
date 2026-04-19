'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { clearTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
        }
      }
    }
  }
}

export function DriverLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

  const handleGoogleCredential = async (credential: string) => {
    if (!credential) {
      toast.error('Invalid credentials')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/staff/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, portal: 'driver', rememberMe }),
      })
      const rawBody = await response.text()
      let data: any = null
      try {
        data = rawBody ? JSON.parse(rawBody) : null
      } catch {
        data = null
      }

      if (!response.ok || !data?.success || !data?.user) {
        const apiError = String(data?.error || data?.message || '').trim()
        const fallbackError = response.status >= 500
          ? 'Google sign-in is temporarily unavailable. Please use email/password for now.'
          : 'Invalid credentials'
        toast.error(apiError || fallbackError)
        return
      }

      if (resolvePortalFromUser(data.user) !== 'driver') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        toast.error('Invalid credentials')
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Welcome to AnnDrive')
      router.replace('/')
    } catch {
      toast.error('Unable to reach authentication service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const renderGoogleButton = () => {
    if (!googleClientId) return
    if (!window.google?.accounts?.id) return
    if (!googleButtonRef.current) return

    googleButtonRef.current.innerHTML = ''
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => {
        if (response.credential) {
          void handleGoogleCredential(response.credential)
        } else {
          toast.error('Invalid credentials')
        }
      },
    })
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: 360,
    })
  }

  useEffect(() => {
    let cancelled = false

    async function checkSession() {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const response = await fetch('/api/auth/me', { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        if (!data?.user) return
        if (resolvePortalFromUser(data.user) === 'driver') router.replace('/')
      } catch (error) {
        console.warn('Driver session check timed out or failed:', error)
      } finally {
        clearTimeout(timeout)
        if (!cancelled) setIsCheckingSession(false)
      }
    }

    checkSession()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    renderGoogleButton()
  }, [googleClientId])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      })
      const rawBody = await response.text()
      let data: any = null
      try {
        data = rawBody ? JSON.parse(rawBody) : null
      } catch {
        data = null
      }

      if (!response.ok || !data?.success || !data?.user) {
        const apiError = String(data?.error || data?.message || '').trim()
        const fallbackError = response.status >= 500
          ? 'Login service is temporarily unavailable. Please try again shortly.'
          : 'Login failed'
        toast.error(apiError || fallbackError)
        return
      }

      if (resolvePortalFromUser(data.user) !== 'driver') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        toast.error('Invalid credentials')
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Welcome to AnnDrive')
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#ecf7ff] flex items-center justify-center px-4">
        <div className="flex items-center gap-3 rounded-2xl bg-white/90 px-5 py-3 shadow-lg ring-1 ring-zinc-200">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
          <span className="text-sm font-medium text-zinc-700">Preparing driver dashboard...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eaf7f2] px-4 py-6 sm:py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-16 top-12 h-64 w-64 rounded-full border border-sky-200/60 bg-sky-100/50 blur-2xl" />
        <div className="absolute -right-20 bottom-6 h-64 w-64 rounded-full border border-emerald-200/60 bg-emerald-100/50 blur-2xl" />
      </div>
      {googleClientId ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={renderGoogleButton} />
      ) : null}
      <Toaster position="top-right" />
      <div className="relative z-[1] mx-auto w-full max-w-md">
        <Card className="overflow-hidden border-emerald-200/80 bg-white/96 shadow-[0_24px_65px_rgba(5,150,105,0.20)] backdrop-blur-md sm:rounded-[32px]">
          <div className="border-b border-emerald-100 bg-[#f3fcf8] px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-center sm:px-6">
            <div className="flex items-center justify-center">
              <div className="inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1.15rem] border border-emerald-200/70 bg-emerald-100 shadow-[0_10px_24px_rgba(5,150,105,0.25)] ring-2 ring-sky-200/90">
                <img src="/anndrive.png" alt="AnnDrive" className="h-full w-full scale-125 object-contain" />
              </div>
            </div>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700/80">Driver Workspace</p>
            <h1 className="mt-1 text-[2rem] font-black tracking-[-0.02em]">
              <span className="text-[#0f4f8f]">Ann</span>
              <span className="text-[#2f9a34]">Drive</span>
            </h1>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-zinc-600">Sign in to start routes and track drops in real time.</p>
          </div>
          <CardContent className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pb-7">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="driver-email" className="text-[13px] font-semibold tracking-[0.01em] text-zinc-700">Email</Label>
              <Input id="driver-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="driver@logistics.com" required className="h-12 rounded-xl border-sky-100 bg-sky-50/50 text-zinc-900 placeholder:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-sky-500" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-password" className="text-[13px] font-semibold tracking-[0.01em] text-zinc-700">Password</Label>
              <div className="relative">
                <Input id="driver-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required className="h-12 rounded-xl border-sky-100 bg-sky-50/50 pr-11 text-zinc-900 placeholder:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-sky-500" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 transition-colors hover:text-zinc-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
              />
              Keep me logged in
            </label>
            <Button type="submit" className="h-12 w-full rounded-xl bg-emerald-600 text-white shadow-[0_12px_24px_rgba(5,150,105,0.30)] hover:bg-emerald-500 font-bold tracking-[0.01em]" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log In
            </Button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-zinc-500">Or continue with</span>
              </div>
            </div>
            {googleClientId ? (
              <div className="flex justify-center">
                <div ref={googleButtonRef} className="w-full flex justify-center" />
              </div>
            ) : (
              <p className="text-center text-xs text-zinc-500">Google sign-in is not configured yet.</p>
            )}
            <ForgotPasswordDialog
              accountType="staff"
              initialEmail={email}
              triggerClassName="w-full text-center text-sm text-zinc-600 hover:text-zinc-800 transition-colors"
            />
          </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
