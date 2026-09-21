import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { CustomerLoginPage as CustomerRegistrationScreen } from '@/components/auth/CustomerLoginPage'
import { CustomerRegistrationStatusPage } from '@/components/auth/CustomerRegistrationStatusPage'
import { SystemLoginPage } from '@/components/auth/StaffLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  // Login stays inside the Customer PWA scope and retains its manifest identity.
  title: 'AAB SHOP',
  icons: {
    icon: '/aab-trading-shop.png',
    shortcut: '/aab-trading-shop.png',
    apple: '/aab-trading-shop.png',
  },
}

type CustomerLoginRouteProps = {
  searchParams: Promise<{ mode?: string; status?: string }>
}

export default async function CustomerLoginRoute({ searchParams }: CustomerLoginRouteProps) {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('customer')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  const { mode, status } = await searchParams
  if (status === 'pending' || status === 'rejected') {
    return <CustomerRegistrationStatusPage status={status} loginHref="/customer/login" />
  }
  if (mode === 'register') {
    // Keep registration separate so normal sign-in stays a single neutral task.
    return <CustomerRegistrationScreen initialAuthMode="register" />
  }

  return <SystemLoginPage entryPortal="customer" />
}
