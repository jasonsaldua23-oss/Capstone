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
  const [isGoogleReady, setIsGoogleReady] = useState(false)
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

    const availableWidth = googleButtonRef.current.parentElement?.clientWidth ?? googleButtonRef.current.clientWidth ?? 0
    const buttonWidth = Math.max(220, Math.min(360, Math.floor(availableWidth || 280)))

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
      width: buttonWidth,
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
    if (!isGoogleReady) return
    renderGoogleButton()
  }, [googleClientId, isGoogleReady])

  useEffect(() => {
    if (!googleClientId || !isGoogleReady) return

    const handleResize = () => {
      renderGoogleButton()
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [googleClientId, isGoogleReady])

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#eaf7f2] px-2 py-2 sm:min-h-screen sm:px-4 sm:py-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-8 top-6 h-32 w-32 rounded-full border border-sky-200/60 bg-sky-100/50 blur-2xl sm:-left-16 sm:top-12 sm:h-64 sm:w-64" />
        <div className="absolute -right-8 bottom-4 h-32 w-32 rounded-full border border-emerald-200/60 bg-emerald-100/50 blur-2xl sm:-right-20 sm:bottom-6 sm:h-64 sm:w-64" />
      </div>
      {googleClientId ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setIsGoogleReady(true)}
        />
      ) : null}
      <Toaster position="top-right" />
      <div className="relative z-[1] mx-auto flex w-full max-w-md items-center justify-center">
        <Card className="w-full overflow-hidden rounded-[20px] border-emerald-200/80 bg-white/96 py-0 shadow-[0_14px_36px_rgba(5,150,105,0.12)] backdrop-blur-md sm:rounded-[30px] sm:shadow-[0_18px_50px_rgba(5,150,105,0.14)]">
          <div className="border-b border-emerald-100 bg-[#f3fcf8] px-3 pb-2.5 pt-3 text-center sm:px-6 sm:pb-5 sm:pt-6">
            <div className="flex items-center justify-center">
              <div className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-emerald-200/70 bg-emerald-100 shadow-[0_6px_16px_rgba(5,150,105,0.14)] ring-2 ring-sky-200/90 sm:h-12 sm:w-12 sm:rounded-2xl sm:shadow-[0_10px_24px_rgba(5,150,105,0.16)]">
                <img src="/anndrive.png" alt="AnnDrive" className="h-full w-full scale-100 object-contain" />
              </div>
            </div>
            <p className="mt-1.5 text-[8px] font-semibold uppercase tracking-[0.18em] text-emerald-700/80 sm:mt-3 sm:text-[11px]">Ann Ann's Beverages Trading</p>
            <h1 className="mt-1 text-[1.55rem] font-black tracking-[-0.02em] sm:mt-2 sm:text-[2rem]">
              <span className="text-[#0f4f8f]">Ann</span>
              <span className="text-[#2f9a34]">Drive</span>
            </h1>
            <p className="mt-1 text-[12px] leading-tight text-zinc-600 sm:mt-2 sm:text-[0.95rem]">Sign in to start routes and track drops in real time.</p>
          </div>
          <CardContent className="w-full px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 sm:px-6 sm:pb-6 sm:pt-5">
          <form onSubmit={handleLogin} autoComplete="off" className="space-y-2.5 sm:space-y-4">
            <div className="space-y-1.5 sm:space-y-2">
              <Label htmlFor="driver-email" className="text-[12px] font-semibold tracking-[0.01em] text-zinc-700 sm:text-[13px]">Email</Label>
              <Input id="driver-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email" required className="h-10 rounded-xl border-sky-100 bg-sky-50/50 px-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-sky-500 sm:h-12 sm:text-base" />
            </div>
            <div className="space-y-1.5 sm:space-y-2">
              <Label htmlFor="driver-password" className="text-[12px] font-semibold tracking-[0.01em] text-zinc-700 sm:text-[13px]">Password</Label>
              <div className="relative">
                <Input id="driver-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required className="h-10 rounded-xl border-sky-100 bg-sky-50/50 pr-10 text-[15px] text-zinc-900 placeholder:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-sky-500 sm:h-12 sm:pr-11 sm:text-base" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 transition-colors hover:text-zinc-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-zinc-600 sm:text-sm">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
              />
              Keep me logged in
            </label>
            <Button type="submit" className="h-10 w-full rounded-xl bg-emerald-600 text-sm font-bold tracking-[0.01em] text-white shadow-[0_10px_20px_rgba(5,150,105,0.24)] hover:bg-emerald-500 sm:h-12 sm:text-base sm:shadow-[0_12px_24px_rgba(5,150,105,0.30)]" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log In
            </Button>
            <ForgotPasswordDialog
              accountType="staff"
              initialEmail={email}
              triggerClassName="w-full text-center text-[12px] text-zinc-600 transition-colors hover:text-zinc-800 sm:text-sm"
            />
            <div className="relative py-0.5 sm:py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase sm:text-xs">
                <span className="bg-white px-2 text-zinc-500">Or continue with</span>
              </div>
            </div>
            {googleClientId ? (
              <div className="flex justify-center">
                <div ref={googleButtonRef} className="flex w-full max-w-xs justify-center" />
              </div>
            ) : (
              <p className="text-center text-xs text-zinc-500">Google sign-in is not configured yet.</p>
            )}
          </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
