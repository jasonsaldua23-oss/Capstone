import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { SystemLoginPage } from '@/components/auth/StaffLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  // Login stays inside the Driver PWA scope and retains its manifest identity.
  title: 'AAB TRADING',
  icons: {
    icon: '/aab-trading-driver.png',
    shortcut: '/aab-trading-driver.png',
    apple: '/aab-trading-driver.png',
  },
}

export default function DriverLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // Keep the Driver URL for Capacitor's path lock while sharing the neutral system sign-in screen.
  return <SystemLoginPage entryPortal="driver" />
}
