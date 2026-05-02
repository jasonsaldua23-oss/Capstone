'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

export function WarehouseLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
        router.replace('/')
      } catch (error) {
        console.warn('Warehouse session check timed out or failed:', error)
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
        body: JSON.stringify({ email, password, rememberMe, portal: 'warehouse' }),
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

      if (resolvePortalFromUser(data.user) !== 'warehouse') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        toast.error('Invalid credentials')
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Welcome to Warehouse Portal')
      router.replace('/')
    } catch {
      toast.error('Unable to reach login service. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <Toaster position="top-right" />
      <Card className="w-full max-w-md border-slate-200 bg-white shadow-xl">
        <CardHeader className="space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <img
              src="/ann-anns-logo.png"
              alt="Ann Ann's Beverages Trading logo"
              className="h-full w-full object-contain p-1"
            />
          </div>
          <CardTitle className="text-slate-900 text-2xl text-center">Ann Ann&apos;s Beverages Trading Warehouse Staff</CardTitle>
          <CardDescription className="text-slate-500 text-center">Log in with your warehouse staff account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} autoComplete="off" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="warehouse-email" className="text-slate-700">Email</Label>
              <Input id="warehouse-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email" required className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-indigo-500" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warehouse-password" className="text-slate-700">Password</Label>
              <div className="relative">
                <Input id="warehouse-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required className="h-11 border-slate-300 bg-white pr-11 text-slate-900 placeholder:text-slate-400 focus-visible:ring-indigo-500" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Keep me logged in
            </label>
            <Button type="submit" className="w-full h-11 bg-indigo-600 text-white hover:bg-indigo-700" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Log In
            </Button>
            <ForgotPasswordDialog
              accountType="staff"
              initialEmail={email}
              triggerClassName="w-full text-center text-sm text-slate-600 hover:text-slate-900 transition-colors"
            />
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
