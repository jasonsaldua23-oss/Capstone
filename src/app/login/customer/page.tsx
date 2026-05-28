import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CustomerLoginPage as CustomerLoginScreen } from '@/components/auth/CustomerLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  title: 'AAB TRADING SHOP',
  icons: {
    icon: '/aab-trading-shop.png',
    shortcut: '/aab-trading-shop.png',
    apple: '/aab-trading-shop.png',
  },
}

export default function CustomerLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('customer')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <CustomerLoginScreen />
}
