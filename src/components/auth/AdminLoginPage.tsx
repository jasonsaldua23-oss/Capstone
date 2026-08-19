'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Poppins } from 'next/font/google'
import { clearTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

export function AdminLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
  const [loginOtp, setLoginOtp] = useState('')
  const [challengeToken, setChallengeToken] = useState('')

  const persistAdminWelcomeState = (userData: any) => {
    if (typeof window === 'undefined') return
    try {
      const isNewUser = Boolean(
        userData?.isNewUser ??
        userData?.isNew ??
        userData?.isFirstLogin ??
        userData?.firstLogin
      )
      window.sessionStorage.setItem(
        'admin_welcome_state',
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
        const response = await fetch('/api/auth/me', { signal: controller.signal, cache: 'no-store', credentials: 'include' })
        if (!response.ok) return
        const data = await response.json()
        if (!data?.user) return
        router.replace('/')
      } catch (error) {
        console.warn('Admin session check timed out or failed:', error)
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe, portal: 'admin' }),
      })
      const rawBody = await response.text()
      let data: any = null
      try {
        data = rawBody ? JSON.parse(rawBody) : null
      } catch {
        data = null
      }

      if (response.status === 202 && data?.requiresTwoFactor && data?.challengeToken) {
        setRequiresTwoFactor(true)
        setChallengeToken(String(data.challengeToken))
        setLoginOtp('')
        toast.success('Verification code sent to your email')
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

      if (resolvePortalFromUser(data.user) !== 'admin') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        setLoginError('Invalid email or password.')
        return
      }

      persistAdminWelcomeState(data.user)
      // Keep the client token in persistent storage only when the user opted in.
      if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyLoginOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!challengeToken || !loginOtp.trim()) {
      setLoginError('Enter the verification code.')
      return
    }
    setLoginError('')
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/login/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, otp: loginOtp.trim(), portal: 'admin' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success || !data?.user) {
        setLoginError(String(data?.error || 'Invalid or expired verification code.'))
        return
      }
      if (resolvePortalFromUser(data.user) !== 'admin') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        setLoginError('Invalid email or password.')
        return
      }
      persistAdminWelcomeState(data.user)
      // The 2FA challenge preserves the same remember-me choice on the server and client.
      if (data.token) setTabAuthToken(data.token, { persistent: rememberMe })
      router.replace('/')
    } catch {
      toast.error('Unable to verify code. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div
        className={`${poppins.className} min-h-screen bg-[#eaf1f2] bg-cover bg-center bg-no-repeat flex items-center justify-center px-4`}
        style={{ backgroundImage: "url('/customer-login-bg.png')" }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div
      className={`${poppins.className} min-h-screen bg-[#eaf1f2] bg-cover bg-center bg-no-repeat flex items-center justify-center px-4 py-8`}
      style={{ backgroundImage: "url('/customer-login-bg.png')" }}
    >
      <Toaster position="top-right" />
      <Card className="w-full max-w-[420px] rounded-[24px] border border-[#dce3ec] bg-white/95 shadow-[0_16px_42px_rgba(15,23,42,0.14)] backdrop-blur-sm">
        <CardHeader className="space-y-2 pb-0 pt-6">
          <div className="mx-auto flex h-[112px] w-[112px] items-center justify-center overflow-hidden">
            <img
              src="/ann-anns-logo.png"
              alt="Ann Ann's Beverages Trading logo"
              className="h-full w-full object-contain"
            />
          </div>
          <CardTitle className=" text-[#112b60] text-center text-2xl font-extrabold leading-tight">
            <span className="block">Ann Ann&apos;s Beverages</span>
            <span className="block">Trading Admin</span>
          </CardTitle>
          <CardDescription className="text-[#7a89a6] text-center text-[15px]">Log in with your administrator credentials.</CardDescription>
        </CardHeader>
        <CardContent className="px-7 pb-6">
          <form onSubmit={requiresTwoFactor ? handleVerifyLoginOtp : handleLogin} autoComplete="off" className="space-y-3">
            {!requiresTwoFactor ? (
            <div className="space-y-2">
              <Label htmlFor="admin-email" className="text-[#1f3566] text-sm font-semibold">Email</Label>
              <div className={`relative h-11 rounded-xl border bg-white ${loginError ? 'border-rose-300' : 'border-[#d6deea]'}`}>
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a99b3]" />
                <Input id="admin-email" type="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); if (loginError) setLoginError('') }} placeholder="Enter email" required className="h-full border-0 bg-transparent pl-10 text-slate-900 placeholder:text-[#9aa8bf] focus-visible:ring-0" />
              </div>
            </div>
            ) : null}
            {!requiresTwoFactor ? (
            <div className="space-y-2">
              <Label htmlFor="admin-password" className="text-[#1f3566] text-sm font-semibold">Password</Label>
              <div className={`relative h-11 rounded-xl border bg-white ${loginError ? 'border-rose-300' : 'border-[#d6deea]'}`}>
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a99b3]" />
                <Input id="admin-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); if (loginError) setLoginError('') }} placeholder="Enter password" required className="h-full border-0 bg-transparent pl-10 pr-11 text-slate-900 placeholder:text-[#9aa8bf] focus-visible:ring-0" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {loginError ? <p className="text-sm text-rose-600">{loginError}</p> : null}
            </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="admin-login-otp" className="text-[#1f3566] text-sm font-semibold">Verification Code</Label>
                <div className={`relative h-11 rounded-xl border bg-white ${loginError ? 'border-rose-300' : 'border-[#d6deea]'}`}>
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a99b3]" />
                  <Input
                    id="admin-login-otp"
                    type="text"
                    autoComplete="one-time-code"
                    value={loginOtp}
                    onChange={(e) => { setLoginOtp(e.target.value); if (loginError) setLoginError('') }}
                    placeholder="Enter OTP code"
                    required
                    className="h-full border-0 bg-transparent pl-10 text-slate-900 placeholder:text-[#9aa8bf] focus-visible:ring-0"
                  />
                </div>
                {loginError ? <p className="text-sm text-rose-600">{loginError}</p> : null}
              </div>
            )}
            {!requiresTwoFactor ? (
            <label className="flex items-center gap-2 text-sm text-[#445877]">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-[#ccd6e4] text-[#1f56d8] focus:ring-[#1f56d8]"
              />
              Keep me logged in
            </label>
            ) : null}
            <Button type="submit" className="w-full h-11 rounded-[10px] bg-gradient-to-r from-[#0f4fd3] to-[#0b45bf] text-white shadow-[0_10px_20px_rgba(15,79,211,0.28)] hover:from-[#0d48c2] hover:to-[#093fae]" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Log In
            </Button>
            {requiresTwoFactor ? (
              <Button
                type="button"
                variant="outline"
                className="w-full h-10 rounded-[10px]"
                onClick={() => {
                  setRequiresTwoFactor(false)
                  setChallengeToken('')
                  setLoginOtp('')
                  setLoginError('')
                }}
              >
                Back to login
              </Button>
            ) : null}
            <ForgotPasswordDialog
              accountType="staff"
              portal="admin"
              initialEmail={email}
              triggerClassName="-mt-1 flex w-full items-center justify-center gap-2.5 text-[0.9rem] font-medium text-[#16984e] transition hover:text-[#107e41]"
              triggerContent={
                <>
                  <Lock className="h-4 w-4" />
                  <span className="text-[0.9rem] font-medium">Forgot password?</span>
                </>
              }
            />
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
