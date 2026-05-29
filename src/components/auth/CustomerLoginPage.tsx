'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Poppins } from 'next/font/google'
import Script from 'next/script'
import { setTabAuthToken } from '@/lib/client-auth'
import { validatePasswordPolicy, PASSWORD_POLICY_MESSAGE } from '@/lib/password-policy'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { Eye, EyeOff, Leaf, Loader2, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

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
  const [loginError, setLoginError] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isVerificationSending, setIsVerificationSending] = useState(false)
  const [isVerificationConfirming, setIsVerificationConfirming] = useState(false)
  const [emailVerificationRequested, setEmailVerificationRequested] = useState(false)
  const [emailVerificationCode, setEmailVerificationCode] = useState('')
  const [emailVerificationToken, setEmailVerificationToken] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const googleContinueSection = googleClientId ? (
    <div className="mb-0.5 mt-0.5 space-y-1 sm:mb-1 sm:mt-1 sm:space-y-1.5">
      <div className="flex justify-center w-full">
        <div ref={googleButtonRef} className="flex min-w-0 w-full max-w-xs items-center justify-center" />
      </div>
    </div>
  ) : (
    <p className="text-center text-xs text-slate-500">Google sign-in is not configured yet.</p>
  )

  const persistCustomerWelcomeState = (mode: 'existing' | 'new', fallbackName?: string) => {
    if (typeof window === 'undefined') return
    try {
      const normalizedName = String(fallbackName || '').trim()
      window.sessionStorage.setItem(
        'customer_welcome_state',
        JSON.stringify({
          mode,
          name: normalizedName,
          ts: Date.now(),
        })
      )
    } catch {
      // Ignore storage failures and continue authentication.
    }
  }

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

      persistCustomerWelcomeState('existing', String(data?.user?.name || '').trim())
      if (data.token) setTabAuthToken(data.token)
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

  useEffect(() => {
    if (!googleClientId) return

    const handleResize = () => {
      renderGoogleButton()
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [authMode, googleClientId])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
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
        const normalizedApiError = apiError.toLowerCase()
        const isCredentialError =
          response.status === 401 ||
          response.status === 403 ||
          normalizedApiError.includes('invalid') ||
          normalizedApiError.includes('credential') ||
          normalizedApiError.includes('password')
        if (isCredentialError) {
          setLoginError('Invalid email or password.')
          return
        }
        const fallbackError = response.status >= 500
          ? 'Login service is temporarily unavailable. Please try again shortly.'
          : 'Login failed'
        toast.error(apiError || fallbackError)
        return
      }

      persistCustomerWelcomeState('existing', String(data?.user?.name || '').trim())
      if (data.token) setTabAuthToken(data.token)
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    const passwordError = validatePasswordPolicy(password)
    if (passwordError) {
      toast.error(passwordError)
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }
    if (!emailVerified || !emailVerificationToken) {
      toast.error('Please verify your email with OTP before creating your account.')
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
          emailVerificationToken,
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

      persistCustomerWelcomeState('new', String(data?.user?.name || name || '').trim())
      if (data.token) setTabAuthToken(data.token)
      setConfirmPassword('')
      router.replace('/')
    } catch {
      toast.error('Unable to reach registration service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const requestEmailVerification = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      toast.error('Enter your email first.')
      return
    }

    setIsVerificationSending(true)
    try {
      const response = await fetch('/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, accountType: 'customer' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      setEmailVerificationRequested(true)
      setEmailVerificationCode('')
      setEmailVerificationToken('')
      setEmailVerified(false)
      toast.success('Verification code sent to your email.')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
    } finally {
      setIsVerificationSending(false)
    }
  }

  const confirmEmailVerification = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    const otp = emailVerificationCode.trim()
    if (!normalizedEmail) {
      toast.error('Enter your email first.')
      return
    }
    if (!otp) {
      toast.error('Enter the OTP code first.')
      return
    }

    setIsVerificationConfirming(true)
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, accountType: 'customer', otp }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      const token = String(payload?.verificationToken || '').trim()
      if (!token) {
        throw new Error('Verification failed. Please try again.')
      }
      setEmailVerificationToken(token)
      setEmailVerified(true)
      toast.success('Email verified successfully.')
    } catch (error: any) {
      setEmailVerificationToken('')
      setEmailVerified(false)
      toast.error(error?.message || 'Failed to verify OTP')
    } finally {
      setIsVerificationConfirming(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className={`${poppins.className} min-h-screen bg-[#eaf6ff] flex items-center justify-center px-4`}>
        <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
      </div>
    )
  }

  return (
    <div
      className={`${poppins.className} relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#eaf1f2] bg-cover bg-center bg-no-repeat px-2 py-3 sm:min-h-screen sm:px-4 sm:py-8`}
      style={{ backgroundImage: "url('/customer-login-bg.png')" }}
    >
      {googleClientId ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={renderGoogleButton} />
      ) : null}
      <Toaster position="top-right" />
      <div className="relative z-[1] mx-auto flex w-full max-w-md items-center justify-center">
        <Card className="w-full overflow-hidden rounded-[20px] border border-[#d9e4e5] bg-white py-0 shadow-[0_18px_46px_rgba(15,67,94,0.12)] backdrop-blur-md sm:rounded-[30px]">
          <div className="border-b border-[#e7eded] bg-white px-4 pb-1 pt-2 text-center sm:px-7 sm:pb-2.5 sm:pt-3.5">
            <div className="flex items-center justify-center">
              <div className="inline-flex h-[84px] w-[84px] items-center justify-center overflow-hidden">
                <img src="/aab-trading-shop.png" alt="AAB TRADING SHOP" className="h-full w-full scale-100 object-contain" />
              </div>
            </div>
            <p className="mt-1.5 text-[8px] font-semibold uppercase tracking-[0.18em] text-[#3e9a35] sm:mt-2 sm:text-[10px]">ANN ANN'S BEVERAGES TRADING</p>
            <h1 className="mt-0.5 text-[1.4rem] font-black leading-none tracking-[-0.02em] sm:mt-1 sm:text-[1.7rem]">
              <span className="block text-[#1452a1]">AAB TRADING</span>
              <span className="mt-0 block text-[#3f9a35]">SHOP</span>
            </h1>
          </div>
          <CardContent className="w-full px-4 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-0 sm:px-7 sm:pb-4 sm:pt-0">
          {authMode === 'login' ? (
              <form onSubmit={handleLogin} autoComplete="off" className="space-y-1.5 sm:space-y-2">
                <div className="flex items-center gap-3 px-1 pt-0">
                  <span className="h-px flex-1 bg-[#dce5e6]" />
                  <Leaf className="h-4 w-4 text-[#4aa13d]" />
                  <span className="h-px flex-1 bg-[#dce5e6]" />
                </div>
                <p className="px-1 text-center text-[13px] leading-tight text-[#5d6d88] sm:text-[0.92rem]">Track orders and manage deliveries from one place.</p>
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="customer-email" className="text-[12px] font-semibold tracking-[0.01em] text-[#324766] sm:text-[13px]">Email</Label>
                  <div className={`relative h-11 rounded-xl border ${loginError ? 'border-rose-300 bg-rose-50/40' : 'border-[#d5dee4] bg-white'}`}>
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#697a96]" />
                    <Input id="customer-email" type="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); if (loginError) setLoginError('') }} placeholder="Enter email" required className="h-full border-0 bg-transparent pl-9 pr-3 text-[15px] text-slate-900 placeholder:text-[#8a99b3] focus-visible:ring-0 sm:text-base" />
                  </div>
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="customer-password" className="text-[12px] font-semibold tracking-[0.01em] text-[#324766] sm:text-[13px]">Password</Label>
                  <div className={`relative h-11 rounded-xl border ${loginError ? 'border-rose-300 bg-rose-50/40' : 'border-[#d5dee4] bg-white'}`}>
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#697a96]" />
                    <Input id="customer-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); if (loginError) setLoginError('') }} placeholder="Enter password" required className="h-full border-0 bg-transparent pl-9 pr-10 text-[15px] text-slate-900 placeholder:text-[#8a99b3] focus-visible:ring-0 sm:text-base" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {loginError ? <p className="text-[12px] text-rose-600 sm:text-sm">{loginError}</p> : null}
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[#4e5f79] sm:text-sm">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#3e9f34] focus:ring-[#3e9f34]"
                  />
                  Keep me logged in
                </label>
                <Button type="submit" className="h-9 w-full rounded-xl bg-gradient-to-r from-[#3ca232] to-[#4aac35] text-sm font-bold tracking-[0.01em] text-white shadow-[0_10px_20px_rgba(63,150,55,0.28)] hover:from-[#34922c] hover:to-[#439c2f] sm:h-10 sm:text-[15px]" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log In
                </Button>
                <ForgotPasswordDialog
                  accountType="customer"
                  portal="customer"
                  initialEmail={email}
                  triggerClassName="w-full text-center text-[12px] text-[#3f9a35] transition-colors hover:text-[#34832d] sm:text-sm"
                />
                <div className="pt-0.5">
                  <div className="relative py-0 sm:py-0.5">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-[#dce5e6]" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase sm:text-xs">
                      <span className="bg-white px-2 text-[#7f8fa5]">OR CONTINUE WITH</span>
                    </div>
                  </div>
                  <div className="mt-0.5 flex justify-center">
                    <Leaf className="h-3.5 w-3.5 text-[#4aa13d]" />
                  </div>
                </div>
                {googleContinueSection}
                <p className="pt-0.5 text-center text-[12px] text-slate-600 sm:text-sm">
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setLoginError('')
                      setAuthMode('register')
                    }}
                    className="font-semibold text-[#3f9a35] hover:text-[#34832d]"
                  >
                    Register
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister} autoComplete="off" className="space-y-2.5 sm:space-y-4">
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="reg-name" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">Full Name</Label>
                  <Input id="reg-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-12 sm:text-base" />
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="reg-email" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">Email</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => {
                      const nextEmail = e.target.value
                      setEmail(nextEmail)
                      setEmailVerificationRequested(false)
                      setEmailVerificationCode('')
                      setEmailVerificationToken('')
                      setEmailVerified(false)
                    }}
                    placeholder="Enter email"
                    required
                    className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-12 sm:text-base"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={requestEmailVerification}
                      disabled={isVerificationSending || isVerificationConfirming || isLoading}
                      className="h-9 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-600"
                    >
                      {isVerificationSending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      {emailVerificationRequested ? 'Resend OTP' : 'Send OTP'}
                    </Button>
                    {emailVerified ? <p className="text-xs font-medium text-emerald-700">Email verified</p> : null}
                  </div>
                </div>
                {emailVerificationRequested ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    <Label htmlFor="reg-email-otp" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">Email OTP</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="reg-email-otp"
                        autoComplete="off"
                        value={emailVerificationCode}
                        onChange={(e) => {
                          setEmailVerificationCode(e.target.value)
                          if (emailVerified) {
                            setEmailVerified(false)
                            setEmailVerificationToken('')
                          }
                        }}
                        placeholder="Enter OTP"
                        className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-12 sm:text-base"
                      />
                      <Button
                        type="button"
                        onClick={confirmEmailVerification}
                        disabled={isVerificationConfirming || isVerificationSending || isLoading}
                        className="h-10 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 sm:h-12"
                      >
                        {isVerificationConfirming && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        Verify
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="reg-password" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">Password</Label>
                  <div className="relative">
                    <Input id="reg-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 pr-10 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-12 sm:pr-11 sm:text-base" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 sm:text-xs">{PASSWORD_POLICY_MESSAGE}</p>
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="reg-confirm-password" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">Confirm Password</Label>
                  <Input
                    id="reg-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    required
                    className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-12 sm:text-base"
                  />
                  {confirmPassword && password !== confirmPassword ? (
                    <p className="text-[12px] text-red-600 sm:text-sm">Passwords do not match</p>
                  ) : null}
                </div>
                <Button type="submit" className="h-10 w-full rounded-xl bg-emerald-600 text-sm font-bold tracking-[0.01em] text-white shadow-[0_10px_20px_rgba(5,150,105,0.2)] hover:bg-emerald-500 sm:h-12 sm:text-base sm:shadow-[0_12px_24px_rgba(5,150,105,0.26)]" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create Account
                </Button>
                {googleContinueSection}
                <p className="text-center text-[12px] text-slate-600 sm:text-sm">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setLoginError('')
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
