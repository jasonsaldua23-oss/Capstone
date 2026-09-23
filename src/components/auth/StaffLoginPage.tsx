'use client'

import { LoginSuccess } from '@/components/shared/login-success'
import { OtpVerificationPanel } from '@/components/shared/otp-verification-modal'
import { NativeGoogleButton } from '@/components/auth/native-google-button'
import { forgotPasswordHref, resolvePortalFromUser, type LoginPortal } from '@/components/auth/portal-auth-utils'
import { apiWrite } from '@/lib/api-write'
import { clearTabAuthToken, getTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { resolveAppVariant } from '@/lib/app-variant'
import { getLockedPortal } from '@/lib/native/portal-lock'
import { isNativeApp } from '@/lib/native/platform'
import { homePathForPortal } from '@/lib/portal-scope'
import { retryingApiRead } from '@/lib/retrying-api-read'
import type { AuthUser } from '@/types'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { renderGoogleIdentityButton } from './google-button-config'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'

const poppins = { className: '' }

type LoginMethod = 'password' | 'google'

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

function isSupportedSystemUser(user: unknown): user is AuthUser {
  if (!user || typeof user !== 'object') return false
  const candidate = user as Partial<AuthUser>
  const role = String(candidate.role || '').trim().toUpperCase()
  if (candidate.type === 'customer') return true
  return candidate.type === 'staff' && ['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_STAFF', 'DRIVER'].includes(role)
}

function getRequiredSystemPortal(): LoginPortal | null {
  // A portal-specific Capacitor shell must not retain a session it cannot open.
  const lockedPortal = getLockedPortal()
  if (lockedPortal) return lockedPortal

  const variant = resolveAppVariant()
  return variant === 'all' ? null : variant
}

function persistWelcomeState(portal: LoginPortal, user: AuthUser) {
  if (typeof window === 'undefined') return
  try {
    const name = String(user.name || '').trim()
    if (portal === 'customer') {
      window.sessionStorage.setItem('customer_welcome_state', JSON.stringify({ mode: 'existing', name, ts: Date.now() }))
      return
    }
    if (portal === 'driver') {
      window.sessionStorage.setItem('driver_welcome_state', JSON.stringify({ name, ts: Date.now() }))
      return
    }

    const rawUser = user as AuthUser & {
      isNewUser?: boolean
      isNew?: boolean
      isFirstLogin?: boolean
      firstLogin?: boolean
    }
    const isNewUser = Boolean(rawUser.isNewUser ?? rawUser.isNew ?? rawUser.isFirstLogin ?? rawUser.firstLogin)
    window.sessionStorage.setItem(
      portal === 'admin' ? 'admin_welcome_state' : 'warehouse_welcome_state',
      JSON.stringify({ mode: isNewUser ? 'new' : 'existing', name, ts: Date.now() }),
    )
  } catch {
    // Storage is only presentation state; authentication can continue without it.
  }
}

type SystemLoginPageProps = {
  /**
   * Retains each existing scoped URL for session restore. The credentials
   * themselves are evaluated against the account's actual role.
   */
  entryPortal: LoginPortal
  /** Keeps the shared-browser registration flow on its neutral /login URL. */
  registrationHref?: string
  /** Keeps the shared-browser recovery flow on its neutral /login URL. */
  forgotPasswordPath?: string
  /** Null makes the shared /login route a fresh, tab-independent sign-in. */
  restorePortal?: LoginPortal | null
}

function withPrefilledEmail(path: string, email: string): string {
  const trimmed = String(email || '').trim()
  if (!trimmed) return path
  return `${path}${path.includes('?') ? '&' : '?'}email=${encodeURIComponent(trimmed)}`
}

/**
 * Shared system entry point. Scoped route wrappers preserve Capacitor's path lock
 * while the authenticated account type decides which portal opens after sign-in.
 */
export function SystemLoginPage({
  entryPortal,
  registrationHref = '/customer/login?mode=register',
  forgotPasswordPath,
  restorePortal,
}: SystemLoginPageProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [loginSucceeded, setLoginSucceeded] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
  const [challengeToken, setChallengeToken] = useState('')
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password')
  const [googleCredential, setGoogleCredential] = useState('')
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleRequestInFlightRef = useRef(false)
  const googleClientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim()
  const isAppShell = useSyncExternalStore(
    () => () => {},
    () => isNativeApp(),
    () => false,
  )
  const googleSignInAvailable = Boolean(googleClientId) && !isAppShell
  // A neutral browser URL cannot safely choose between separate Customer/staff cookies.
  const scopedRestorePortal = restorePortal === undefined ? entryPortal : restorePortal

  const revokeRejectedSession = useCallback(async (token?: string) => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch {
      // The local token is cleared below even if a disconnect prevents logout.
    }
    clearTabAuthToken()
  }, [])

  const completeSystemLogin = useCallback(async (user: unknown, token: unknown, persistent: boolean) => {
    if (!isSupportedSystemUser(user)) {
      setLoginError('This account cannot access the system.')
      return false
    }

    const portal = resolvePortalFromUser(user)
    const requiredPortal = getRequiredSystemPortal()
    if (requiredPortal && requiredPortal !== portal) {
      // Fix: never leave any account session in a portal-specific native or single-role app.
      await revokeRejectedSession(typeof token === 'string' ? token : undefined)
      setLoginError('This account is not available in this app.')
      return false
    }

    persistWelcomeState(portal, user)
    if (typeof token === 'string' && token) setTabAuthToken(token, { persistent })
    setLoginSucceeded(true)
    window.sessionStorage.setItem('login-success-pending', portal)
    router.replace(homePathForPortal(portal))
    return true
  }, [revokeRejectedSession, router])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function checkSession() {
      try {
        // Fix: a tab opened from another tab can inherit a copy of sessionStorage.
        // The neutral login must still allow a different account without revoking
        // or replacing the account that remains active in the original tab.
        if (scopedRestorePortal === null) return
        const tabAuthToken = getTabAuthToken()
        const response = await retryingApiRead(
          // Scoped native/app routes retain their existing cookie or tab-token restore.
          (signal) => fetch('/api/auth/me', {
            signal,
            cache: 'no-store',
            credentials: 'include',
            headers: {
              ...(scopedRestorePortal ? { 'X-Portal': scopedRestorePortal } : {}),
              ...(tabAuthToken ? { Authorization: `Bearer ${tabAuthToken}` } : {}),
            },
          }),
          controller.signal,
        )
        if (cancelled || !response.ok) return
        const data = await response.json().catch(() => null)
        if (!isSupportedSystemUser(data?.user)) return
        const portal = resolvePortalFromUser(data.user)
        const requiredPortal = getRequiredSystemPortal()
        if (requiredPortal && requiredPortal !== portal) {
          await revokeRejectedSession(typeof data?.token === 'string' ? data.token : undefined)
          return
        }
        if (data?.token) setTabAuthToken(data.token, { persistent: Boolean(data.user.rememberMe) })
        router.replace(homePathForPortal(portal))
      } catch (error) {
        console.warn('System session check timed out or failed:', error)
      } finally {
        if (!cancelled) setIsCheckingSession(false)
      }
    }

    void checkSession()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [revokeRejectedSession, router, scopedRestorePortal])

  const submitPasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoginError('')
    setIsLoading(true)
    setLoginMethod('password')

    try {
      const response = await apiWrite(() => fetch('/api/auth/unified/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // The server selects the existing account type; this URL is only a scoped entry route.
        body: JSON.stringify({ email, password, rememberMe }),
      }), { fallbackError: null })
      const data = await response.json().catch(() => null)

      if (response.status === 202 && data?.requiresTwoFactor && data?.challengeToken) {
        setChallengeToken(String(data.challengeToken))
        setRequiresTwoFactor(true)
        toast.success(data.message || 'Verification code sent to your email')
        return
      }

      if (!response.ok || !data?.success || !data?.user) {
        const apiError = String(data?.error || data?.message || '').trim()
        const credentialError = response.status === 401 || response.status === 403 || /invalid|credential|password/i.test(apiError)
        if (credentialError) setLoginError('Invalid email or password.')
        else if (apiError) toast.error(apiError)
        return
      }

      await completeSystemLogin(data.user, data.token, rememberMe)
    } catch (error) {
      console.error('Staff password login failed unexpectedly:', error)
      toast.error('Unable to reach authentication service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const submitGoogleCredential = useCallback(async (credential: string, isResend = false): Promise<boolean> => {
    if (!credential || googleRequestInFlightRef.current) return false
    googleRequestInFlightRef.current = true
    setLoginError('')
    setIsLoading(true)
    setLoginMethod('google')

    try {
      const response = await apiWrite(() => fetch('/api/auth/unified/google', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        // Google sign-in always uses the same persistent session as "Keep me logged in".
        body: JSON.stringify({ credential, rememberMe: true }),
      }), { fallbackError: null })
      const data = await response.json().catch(() => null)

      if (response.status === 202 && data?.requiresTwoFactor && data?.challengeToken) {
        setChallengeToken(String(data.challengeToken))
        setGoogleCredential(credential)
        // Google does not expose the address to the browser, so use the verified server response for the OTP page.
        if (data?.email) setEmail(String(data.email))
        setRequiresTwoFactor(true)
        if (!isResend) toast.success(data.message || 'Verification code sent to your email')
        return true
      }

      if (!response.ok || !data?.success || !data?.user) {
        const apiError = String(data?.error || data?.message || '').trim()
        toast.error(apiError || (response.status >= 500
          ? 'Google sign-in is temporarily unavailable. Please use email and password for now.'
          : 'Google authentication failed.'))
        return false
      }

      return completeSystemLogin(data.user, data.token, true)
    } catch (error) {
      console.error('Staff Google login failed unexpectedly:', error)
      toast.error('Unable to reach Google sign-in. Please check your connection and try again.')
      return false
    } finally {
      googleRequestInFlightRef.current = false
      setIsLoading(false)
    }
  }, [completeSystemLogin])

  const renderGoogleButton = useCallback(() => {
    if (!googleSignInAvailable || !googleButtonRef.current || !window.google?.accounts?.id) return
    try {
      const target = googleButtonRef.current
      target.innerHTML = ''
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response: { credential?: string }) => {
          if (response.credential) void submitGoogleCredential(response.credential)
          else toast.error('Google authentication failed. Please try again.')
        },
      })
      // Size, and the reason it is capped under 200px, live in one place now.
      renderGoogleIdentityButton(target, window.google.accounts.id)
    } catch (error) {
      console.warn('Unable to render system Google sign-in:', error)
    }
  }, [googleClientId, googleSignInAvailable, submitGoogleCredential])

  useEffect(() => {
    if (!googleSignInAvailable || requiresTwoFactor || isCheckingSession) return
    const timer = window.setTimeout(renderGoogleButton, 60)
    return () => window.clearTimeout(timer)
  }, [googleSignInAvailable, isCheckingSession, renderGoogleButton, requiresTwoFactor])

  useEffect(() => {
    if (!googleSignInAvailable) return
    let timer: number | undefined
    const rerender = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(renderGoogleButton, 200)
    }
    window.addEventListener('resize', rerender)
    return () => {
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('resize', rerender)
    }
  }, [googleSignInAvailable, renderGoogleButton])

  const verifyLoginOtp = async (otp: string) => {
    try {
      const response = await fetch('/api/auth/login/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, otp }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success || !data?.user) {
        toast.error(data?.error || 'Invalid or expired verification code.')
        return false
      }
      return completeSystemLogin(data.user, data.token, loginMethod === 'google' ? true : rememberMe)
    } catch {
      toast.error('Unable to verify the code. Please try again.')
      return false
    }
  }

  const resendLoginOtp = async () => {
    if (loginMethod === 'google') return submitGoogleCredential(googleCredential, true)

    try {
      const response = await fetch('/api/auth/unified/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, rememberMe }),
      })
      const data = await response.json().catch(() => null)
      if (response.status === 202 && data?.challengeToken) {
        setChallengeToken(String(data.challengeToken))
        return true
      }
      toast.error(data?.error || 'Failed to resend verification code.')
    } catch {
      toast.error('Unable to resend the verification code.')
    }
    return false
  }

  if (loginSucceeded) return <LoginSuccess />

  if (isCheckingSession) {
    return (
      <div
        className={`${poppins.className} flex min-h-dvh items-center justify-center bg-[#eaf1f2] bg-cover bg-center bg-no-repeat px-4 sm:min-h-screen`}
        style={{ backgroundImage: "url('/customer-login-bg.png')" }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-[#0f4fd3]" aria-label="Checking session" />
      </div>
    )
  }

  if (requiresTwoFactor) {
    return (
      <div className={`${poppins.className} min-h-dvh bg-white px-6 pb-10 pt-4 sm:min-h-screen`}>
        <Toaster position="top-right" />
        <div className="mx-auto flex w-full max-w-md flex-col">
          <OtpVerificationPanel
            open
            variant="page"
            theme="blue"
            email={email.trim().toLowerCase()}
            onVerify={verifyLoginOtp}
            onResendCode={resendLoginOtp}
            onOpenChange={(open) => {
              if (open) return
              setRequiresTwoFactor(false)
              setChallengeToken('')
              setGoogleCredential('')
              setLoginMethod('password')
              setLoginError('')
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <main
      className={`${poppins.className} flex min-h-dvh items-center justify-center bg-[#eaf1f2] bg-cover bg-center bg-no-repeat px-4 py-8 sm:min-h-screen`}
      style={{ backgroundImage: "url('/customer-login-bg.png')" }}
    >
      {googleSignInAvailable ? (
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={renderGoogleButton} />
      ) : null}
      <Toaster position="top-right" />
      {/* Tightened: avoid stacking the card's default padding with large header/content spacing. */}
      <Card className="w-full max-w-[420px] gap-4 rounded-[24px] border border-[#dce3ec] bg-white/95 py-4 shadow-[0_16px_42px_rgba(15,23,42,0.14)] backdrop-blur-sm">
        <CardHeader className="space-y-2 pb-0 pt-2">
          <div className="mx-auto flex h-[112px] w-[112px] items-center justify-center overflow-hidden">
            <img src="/ann-anns-logo.png" alt="Ann Ann's Beverages Trading logo" className="h-full w-full object-contain" />
          </div>
          <CardTitle className="text-center text-2xl font-extrabold leading-tight text-[#112b60]">
            Ann Ann&apos;s Beverages Trading
          </CardTitle>
          <CardDescription className="text-center text-[15px] text-[#7a89a6]">
            Sign in to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-7 pb-2">
          <form onSubmit={submitPasswordLogin} autoComplete="off" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="staff-email" className="text-sm font-semibold text-[#1f3566]">Email</Label>
              <div className={`relative h-11 rounded-xl border bg-white ${loginError ? 'border-rose-300' : 'border-[#d6deea]'}`}>
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a99b3]" />
                {/* Fix: keep the shared login page blank instead of presenting saved credentials as defaults. */}
                <Input
                  id="staff-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (loginError) setLoginError('')
                  }}
                  placeholder="Enter email"
                  required
                  className="h-full border-0 bg-transparent pl-10 text-slate-900 placeholder:text-[#9aa8bf] focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-password" className="text-sm font-semibold text-[#1f3566]">Password</Label>
              <div className={`relative h-11 rounded-xl border bg-white ${loginError ? 'border-rose-300' : 'border-[#d6deea]'}`}>
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a99b3]" />
                <Input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (loginError) setLoginError('')
                  }}
                  placeholder="Enter password"
                  required
                  className="h-full border-0 bg-transparent pl-10 pr-11 text-slate-900 placeholder:text-[#9aa8bf] focus-visible:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {loginError ? <p className="text-sm text-rose-600" role="alert">{loginError}</p> : null}
            </div>

            {/* Formal auth layout: keep the recovery link with the related session option. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <label className="flex items-center gap-2 py-2.5 text-sm text-[#445877]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-[#ccd6e4] text-[#1f56d8] focus:ring-[#1f56d8]"
                />
                Keep me logged in
              </label>
              <Link
                href={forgotPasswordPath ? withPrefilledEmail(forgotPasswordPath, email) : forgotPasswordHref(entryPortal, email)}
                className="inline-flex items-center rounded-sm py-2.5 text-sm font-medium text-[#1f4f9f] underline-offset-4 transition-colors hover:text-[#0f4fd3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f4fd3] focus-visible:ring-offset-2"
              >
                Forgot your password?
              </Link>
            </div>

            <Button
              type="submit"
              className="h-11 w-full rounded-[10px] bg-[#0f4fd3] text-white shadow-[0_10px_20px_rgba(15,79,211,0.24)] hover:bg-[#0b45bf]"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Log in
            </Button>

            <div className="my-3">
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-[#dce5e6]" /></div>
                <span className="relative bg-white px-3 text-xs font-semibold tracking-wide text-[#7f8fa5]">OR CONTINUE WITH</span>
              </div>
            </div>

            {googleSignInAvailable ? (
              <div className="flex w-full justify-center">
                <div className="flex h-11 w-full items-center justify-center">
                  <div ref={googleButtonRef} />
                </div>
              </div>
            ) : isAppShell ? (
              <div className="flex w-full justify-center">
                <NativeGoogleButton
                  disabled={isLoading}
                  onCredential={(credential) => { void submitGoogleCredential(credential) }}
                  onError={(message) => toast.error(message)}
                />
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">Google sign-in is not configured yet.</p>
            )}

            {entryPortal === 'customer' ? (
              <p className="pt-1 text-center text-sm text-[#445877]">
                New customer?{' '}
                <Link href={registrationHref} className="inline-block py-3 font-semibold text-[#16984e] hover:text-[#107e41]">
                  Create an account
                </Link>
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

/** Backwards-compatible export for existing route wrappers during the auth transition. */
export function StaffLoginPage(props: SystemLoginPageProps) {
  return <SystemLoginPage {...props} />
}
