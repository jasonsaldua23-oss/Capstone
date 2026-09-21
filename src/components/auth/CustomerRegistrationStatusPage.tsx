'use client'

import { useRouter } from 'next/navigation'
import { Clock3, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type CustomerRegistrationStatusPageProps = {
  status: 'pending' | 'rejected'
  loginHref: string
}

export function CustomerRegistrationStatusPage({ status, loginHref }: CustomerRegistrationStatusPageProps) {
  const router = useRouter()
  const rejected = status === 'rejected'

  return (
    <div
      className="relative flex min-h-dvh items-center justify-center bg-[#eaf1f2] bg-cover bg-center px-4 py-8"
      style={{ backgroundImage: "url('/customer-login-bg.png')" }}
    >
      <Card className="relative z-[1] w-full max-w-md rounded-[24px] border border-[#dce3ec] bg-white/95 py-0 shadow-[0_16px_42px_rgba(15,23,42,0.14)]">
        <CardContent className="flex flex-col items-center px-6 py-9 text-center sm:px-9 sm:py-10">
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ${rejected ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
            {rejected ? <XCircle className="h-8 w-8" aria-hidden="true" /> : <Clock3 className="h-8 w-8" aria-hidden="true" />}
          </div>
          <h1 className="mt-5 text-2xl font-extrabold text-[#112b60]">
            {rejected ? 'Registration Rejected' : 'Account Pending Approval'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#5d6d88]">
            {rejected
              ? 'Your customer registration was not approved. Please contact the administrator if you need more information.'
              : 'Your account is under review. You can sign in after an administrator approves your registration.'}
          </p>
          <Button type="button" className="mt-7 w-full bg-[#1452a1] text-white hover:bg-[#0f4386]" onClick={() => router.replace(loginHref)}>
            Back to Login
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
