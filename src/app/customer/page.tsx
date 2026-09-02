import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import PortalHome from '@/app/page'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { manifestPathForPortal } from '@/lib/portal-manifest'

export const metadata: Metadata = {
  // The canonical Customer app page must advertise only the Customer manifest.
  manifest: manifestPathForPortal('customer'),
  title: 'AAB TRADING SHOP',
  icons: {
    icon: '/aab-trading-shop.png',
    shortcut: '/aab-trading-shop.png',
    apple: '/aab-trading-shop.png',
  },
}

export default function CustomerPortalRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('customer')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <PortalHome />
}
