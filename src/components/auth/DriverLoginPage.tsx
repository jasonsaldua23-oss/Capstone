'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Poppins } from 'next/font/google'
import { ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, MapPin } from 'lucide-react'
import { clearTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

function DriverRouteArtwork() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),rgba(240,251,248,0.86)_55%,rgba(225,248,242,0.76)_100%)]" />
      <div className="absolute inset-y-[4.5%] right-[6%] w-[38%] rounded-[2.2rem] bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.12))] opacity-90" />
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

function DriverSpeedLines({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 112 34" fill="none">
      <path d="M4 9H80" stroke="rgba(160,231,212,0.95)" strokeLinecap="round" strokeWidth="6" />
      <path d="M16 17H88" stroke="rgba(168,239,220,0.92)" strokeLinecap="round" strokeWidth="6" />
      <path d="M6 25H82" stroke="rgba(178,245,226,0.88)" strokeLinecap="round" strokeWidth="6" />
    </svg>
  )
}

function FieldIconTile({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] bg-[linear-gradient(145deg,#effbf4,#daf3e6)] shadow-[0_10px_22px_rgba(16,185,129,0.12)] sm:h-11 sm:w-11">
      {children}
    </div>
  )
}

export function DriverLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  const persistDriverWelcomeState = (userData: any) => {
    if (typeof window === 'undefined') return
    try {
      const isNewUser = Boolean(
        userData?.isNewUser ??
          userData?.isNew ??
          userData?.isFirstLogin ??
          userData?.firstLogin
      )
      window.sessionStorage.setItem(
        'driver_welcome_state',
        JSON.stringify({
          mode: isNewUser ? 'new' : 'existing',
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

      if (!response.ok || !data?.success || !data?.user) {
        const apiError = String(data?.error || data?.message || '').trim()
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
        toast.error('Invalid credentials')
        return
      }

      persistDriverWelcomeState(data.user)
      const isNewUser = Boolean(
        data?.user?.isNewUser ??
          data?.user?.isNew ??
          data?.user?.isFirstLogin ??
          data?.user?.firstLogin
      )
      const displayName = String(data?.user?.name || '').trim()
      toast.success(
        isNewUser
          ? displayName
            ? `Welcome, ${displayName}`
            : 'Welcome!'
          : displayName
            ? `Welcome back, ${displayName}`
            : 'Welcome back!'
      )
      if (data.token) setTabAuthToken(data.token)
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className={`${poppins.className} flex min-h-screen items-center justify-center bg-[#eefaf5] px-4`}>
        <div className="flex items-center gap-3 rounded-[1.6rem] border border-white/80 bg-white/92 px-5 py-4 shadow-[0_18px_40px_rgba(110,174,155,0.18)]">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          <span className="text-sm font-medium text-slate-700">Preparing driver dashboard...</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`${poppins.className} relative flex min-h-dvh items-center justify-center overflow-x-hidden bg-[radial-gradient(circle_at_top,rgba(241,251,247,1),rgba(229,247,239,0.97)_46%,rgba(218,242,232,0.96)_100%)] px-2 py-3 sm:min-h-screen sm:px-4 sm:py-8`}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[4%] h-[18rem] w-[18rem] rounded-full bg-white/58 blur-[80px]" />
        <div className="absolute right-[-8%] top-[12%] h-[22rem] w-[22rem] rounded-full bg-emerald-100/55 blur-[95px]" />
        <div className="absolute bottom-[-8%] left-[18%] h-[16rem] w-[16rem] rounded-full bg-sky-100/55 blur-[85px]" />
      </div>
      <Toaster position="top-right" />

      <div className="relative z-[1] w-full max-w-[400px]">
        <div className="relative overflow-hidden rounded-[22px] border border-white/55 bg-white/38 px-3 pb-3 pt-3 shadow-[0_22px_70px_rgba(81,136,119,0.18)] backdrop-blur-[14px] sm:rounded-[26px] sm:px-4 sm:pb-4 sm:pt-4">
          <DriverRouteArtwork />

          <div className="relative z-[1] flex flex-col items-center">
            <div className="flex h-14 w-14 items-center justify-center sm:h-16 sm:w-16">
              <img
                src="/aab-trading-logo.png"
                alt="AAB Trading Driver"
                className="h-full w-full object-contain drop-shadow-[0_10px_25px_rgba(31,86,145,0.18)]"
              />
            </div>

            <p className="mt-2.5 text-center text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-[#199154] sm:mt-3 sm:text-[0.7rem]">
              ANN ANN&apos;S BEVERAGES TRADING
            </p>

            <h1 className="mt-3 text-center leading-[0.96] tracking-[-0.04em]">
              <span className="block text-[1.8rem] font-extrabold text-[#0a4286] sm:text-[2.2rem]">
                AAB TRADING
              </span>
              <span className="mt-2 flex items-center justify-center gap-2 sm:gap-3">
                <DriverSpeedLines className="h-2 w-6 sm:h-3 sm:w-8" />
                <span className="text-[2rem] font-extrabold text-[#13a455] sm:text-[2.4rem]">
                  DRIVER
                </span>
                <DriverSpeedLines className="h-2 w-6 scale-x-[-1] sm:h-3 sm:w-8" />
              </span>
            </h1>

            <p className="mt-3 max-w-[20rem] text-center text-[0.85rem] font-medium leading-[1.35] text-[#4d5878] sm:mt-4 sm:text-[0.95rem]">
              Sign in to start routes and track drops in real time.
            </p>

            <div className="relative mt-4 w-full rounded-[20px] border border-[#d7eee5] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(251,255,252,0.93))] px-3 py-3 shadow-[0_16px_40px_rgba(127,180,157,0.14)] sm:mt-5 sm:rounded-[24px] sm:px-3.5 sm:py-3.5">
              <form onSubmit={handleLogin} autoComplete="off" className="space-y-3 sm:space-y-3.5">
                <div className="space-y-1.5 sm:space-y-2.5">
                  <div className="px-1 text-[0.78rem] font-bold text-[#12356a] sm:text-[0.85rem]">Email</div>
                  <label className="flex items-center gap-2.5 rounded-[16px] border border-[#cfeadf] bg-white/94 px-3 py-2 shadow-[0_8px_24px_rgba(151,193,177,0.14)] sm:gap-3 sm:rounded-[18px] sm:px-3.5 sm:py-2.5">
                    <FieldIconTile>
                      <Mail className="h-5 w-5 text-[#179651]" strokeWidth={1.9} />
                    </FieldIconTile>
                    <span className="min-w-0 flex-1">
                      <input
                        id="driver-email"
                        type="email"
                        autoComplete="off"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter email"
                        required
                        className="block w-full border-0 bg-transparent p-0 text-[0.84rem] font-medium text-[#283662] outline-none placeholder:text-[#98a5c0] sm:text-[0.9rem]"
                      />
                    </span>
                  </label>
                </div>

                <div className="space-y-1.5 sm:space-y-2.5">
                  <div className="px-1 text-[0.78rem] font-bold text-[#12356a] sm:text-[0.85rem]">Password</div>
                  <label className="flex items-center gap-2.5 rounded-[16px] border border-[#cfeadf] bg-white/94 px-3 py-2 shadow-[0_8px_24px_rgba(151,193,177,0.14)] sm:gap-3 sm:rounded-[18px] sm:px-3.5 sm:py-2.5">
                    <FieldIconTile>
                      <LockKeyhole className="h-5 w-5 text-[#179651]" strokeWidth={1.9} />
                    </FieldIconTile>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2.5">
                        <input
                          id="driver-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter password"
                          required
                          className="block min-w-0 flex-1 border-0 bg-transparent p-0 text-[0.84rem] font-medium text-[#283662] outline-none placeholder:text-[#98a5c0] sm:text-[0.9rem]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[#6f7b96] transition-colors hover:text-[#27446c]"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" strokeWidth={1.9} />
                          ) : (
                            <Eye className="h-4 w-4" strokeWidth={1.9} />
                          )}
                        </button>
                      </span>
                    </span>
                  </label>
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 px-1 pt-1 text-[0.8rem] font-medium text-[#24375f] sm:text-[0.85rem]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.5rem] bg-[linear-gradient(180deg,#14a850,#0d9944)] text-white shadow-[0_6px_18px_rgba(20,168,80,0.28)] transition peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-200">
                    <Check className={`h-3 w-3 transition ${rememberMe ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                  </span>
                  <span>Keep me logged in</span>
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex h-11 w-full items-center justify-between rounded-[999px] bg-[linear-gradient(90deg,#17b058,#119a4a)] px-4 text-white shadow-[0_14px_30px_rgba(22,168,80,0.28)] transition hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-80 sm:h-12 sm:px-4"
                >
                  <span className="w-7 sm:w-8" />
                  <span className="flex items-center justify-center gap-2 text-[0.95rem] font-bold sm:text-[1.05rem]">
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Log In
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/24 text-white sm:h-10 sm:w-10">
                    <ArrowRight className="h-4 w-4 sm:h-4 sm:w-4" strokeWidth={2.6} />
                  </span>
                </button>

                <div className="flex items-center gap-4 pt-2 text-[#49546f] sm:gap-6">
                  <div className="h-px flex-1 bg-[#d8dee8]" />
                  <span className="text-[0.82rem]">or</span>
                  <div className="h-px flex-1 bg-[#d8dee8]" />
                </div>

                <div className="flex justify-center pt-1">
                  <ForgotPasswordDialog
                    accountType="staff"
                    initialEmail={email}
                    triggerClassName="inline-flex items-center gap-2.5 text-[0.85rem] font-medium text-[#16984e] transition hover:text-[#107e41] sm:text-[0.9rem]"
                    triggerContent={
                      <>
                        <LockKeyhole className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.1} />
                        <span>Forgot password?</span>
                      </>
                    }
                  />
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
