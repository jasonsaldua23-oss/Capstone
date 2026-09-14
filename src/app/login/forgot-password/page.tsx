import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { ForgotPasswordScreen } from '@/components/auth/ForgotPasswordScreen'
import { getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  title: 'Reset Password | Ann Ann\'s Beverages Trading',
}

export default function NeutralForgotPasswordRoute() {
  const variant = resolveAppVariant()
  if (variant !== 'all') {
    // Installable and single-portal deployments must remain inside their own scope.
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return (
    <Suspense fallback={null}>
      <ForgotPasswordScreen resetMode="unified" loginHref="/login" />
    </Suspense>
  )
}
