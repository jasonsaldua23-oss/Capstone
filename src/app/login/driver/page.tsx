import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { DriverLoginPage as DriverLoginScreen } from '@/components/auth/DriverLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  title: 'AAB TRADING DRIVER',
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

  return <DriverLoginScreen />
}
