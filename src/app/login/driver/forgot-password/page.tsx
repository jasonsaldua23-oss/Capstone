import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { ForgotPasswordScreen } from '@/components/auth/ForgotPasswordScreen'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  title: 'Forgot Password | AAB TRADING',
}

export default function DriverForgotPasswordRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return (
    <Suspense fallback={null}>
      <ForgotPasswordScreen accountType="staff" portal="driver" />
    </Suspense>
  )
}
