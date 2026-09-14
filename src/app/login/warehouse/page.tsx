import { redirect } from 'next/navigation'
import { SystemLoginPage } from '@/components/auth/StaffLoginPage'
import { getAllowedPortals, getDefaultLoginPathForVariant, resolveAppVariant } from '@/lib/app-variant'

export default function WarehouseLoginRoute() {
  const variant = resolveAppVariant()
  if (!getAllowedPortals(variant).includes('warehouse')) {
    redirect(getDefaultLoginPathForVariant(variant))
  }

  // The URL stays scoped for session isolation; the shared page routes by actual account type.
  return <SystemLoginPage entryPortal="warehouse" />
}
