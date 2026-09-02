import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import PortalHome from '@/app/page'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'
import { manifestPathForPortal } from '@/lib/portal-manifest'

export const metadata: Metadata = {
  // The canonical Driver app page must advertise only the Driver manifest.
  manifest: manifestPathForPortal('driver'),
  title: 'AAB TRADING DRIVER',
  icons: {
    icon: '/aab-trading-driver.png',
    shortcut: '/aab-trading-driver.png',
    apple: '/aab-trading-driver.png',
  },
}

export default function DriverPortalRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <PortalHome />
}
