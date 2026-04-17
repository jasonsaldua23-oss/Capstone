'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearTabAuthToken, setTabAuthToken } from '@/lib/client-auth'
import { resolvePortalFromUser } from '@/components/auth/portal-auth-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster } from '@/components/ui/sonner'
import { Loader2, Truck } from 'lucide-react'
import { toast } from 'sonner'

export function DriverLoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

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
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json()

      if (!response.ok || !data.success || !data.user) {
        toast.error(data.error || 'Login failed')
        return
      }

      if (resolvePortalFromUser(data.user) !== 'driver') {
        if (data.token) clearTabAuthToken()
        await fetch('/api/auth/logout', { method: 'POST' })
        toast.error('This account does not belong to the Driver Portal.')
        return
      }

      if (data.token) setTabAuthToken(data.token)
      toast.success('Welcome to Driver Portal')
      router.replace('/')
    } catch {
      toast.error('An error occurred during login')
    } finally {
      setIsLoading(false)
    }
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-200" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-emerald-950 flex items-center justify-center px-4 py-10">
      <Toaster position="top-right" />
      <Card className="w-full max-w-md border-zinc-700 bg-zinc-900/90 shadow-2xl shadow-emerald-950/40 backdrop-blur">
        <CardHeader className="space-y-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-400/30">
            <Truck className="h-5 w-5" />
          </div>
          <CardTitle className="text-white text-2xl">Driver Portal Login</CardTitle>
          <CardDescription className="text-zinc-300">Sign in with your driver account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="driver-email" className="text-zinc-200">Email</Label>
              <Input id="driver-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="driver@logistics.com" required className="h-11 border-zinc-600 bg-zinc-800/80 text-white placeholder:text-zinc-400 focus-visible:ring-emerald-400" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-password" className="text-zinc-200">Password</Label>
              <Input id="driver-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" required className="h-11 border-zinc-600 bg-zinc-800/80 text-white placeholder:text-zinc-400 focus-visible:ring-emerald-400" />
            </div>
            <Button type="submit" className="w-full h-11 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-600 hover:to-emerald-500" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
