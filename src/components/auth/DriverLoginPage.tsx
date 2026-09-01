'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, MapPin } from 'lucide-react'
import { clearTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { forgotPasswordHref, resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { OtpVerificationPanel } from '@/components/shared/otp-verification-modal'

const poppins = { className: '' }

function DriverRouteArtwork() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-white" />
      <div className="absolute inset-y-[4.5%] right-[6%] w-[38%] rounded-[2.2rem] bg-white/10" />
      <svg
        aria-hidden="true"
        className="absolute right-[2.5%] top-[1.5%] h-[58%] w-[42%] opacity-[0.68]"
        viewBox="0 0 280 420"
        fill="none"
      >
        <path
          d="M26 42H236M10 88H248M0 138H262M0 198H262M0 258H262M0 318H262M12 378H248M82 0V402M146 0V402M210 0V402"
          stroke="rgba(235,244,245,0.96)"
          strokeWidth="2"
        />
        <path
          d="M176 54C198 74 210 84 214 96C219 110 213 126 193 141C168 160 141 178 128 199C111 227 123 257 149 278C171 296 185 309 185 331C185 357 168 376 136 394"
          stroke="rgba(185,241,223,0.96)"
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path
          d="M76 20L246 154M32 110L228 262M46 224L192 338"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="4"
        />
      </svg>
      <div className="absolute right-[8.8%] top-[9.3%]">
        <div className="relative flex h-[5.3rem] w-[5.3rem] items-center justify-center">
          <div className="absolute inset-x-2 bottom-2 h-4 rounded-full bg-emerald-300/35 blur-[1px]" />
          <div className="absolute inset-x-1 bottom-0 h-5 rounded-full border border-emerald-200/80 bg-white/45" />
          <MapPin className="relative h-12 w-12 fill-emerald-500 text-emerald-500 drop-shadow-[0_6px_12px_rgba(16,185,129,0.2)]" strokeWidth={1.8} />
        </div>
      </div>
    </div>
  )
}

function DriverLoginBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#f2f9f5]" />
      <div className="absolute left-[-9rem] top-[5%] h-[18rem] w-[18rem] rounded-full bg-white/88 blur-[26px]" />
      <div className="absolute right-[-10rem] top-[8%] h-[28rem] w-[28rem] rounded-full bg-emerald-100/40 blur-[54px]" />
      <div className="absolute bottom-[-10rem] left-[-8rem] h-[21rem] w-[21rem] rounded-full bg-[#dff5ea]/80 blur-[22px]" />
      <div className="absolute bottom-[-12rem] right-[-10rem] h-[31rem] w-[31rem] rounded-full bg-[#dff7ea]/58 blur-[28px]" />

      <div className="absolute bottom-[-11rem] right-[-11rem] h-[32rem] w-[32rem] rounded-full border-[3.2rem] border-emerald-100/55" />
      <div className="absolute bottom-[-8rem] left-[-9rem] h-[22rem] w-[22rem] rounded-full border-[2.25rem] border-emerald-100/48" />
    </div>
  )
}

function DriverSpeedLines({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 112 34" fill="none">
      <path d="M4 9H80" stroke="rgba(160,231,212,0.95)" strokeLinecap="round" strokeWidth="6" />
      <path d="M16 17H88" stroke="rgba(168,239,220,0.92)" strokeLinecap="round" strokeWidth="6" />
      <path d="M6 25H82" stroke="rgba(178,245,226,0.88)" strokeLinecap="round" strokeWidth="6" />
    </svg>
  )
}

