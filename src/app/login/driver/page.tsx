import { redirect } from 'next/navigation'
import { DriverLoginPage as DriverLoginScreen } from '@/components/auth/DriverLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export default function DriverLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('driver')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <DriverLoginScreen />
}
