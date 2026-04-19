import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { DriverLoginPage as DriverLoginScreen } from '@/components/auth/DriverLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export const metadata: Metadata = {
  title: 'AnnDrive',
  icons: {
    icon: '/anndrive.png',
    shortcut: '/anndrive.png',
    apple: '/anndrive.png',
  },
}

export default function DriverLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <DriverLoginScreen />
}
