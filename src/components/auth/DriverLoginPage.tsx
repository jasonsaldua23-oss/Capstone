'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Poppins } from 'next/font/google'
import { Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, MapPin } from 'lucide-react'
import { clearTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const DRIVER_CARD_FALLBACK_WIDTH = 420
const DRIVER_CARD_FALLBACK_HEIGHT = 740

function DriverRouteArtwork() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-white" />
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

function DriverLoginBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.96),rgba(246,252,248,0.94)_34%,rgba(237,249,243,0.9)_58%,rgba(230,246,239,0.86)_100%)]" />
      <div className="absolute left-[-9rem] top-[5%] h-[18rem] w-[18rem] rounded-full bg-white/88 blur-[26px]" />
      <div className="absolute right-[-10rem] top-[8%] h-[28rem] w-[28rem] rounded-full bg-emerald-100/40 blur-[54px]" />
      <div className="absolute bottom-[-10rem] left-[-8rem] h-[21rem] w-[21rem] rounded-full bg-[#dff5ea]/80 blur-[22px]" />
      <div className="absolute bottom-[-12rem] right-[-10rem] h-[31rem] w-[31rem] rounded-full bg-[#dff7ea]/58 blur-[28px]" />

      <div className="absolute -left-[16rem] top-[25%] h-[40rem] w-[40rem] rounded-full opacity-65 [background-image:radial-gradient(circle,rgba(174,231,205,0.7)_0_2px,transparent_2.8px)] [background-size:16px_16px] [mask-image:radial-gradient(circle_at_58%_50%,transparent_0_49%,black_52%_65%,transparent_68%)]" />
      <div className="absolute right-[-11rem] top-[-11rem] h-[28rem] w-[28rem] rounded-full opacity-65 [background-image:radial-gradient(circle,rgba(174,231,205,0.68)_0_2px,transparent_2.8px)] [background-size:16px_16px] [mask-image:radial-gradient(circle_at_32%_68%,transparent_0_44%,black_49%_61%,transparent_66%)]" />
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
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [layoutScale, setLayoutScale] = useState(1)
  const [frameWidth, setFrameWidth] = useState(DRIVER_CARD_FALLBACK_WIDTH)
  const [frameHeight, setFrameHeight] = useState(DRIVER_CARD_FALLBACK_HEIGHT)
  const cardRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (typeof window === 'undefined') return

    let frameId = 0

    const updateLayoutScale = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const mobileViewport = window.innerWidth < 768
        const measuredWidth = cardRef.current?.offsetWidth ?? DRIVER_CARD_FALLBACK_WIDTH
        const measuredHeight = cardRef.current?.offsetHeight ?? DRIVER_CARD_FALLBACK_HEIGHT
        const horizontalPadding = mobileViewport ? 0 : 104
        const verticalPadding = mobileViewport ? 4 : 80
        const availableWidth = Math.max(window.innerWidth - horizontalPadding, 280)
        const availableHeight = Math.max(window.innerHeight - verticalPadding, 520)
        const maxScale = 1
        const nextScale = Math.min(
          availableWidth / measuredWidth,
          availableHeight / measuredHeight,
          maxScale
        )

        setIsMobileViewport(mobileViewport)
        setFrameWidth(measuredWidth)
        setFrameHeight(measuredHeight)
        setLayoutScale(Number(nextScale.toFixed(4)))
      })
    }

    updateLayoutScale()
    window.addEventListener('resize', updateLayoutScale)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateLayoutScale)
    }
  }, [isCheckingSession])

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

  const scaledFrameStyle = {
    width: `${Math.ceil(frameWidth * layoutScale)}px`,
    height: `${Math.ceil(frameHeight * layoutScale)}px`,
  }

  const scaledCardStyle = {
    width: '26.25rem',
    transform: `scale(${layoutScale})`,
    transformOrigin: 'center center' as const,
  }

  return (
    <div
      className={`${poppins.className} relative flex min-h-dvh items-center justify-center overflow-x-hidden overflow-y-auto bg-[#eaf1f2] bg-cover bg-center bg-no-repeat px-0 py-1 md:min-h-screen md:px-12 md:py-10`}
      style={{ backgroundImage: "url('/customer-login-bg.png')" }}
    >
      <Toaster position="top-right" />

      <div className="relative z-[1] flex w-full justify-center">
        <div className="flex items-center justify-center" style={scaledFrameStyle}>
        <div
          ref={cardRef}
          className="relative shrink-0 max-w-none"
          style={scaledCardStyle}
        >
        <div className="relative overflow-hidden rounded-[1.35rem] border border-white/70 bg-white px-4 pb-3 pt-3 shadow-[0_18px_52px_rgba(81,136,119,0.15)] backdrop-blur-[18px]">
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
                <div className="space-y-2.5">
                  <div className="px-1 text-[0.85rem] font-bold text-[#12356a]">Email</div>
                  <label className={`flex h-12 items-center gap-2.5 rounded-[14px] border px-3 shadow-[0_6px_18px_rgba(151,193,177,0.12)] ${loginError ? 'border-[#e18b90] bg-[#fff7f8]' : 'border-[#cfeadf] bg-white/95'}`}>
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
                        className="block w-full border-0 bg-transparent p-0 text-[0.95rem] font-medium text-[#283662] outline-none placeholder:text-[#98a5c0]"
                      />
                    </span>
                  </label>
                </div>

                <div className="space-y-2.5">
                  <div className="px-1 text-[0.85rem] font-bold text-[#12356a]">Password</div>
                  <label className={`flex h-12 items-center gap-2.5 rounded-[14px] border px-3 shadow-[0_6px_18px_rgba(151,193,177,0.12)] ${loginError ? 'border-[#e18b90] bg-[#fff7f8]' : 'border-[#cfeadf] bg-white/95'}`}>
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
                          className="block min-w-0 flex-1 border-0 bg-transparent p-0 text-[0.95rem] font-medium text-[#283662] outline-none placeholder:text-[#98a5c0]"
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

                <label className="flex cursor-pointer items-center gap-2.5 px-1 pt-1 text-[0.85rem] font-medium text-[#24375f]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.5rem] border border-[#cfeadf] text-white shadow-[0_6px_18px_rgba(20,168,80,0.12)] transition peer-focus-visible:ring-4 peer-focus-visible:ring-emerald-200 ${
                    rememberMe
                      ? 'bg-[linear-gradient(180deg,#14a850,#0d9944)] border-transparent shadow-[0_6px_18px_rgba(20,168,80,0.28)]'
                      : 'bg-white'
                  }`}>
                    <Check className={`h-3 w-3 transition ${rememberMe ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                  </span>
                  <span>Keep me logged in</span>
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex h-12 w-full items-center justify-center rounded-[999px] bg-[linear-gradient(90deg,#17b058,#119a4a)] px-4 text-white shadow-[0_14px_30px_rgba(22,168,80,0.28)] transition hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-80"
                >
                  <span className="flex items-center justify-center gap-2 text-[1.05rem] font-bold">
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Log In
                  </span>
                </button>

                <div className="flex justify-center pt-1">
                  <ForgotPasswordDialog
                    accountType="staff"
                    portal="driver"
                    initialEmail={email}
                    triggerClassName="inline-flex items-center gap-2.5 text-[0.9rem] font-medium text-[#16984e] transition hover:text-[#107e41]"
                    triggerContent={
                      <>
                        <LockKeyhole className="h-5 w-5" strokeWidth={2.1} />
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
      </div>
    </div>
  )
}
