'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { setTabAuthToken } from '@/lib/client-auth'
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

export function CustomerLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const googleContinueSection = googleClientId ? (
    <div className="space-y-3">
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-slate-500">Or continue with</span>
        </div>
      </div>
      <div className="flex justify-center">
        <div ref={googleButtonRef} className="w-full flex justify-center" />
      </div>
    </div>
  ) : (
    <p className="text-center text-xs text-slate-500">Google sign-in is not configured yet.</p>
  )

  const handleGoogleCredential = async (credential: string) => {
    if (!credential) {
      toast.error('Google sign-in failed. Please try again.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/customer/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, rememberMe }),
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
          : 'Google authentication failed'
        toast.error(apiError || fallbackError)
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success(data.created ? 'Account created successfully' : 'Welcome back')
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
          toast.error('Google sign-in failed. Please try again.')
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
        if (resolvePortalFromUser(data.user) === 'customer') router.replace('/')
      } catch (error) {
        console.warn('Customer session check timed out or failed:', error)
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
  }, [authMode, googleClientId])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/customer/login', {
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

      if (data.token) setTabAuthToken(data.token)
      toast.success('Welcome to AnnShop')
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
        }),
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
          ? 'Registration service is temporarily unavailable. Please try again shortly.'
          : 'Registration failed'
        toast.error(apiError || fallbackError)
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Account created successfully')
      setConfirmPassword('')
      router.replace('/')
    } catch {
      toast.error('Unable to reach registration service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#eaf6ff] flex items-center justify-center px-4">
        <div className="flex items-center gap-3 rounded-2xl bg-white/90 px-5 py-3 shadow-lg ring-1 ring-sky-200/80">
          <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
          <span className="text-sm font-medium text-slate-700">Opening your workspace...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#ecf7f3] px-4 py-6 sm:py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-12 h-64 w-64 rounded-full border border-sky-200/60 bg-sky-100/50 blur-2xl" />
        <div className="absolute -right-16 bottom-8 h-64 w-64 rounded-full border border-emerald-200/60 bg-emerald-100/50 blur-2xl" />
      </div>
      {googleClientId ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={renderGoogleButton} />
      ) : null}
      <Toaster position="top-right" />
      <div className="relative z-[1] mx-auto w-full max-w-md">
        <Card className="overflow-hidden border-sky-200/80 bg-white/96 shadow-[0_24px_65px_rgba(2,132,199,0.20)] backdrop-blur-md sm:rounded-[32px]">
          <div className="border-b border-sky-100 bg-[#f3fbff] px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-center sm:px-6">
            <div className="flex items-center justify-center">
              <div className="inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1.15rem] border border-sky-200/70 bg-sky-100 shadow-[0_10px_24px_rgba(14,165,233,0.25)] ring-2 ring-emerald-200/90">
                <img src="/annshop.png" alt="AnnShop" className="h-full w-full scale-125 object-contain" />
              </div>
            </div>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700/80">Customer Portal</p>
            <h1 className="mt-1 text-[2rem] font-black tracking-[-0.02em] text-slate-900">AnnShop</h1>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-slate-600">Track orders and manage deliveries from one place.</p>
          </div>
          <CardContent className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pb-7">
          {authMode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="customer-email" className="text-[13px] font-semibold tracking-[0.01em] text-slate-700">Email</Label>
                  <Input id="customer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-12 rounded-xl border-sky-100 bg-sky-50/50 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-sky-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer-password" className="text-[13px] font-semibold tracking-[0.01em] text-slate-700">Password</Label>
                  <div className="relative">
                    <Input id="customer-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required className="h-12 rounded-xl border-sky-100 bg-sky-50/50 pr-11 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-sky-500" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  Keep me logged in
                </label>
                <Button type="submit" className="h-12 w-full rounded-xl bg-sky-600 text-white shadow-[0_12px_24px_rgba(2,132,199,0.30)] hover:bg-sky-500 font-bold tracking-[0.01em]" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log In
                </Button>
                <ForgotPasswordDialog
                  accountType="customer"
                  initialEmail={email}
                  triggerClassName="w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
                />
                {googleContinueSection}
                <p className="text-center text-sm text-slate-600">
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setAuthMode('register')}
                    className="font-medium text-sky-700 hover:text-sky-600"
                  >
                    Register
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name" className="text-[13px] font-semibold tracking-[0.01em] text-slate-700">Full Name</Label>
                  <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required className="h-12 rounded-xl border-emerald-100 bg-emerald-50/50 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email" className="text-[13px] font-semibold tracking-[0.01em] text-slate-700">Email</Label>
                  <Input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-12 rounded-xl border-emerald-100 bg-emerald-50/50 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password" className="text-[13px] font-semibold tracking-[0.01em] text-slate-700">Password</Label>
                  <div className="relative">
                    <Input id="reg-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required className="h-12 rounded-xl border-emerald-100 bg-emerald-50/50 pr-11 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-confirm-password" className="text-[13px] font-semibold tracking-[0.01em] text-slate-700">Confirm Password</Label>
                  <Input
                    id="reg-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm Password"
                    required
                    className="h-12 rounded-xl border-emerald-100 bg-emerald-50/50 text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500"
                  />
                  {confirmPassword && password !== confirmPassword ? (
                    <p className="text-sm text-red-600">Passwords do not match</p>
                  ) : null}
                </div>
                <Button type="submit" className="h-12 w-full rounded-xl bg-emerald-600 text-white shadow-[0_12px_24px_rgba(5,150,105,0.26)] hover:bg-emerald-500 font-bold tracking-[0.01em]" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create Account
                </Button>
                {googleContinueSection}
                <p className="text-center text-sm text-slate-600">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login')
                      setConfirmPassword('')
                    }}
                    className="font-medium text-sky-700 hover:text-sky-600"
                  >
                    Login
                  </button>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