export function DriverLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isLoginOtpOpen, setIsLoginOtpOpen] = useState(false)
  const [loginChallengeToken, setLoginChallengeToken] = useState('')
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const persistDriverWelcomeState = (userData: any) => {
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(
        'driver_welcome_state',
        JSON.stringify({
          name: String(userData?.name || '').trim(),
          ts: Date.now(),
        })
      )
    } catch {}
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe, portal: 'driver' }),
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
        const fallbackError =
          response.status >= 500
            ? 'Login service is temporarily unavailable. Please try again shortly.'
            : 'Login failed'
        toast.error(apiError || fallbackError)
        return
      }

      if (resolvePortalFromUser(data.user) !== 'driver') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        setLoginError('Invalid email or password.')
        return
      }

      persistDriverWelcomeState(data.user)
      if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div
        className={`${poppins.className} flex min-h-screen items-center justify-center bg-[#eaf1f2] bg-cover bg-center bg-no-repeat px-4`}
        style={{ backgroundImage: "url('/customer-login-bg.png')" }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
      </div>
    )
  }

  const verifyLoginOtp = async (otp: string) => {
    const response = await fetch('/api/auth/login/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: loginChallengeToken, otp }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data?.success || resolvePortalFromUser(data?.user) !== 'driver') {
      toast.error(data?.error || 'Invalid or expired verification code')
      return false
    }
    persistDriverWelcomeState(data.user)
    if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
    setIsLoginOtpOpen(false)
    router.replace('/')
    return true
  }

  const resendLoginOtp = async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe, portal: 'driver' }),
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 202 && data?.challengeToken) {
      setLoginChallengeToken(String(data.challengeToken))
      return true
    }
    toast.error(data?.error || 'Failed to resend verification code')
    return false
  }

  // Verification takes over the page rather than opening over the form, matching the
  // customer portal and the mobile app.
  if (isLoginOtpOpen) {
    return (
      <div className={`${poppins.className} min-h-dvh bg-white px-6 pb-10 pt-4 sm:min-h-screen`}>
        <Toaster position="top-right" />
        <div className="mx-auto flex w-full max-w-md flex-col">
          <OtpVerificationPanel
            open
            variant="page"
            onOpenChange={(next) => {
              if (!next) setIsLoginOtpOpen(false)
            }}
            email={email.trim().toLowerCase()}
            onVerify={verifyLoginOtp}
            onResendCode={resendLoginOtp}
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
      <Toaster position="top-right" />

      <div className="relative z-[1] mx-auto flex w-full max-w-md items-center justify-center">
        <div className="relative w-full overflow-hidden rounded-[20px] border border-[#d9e4e5] bg-white px-4 pb-3 pt-3 shadow-[0_18px_46px_rgba(15,67,94,0.12)] backdrop-blur-md sm:rounded-[30px] sm:px-7 sm:pb-4 sm:pt-4">
          <DriverRouteArtwork />

          <div className="relative z-[1] flex flex-col items-center">
            <div className="flex h-[6.2rem] w-[6.2rem] items-center justify-center">
              <img
                src="/aab-trading-driver.png"
                alt="AAB Trading Driver"
                className="h-full w-full object-contain drop-shadow-[0_12px_28px_rgba(31,86,145,0.2)]"
              />
            </div>

            <p className="mt-0 text-center text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-[#199154]">
              ANN ANN&apos;S BEVERAGES TRADING
            </p>

            <h1 className="mt-2 text-center leading-[0.96] tracking-[-0.04em]">
              <span className="block text-[2rem] font-extrabold text-[#0a4286]">
                AAB TRADING
              </span>
              <span className="mt-2 flex items-center justify-center gap-3">
                <DriverSpeedLines className="h-3 w-8" />
                <span className="text-[2.15rem] font-extrabold text-[#13a455]">
                  DRIVER
                </span>
                <DriverSpeedLines className="h-3 w-8 scale-x-[-1]" />
              </span>
            </h1>

            <p className="mt-2.5 max-w-[18rem] text-center text-[0.85rem] font-medium leading-[1.35] text-[#586484]">
              Sign in to start routes and track drops in real time.
            </p>

            <div className="relative mt-3 w-full px-1 py-1">
              <form onSubmit={handleLogin} autoComplete="off" className="space-y-3">
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="text-[12px] font-semibold tracking-[0.01em] text-[#324766] sm:text-[13px]">Email</div>
                  <label className={`flex h-11 items-center gap-2.5 rounded-xl border px-3 ${loginError ? 'border-rose-300 bg-rose-50/40' : 'border-[#d5dee4] bg-white'}`}>
                    <Mail className="h-4 w-4 text-[#8a99b3]" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1">
                      <input
                        id="driver-email"
                        type="email"
                        autoComplete="off"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (loginError) setLoginError('')
                        }}
                        placeholder="Enter email"
                        required
                        className="block w-full border-0 bg-transparent p-0 text-[15px] text-slate-900 outline-none placeholder:text-[#8a99b3] sm:text-base"
                      />
                    </span>
                  </label>
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <div className="text-[12px] font-semibold tracking-[0.01em] text-[#324766] sm:text-[13px]">Password</div>
                  <label className={`flex h-11 items-center gap-2.5 rounded-xl border px-3 ${loginError ? 'border-rose-300 bg-rose-50/40' : 'border-[#d5dee4] bg-white'}`}>
                    <LockKeyhole className="h-4 w-4 text-[#8a99b3]" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <input
                          id="driver-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value)
                            if (loginError) setLoginError('')
                          }}
                          placeholder="Enter password"
                          required
                          className="block min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-slate-900 outline-none placeholder:text-[#8a99b3] sm:text-base"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-[#6f7b96] transition-colors hover:text-[#27446c]"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? (
                            <EyeOff className="h-3.5 w-3.5" strokeWidth={1.9} />
                          ) : (
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.9} />
                          )}
                        </button>
                      </span>
                    </span>
                  </label>
                  {loginError ? (
                    <p className="px-1 text-[0.82rem] font-medium text-[#c1545c]">{loginError}</p>
                  ) : null}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#4e5f79] sm:text-sm">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#3e9f34] focus:ring-[#3e9f34]"
                  />
                  <span>Keep me logged in</span>
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex h-12 w-full items-center justify-center rounded-[999px] bg-[#17b058] px-4 text-white shadow-[0_14px_30px_rgba(22,168,80,0.24)] transition-colors hover:bg-[#119a4a] disabled:cursor-not-allowed disabled:opacity-80"
                >
                  <span className="flex items-center justify-center gap-2 text-[1.05rem] font-bold">
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Log In
                  </span>
                </button>

                <div className="flex justify-center pt-1">
                  <Link
                    href={forgotPasswordHref('driver', email)}
                    className="inline-flex items-center gap-2.5 text-[0.9rem] font-medium text-[#16984e] transition hover:text-[#107e41]"
                  >
                    <LockKeyhole className="h-5 w-5" strokeWidth={2.1} />
                    <span>Forgot password?</span>
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
