'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setTabAuthToken } from '@/lib/client-auth'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'

export function CustomerLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')

  useEffect(() => {
    let cancelled = false

    async function checkSession() {
      try {
        const response = await fetch('/api/auth/me')
        if (!response.ok) return
        const data = await response.json()
        if (!data?.user) return
        if (resolvePortalFromUser(data.user) === 'customer') router.replace('/')
      } finally {
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
      const response = await fetch('/api/auth/customer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json()

      if (!response.ok || !data.success || !data.user) {
        toast.error(data.error || 'Login failed')
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Welcome to Customer Portal')
      router.replace('/')
    } catch {
      toast.error('An error occurred during login')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          phone,
          address,
          city,
          state,
          zipCode,
        }),
      })
      const data = await response.json()

      if (!response.ok || !data.success || !data.user) {
        toast.error(data.error || 'Registration failed')
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Account created successfully')
      router.replace('/')
    } catch {
      toast.error('An error occurred during registration')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-slate-700" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-sky-100 flex items-center justify-center px-4 py-10">
      <Toaster position="top-right" />
      <Card className="w-full max-w-md border-slate-200 bg-white/95 shadow-2xl shadow-sky-200/60 backdrop-blur">
        <CardHeader className="space-y-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700 ring-1 ring-sky-200">
            <Users className="h-5 w-5" />
          </div>
          <CardTitle className="text-slate-900 text-2xl">Customer Portal Login</CardTitle>
          <CardDescription className="text-slate-600">Sign in to track and manage your orders.</CardDescription>
        </CardHeader>
        <CardContent>
          {authMode === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="customer-email" className="text-slate-700">Email</Label>
                  <Input id="customer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customer-password" className="text-slate-700">Password</Label>
                  <Input id="customer-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                </div>
                <Button type="submit" className="w-full h-11 bg-gradient-to-r from-sky-600 to-cyan-500 hover:from-sky-500 hover:to-cyan-400" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Sign In
                </Button>
                <p className="text-center text-sm text-slate-600">
                  dont have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setAuthMode('register')}
                    className="font-medium text-fuchsia-600 hover:text-fuchsia-500"
                  >
                    Register
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name" className="text-slate-700">Full Name</Label>
                  <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email" className="text-slate-700">Email</Label>
                  <Input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password" className="text-slate-700">Password</Label>
                  <Input id="reg-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone" className="text-slate-700">Phone</Label>
                    <Input id="reg-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-city" className="text-slate-700">City</Label>
                    <Input id="reg-city" value={city} onChange={(e) => setCity(e.target.value)} className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-address" className="text-slate-700">Address</Label>
                  <Input id="reg-address" value={address} onChange={(e) => setAddress(e.target.value)} className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="reg-state" className="text-slate-700">State</Label>
                    <Input id="reg-state" value={state} onChange={(e) => setState(e.target.value)} className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-zip" className="text-slate-700">Zip Code</Label>
                    <Input id="reg-zip" value={zipCode} onChange={(e) => setZipCode(e.target.value)} className="h-11 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500" />
                  </div>
                </div>
                <Button type="submit" className="w-full h-11 bg-gradient-to-r from-sky-600 to-cyan-500 hover:from-sky-500 hover:to-cyan-400" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create Account
                </Button>
                <p className="text-center text-sm text-slate-600">
                  already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setAuthMode('login')}
                    className="font-medium text-fuchsia-600 hover:text-fuchsia-500"
                  >
                    Login
                  </button>
                </p>
              </form>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
