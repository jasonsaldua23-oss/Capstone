import { redirect } from 'next/navigation'
import { WarehouseLoginPage as WarehouseLoginScreen } from '@/components/auth/WarehouseLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export default function WarehouseLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('warehouse')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  return <WarehouseLoginScreen />
}
