import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CustomerLoginPage as CustomerLoginScreen } from '@/components/auth/CustomerLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { manifestPathForPortal } from '@/lib/portal-manifest'

export const metadata: Metadata = {
  // Each portal is its own installable app; without its own manifest the
  // browser only ever knows about the site-wide one and offers that instead.
  manifest: manifestPathForPortal('customer'),
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
