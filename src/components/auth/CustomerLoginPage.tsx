'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Script from 'next/script'
import { setTabAuthToken } from '@/lib/client-auth'
import { validatePasswordPolicy, PASSWORD_POLICY_MESSAGE } from '@/lib/password-policy'
import { forgotPasswordHref, resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { CheckCircle2, Eye, EyeOff, Leaf, Loader2, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { OtpVerificationPanel } from '@/components/shared/otp-verification-modal'

const poppins = { className: '' }

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void
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
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isVerificationSending, setIsVerificationSending] = useState(false)
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false)
  const [isLoginOtpOpen, setIsLoginOtpOpen] = useState(false)
  const [loginChallengeToken, setLoginChallengeToken] = useState('')
  const [emailVerificationToken, setEmailVerificationToken] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const loginGoogleButtonRef = useRef<HTMLDivElement | null>(null)
  const registerGoogleButtonRef = useRef<HTMLDivElement | null>(null)
  const isRenderingGoogleRef = useRef(false)
  // Verification takes over the whole page rather than opening over the form, matching
  // the mobile app, so the form (and the Google button inside it) unmounts while it is up.
  const isOtpPageOpen = isOtpModalOpen || isLoginOtpOpen
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

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
      toast.error('Google authentication failed. Please try again.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/customer/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Google customer sign-in is always remembered for the full persistent session.
        body: JSON.stringify({ credential, rememberMe: true }),
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
          ? 'Google service is temporarily unavailable. Please use email/password for now.'
          : 'Google authentication failed'
        toast.error(apiError || fallbackError)
        return
      }

      persistCustomerWelcomeState(data?.created ? 'new' : 'existing', String(data?.user?.name || '').trim())
      if (data.token) setTabAuthToken(data.token, { persistent: true })
      router.replace('/')
    } catch {
      toast.error('Unable to reach authentication service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const verifyLoginOtp = async (otp: string) => {
    const response = await fetch('/api/auth/login/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: loginChallengeToken, otp }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data?.success || !data?.user) {
      toast.error(data?.error || 'Invalid or expired verification code')
      return false
    }
    persistCustomerWelcomeState('existing', String(data.user.name || '').trim())
    if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
    setIsLoginOtpOpen(false)
    router.replace('/')
    return true
  }

  const resendLoginOtp = async () => {
    const response = await fetch('/api/auth/customer/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe }),
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 202 && data?.challengeToken) {
      setLoginChallengeToken(String(data.challengeToken))
      return true
    }
    toast.error(data?.error || 'Failed to resend verification code')
    return false
  }

  const renderGoogleButton = useCallback(() => {
    if (!googleClientId) return
    if (!window.google?.accounts?.id) return

    // Clean BOTH containers to avoid any orphan iframes
    if (loginGoogleButtonRef.current) {
      loginGoogleButtonRef.current.innerHTML = ''
    }
    if (registerGoogleButtonRef.current) {
      registerGoogleButtonRef.current.innerHTML = ''
    }

    const targetEl = authMode === 'login' ? loginGoogleButtonRef.current : registerGoogleButtonRef.current
    if (!targetEl) return

    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response: { credential?: string }) => {
          if (response.credential) {
            void handleGoogleCredential(response.credential)
          } else {
            toast.error('Google authentication failed. Please try again.')
          }
        },
      })

      targetEl.innerHTML = ''
      const parentWidth = targetEl.parentElement?.clientWidth || targetEl.clientWidth || 300
      const buttonWidth = Math.max(240, Math.min(340, Math.floor(parentWidth)))

      window.google.accounts.id.renderButton(targetEl, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: buttonWidth,
      })
    } catch (err) {
      console.warn('Error rendering Google button:', err)
    }
  }, [authMode, googleClientId])

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
    // Clear both ref containers immediately on authMode switch
    if (loginGoogleButtonRef.current) loginGoogleButtonRef.current.innerHTML = ''
    if (registerGoogleButtonRef.current) registerGoogleButtonRef.current.innerHTML = ''

    const timer = setTimeout(() => {
      renderGoogleButton()
    }, 60)
    return () => clearTimeout(timer)
    // isOtpPageOpen: returning from the verification page gives the form a new ref
    // container, and GIS only fills the node it was handed.
  }, [authMode, googleClientId, renderGoogleButton, isOtpPageOpen])

  useEffect(() => {
    if (!googleClientId) return

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        renderGoogleButton()
      }, 200)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener('resize', handleResize)
    }
  }, [authMode, googleClientId, renderGoogleButton])

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

      if (response.status === 202 && data?.requiresTwoFactor && data?.challengeToken) {
        setLoginChallengeToken(String(data.challengeToken))
        setIsLoginOtpOpen(true)
        toast.success(data?.message || 'Verification code sent')
        return
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
      if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
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

    if (!firstName.trim() || !lastName.trim()) {
      toast.error('Please enter your first and last name.')
      return
    }

    const fullName = [firstName.trim(), middleName.trim(), lastName.trim()].filter(Boolean).join(' ')

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          middleName: middleName.trim(),
          lastName: lastName.trim(),
          name: fullName,
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

      persistCustomerWelcomeState('new', String(data?.user?.name || fullName || '').trim())
      if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
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
      toast.error('Please enter your email address first.')
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
      setIsOtpModalOpen(true)
      toast.success('Verification code sent to your email.')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
    } finally {
      setIsVerificationSending(false)
    }
  }

  const handleVerifyOtp = async (otp: string): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase()
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, accountType: 'customer', otp }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Invalid OTP code')
      }
      const token = String(payload?.verificationToken || '').trim()
      if (!token) {
        throw new Error('Verification token missing. Please try again.')
      }
      setEmailVerificationToken(token)
      setEmailVerified(true)
      toast.success('Email verified successfully!')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify OTP')
      return false
    }
  }

  const handleResendOtp = async (): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase()
    try {
      const response = await fetch('/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, accountType: 'customer' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to resend OTP')
      }
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to resend OTP')
      return false
    }
  }

  if (isCheckingSession) {
    return (
      <div className={`${poppins.className} min-h-screen bg-[#eaf6ff] flex items-center justify-center px-4`}>
        <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
      </div>
    )
  }

  if (isOtpPageOpen) {
    const isLoginChallenge = isLoginOtpOpen
    return (
      <div className={`${poppins.className} min-h-dvh bg-white px-6 pb-10 pt-4 sm:min-h-screen`}>
        <Toaster position="top-right" />
        <div className="mx-auto flex w-full max-w-md flex-col">
          <OtpVerificationPanel
            open
            variant="page"
            onOpenChange={(next) => {
              if (next) return
              if (isLoginChallenge) setIsLoginOtpOpen(false)
              else setIsOtpModalOpen(false)
            }}
            email={email.trim().toLowerCase()}
            onVerify={isLoginChallenge ? verifyLoginOtp : handleVerifyOtp}
            onResendCode={isLoginChallenge ? resendLoginOtp : handleResendOtp}
            theme="emerald"
          />
        </div>
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
              <form key="customer-login-form" onSubmit={handleLogin} autoComplete="off" className="space-y-1.5 sm:space-y-2">
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
                <Button type="submit" className="h-9 w-full rounded-xl bg-[#3ca232] text-sm font-bold tracking-[0.01em] text-white shadow-[0_10px_20px_rgba(63,150,55,0.24)] hover:bg-[#34922c] sm:h-10 sm:text-[15px]" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log In
                </Button>
                <Link
                  href={forgotPasswordHref('customer', email)}
                  className="block w-full text-center text-[12px] text-[#3f9a35] transition-colors hover:text-[#34832d] sm:text-sm"
                >
                  Forgot password?
                </Link>
                <div key="login-divider" className="my-2.5 sm:my-3">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-[#dce5e6]" />
                    </div>
                    <div className="relative flex items-center gap-1.5 bg-white px-3 text-[10px] uppercase font-semibold tracking-wider text-[#7f8fa5] sm:text-xs">
                      <Leaf className="h-3.5 w-3.5 text-[#4aa13d]" />
                      <span>OR CONTINUE WITH</span>
                    </div>
                  </div>
                </div>
                {googleClientId ? (
                  <div key="login-google-container" className="my-1.5 flex w-full justify-center">
                    <div ref={loginGoogleButtonRef} className="flex min-h-[44px] w-full max-w-[340px] items-center justify-center relative z-10" />
                  </div>
                ) : (
                  <p className="text-center text-xs text-slate-500 my-2">Google sign-in is not configured yet.</p>
                )}
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
              <form key="customer-register-form" onSubmit={handleRegister} autoComplete="off" className="space-y-2.5 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
                  <div className="space-y-1 sm:space-y-1.5">
                    <Label htmlFor="reg-first-name" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">
                      First Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="reg-first-name"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="e.g. Juan"
                      required
                      className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-11"
                    />
                  </div>
                  <div className="space-y-1 sm:space-y-1.5">
                    <Label htmlFor="reg-last-name" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">
                      Last Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="reg-last-name"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="e.g. Dela Cruz"
                      required
                      className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-11"
                    />
                  </div>
                </div>
                <div className="space-y-1 sm:space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="reg-middle-name" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">
                      Middle Name
                    </Label>
                    <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                  </div>
                  <Input
                    id="reg-middle-name"
                    autoComplete="additional-name"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    placeholder="e.g. Santos"
                    className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-11"
                  />
                </div>
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="reg-email" className="text-[12px] font-semibold tracking-[0.01em] text-slate-700 sm:text-[13px]">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    {emailVerified ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Email Verified
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id="reg-email"
                      type="email"
                      autoComplete="off"
                      value={email}
                      disabled={emailVerified}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setEmailVerificationToken('')
                        setEmailVerified(false)
                      }}
                      placeholder="Enter email address"
                      required
                      className="h-10 rounded-xl border-emerald-100 bg-emerald-50/50 px-3 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus-visible:ring-emerald-500 sm:h-11 sm:text-base disabled:bg-slate-100/70 disabled:text-slate-600"
                    />
                    {!emailVerified && (
                      <Button
                        type="button"
                        onClick={requestEmailVerification}
                        disabled={isVerificationSending || isLoading}
                        className="h-10 shrink-0 rounded-xl bg-emerald-700 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 sm:h-11"
                      >
                        {isVerificationSending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Send OTP
                      </Button>
                    )}
                  </div>
                </div>
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
                <div key="register-divider" className="my-2.5 sm:my-3">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-[#dce5e6]" />
                    </div>
                    <div className="relative flex items-center gap-1.5 bg-white px-3 text-[10px] uppercase font-semibold tracking-wider text-[#7f8fa5] sm:text-xs">
                      <Leaf className="h-3.5 w-3.5 text-[#4aa13d]" />
                      <span>OR CONTINUE WITH</span>
                    </div>
                  </div>
                </div>
                {googleClientId ? (
                  <div key="register-google-container" className="my-1.5 flex w-full justify-center">
                    <div ref={registerGoogleButtonRef} className="flex min-h-[44px] w-full max-w-[340px] items-center justify-center relative z-10" />
                  </div>
                ) : (
                  <p className="text-center text-xs text-slate-500 my-2">Google sign-in is not configured yet.</p>
                )}
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
